import 'dotenv/config'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import argon2 from 'argon2'
import Database from 'better-sqlite3'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'
import { Server } from 'socket.io'

const port = Number(process.env.PORT ?? 8787)
const dataDir = path.resolve(process.env.PROSA_DATA_DIR ?? 'data')
mkdirSync(dataDir, { recursive: true })
const db = new Database(path.join(dataDir, 'prosa.sqlite'))
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, color TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'personal' CHECK (kind IN ('personal', 'direct')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS friendships (
    id TEXT PRIMARY KEY,
    requester_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    addressee_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (requester_id, addressee_id),
    CHECK (requester_id <> addressee_id)
  );
  CREATE INDEX IF NOT EXISTS friendships_addressee_status ON friendships(addressee_id, status, created_at);
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS messages_conversation_created ON messages(conversation_id, created_at);
  CREATE TABLE IF NOT EXISTS conversation_reads (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    last_read_rowid INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (conversation_id, user_id)
  );
`)
const conversationColumns = db.pragma('table_info(conversations)') as { name: string }[]
if (!conversationColumns.some(column => column.name === 'kind')) {
  db.exec("ALTER TABLE conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'personal'")
}

const app = express()
app.disable('x-powered-by')
app.use(helmet())
const allowedOrigins = process.env.CLIENT_ORIGIN?.split(',') ?? ['http://localhost:5173']
app.use(cors({ origin: allowedOrigins }))
app.use(express.json({ limit: '32kb' }))
app.use('/api/auth', rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }))
app.use('/api/users/search', rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: 'draft-8', legacyHeaders: false }))
app.use('/api/friend-requests', rateLimit({ windowMs: 60 * 60_000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false }))

const createSession = db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
const sessionUser = db.prepare(`SELECT users.id, users.username, users.display_name AS displayName
  FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?`)
type AuthRequest = Request & { user?: { id: string; username: string; displayName: string } }
const httpServer = createServer(app)
const io = new Server(httpServer, { cors: { origin: allowedOrigins }, maxHttpBufferSize: 32_000 })

io.use((socket, next) => {
  const token = socket.handshake.auth?.token
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{32,64}$/.test(token)) return next(new Error('Entre na sua conta para continuar.'))
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const user = sessionUser.get(tokenHash, Date.now()) as AuthRequest['user'] | undefined
  if (!user) return next(new Error('Sua sessão expirou.'))
  socket.data.user = user
  socket.data.tokenHash = tokenHash
  return next()
})

io.on('connection', socket => {
  const user = socket.data.user as NonNullable<AuthRequest['user']>
  socket.join(`user:${user.id}`)
  socket.on('conversation:join', (conversationId: unknown, acknowledge?: (result: { ok: boolean }) => void) => {
    const session = sessionUser.get(socket.data.tokenHash, Date.now())
    if (!session || typeof conversationId !== 'string' || conversationId.length > 64) return acknowledge?.({ ok: false })
    if (!canAccessConversation(conversationId, user.id)) return acknowledge?.({ ok: false })
    socket.join(`conversation:${conversationId}`)
    return acknowledge?.({ ok: true })
  })
  socket.on('conversation:leave', (conversationId: unknown) => {
    if (typeof conversationId === 'string' && conversationId.length <= 64) void socket.leave(`conversation:${conversationId}`)
  })
})

function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.header('authorization')?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1]
  if (!token) return res.status(401).json({ error: 'Entre na sua conta para continuar.' })
  const user = sessionUser.get(createHash('sha256').update(token).digest('hex'), Date.now()) as AuthRequest['user'] | undefined
  if (!user) return res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' })
  req.user = user
  return next()
}

function newSession(userId: string) {
  const token = randomBytes(32).toString('base64url')
  // Session credentials are stored only as SHA-256 digests.
  createSession.run(createHash('sha256').update(token).digest('hex'), userId, Date.now() + 30 * 24 * 60 * 60_000)
  return token
}

function canAccessConversation(conversationId: string, userId: string) {
  const conversation = db.prepare(`SELECT c.kind FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE c.id = ? AND cm.user_id = ?`).get(conversationId, userId) as { kind: string } | undefined
  if (!conversation) return false
  if (conversation.kind !== 'direct') return true
  return Boolean(db.prepare(`SELECT 1 FROM conversation_members peer JOIN friendships f ON f.status = 'accepted'
    AND ((f.requester_id = ? AND f.addressee_id = peer.user_id) OR (f.requester_id = peer.user_id AND f.addressee_id = ?))
    WHERE peer.conversation_id = ? AND peer.user_id <> ? LIMIT 1`).get(userId, userId, conversationId, userId))
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'prosa' }))

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const username = String(req.body?.username ?? '').trim().toLowerCase()
    const displayName = String(req.body?.displayName ?? '').trim()
    const password = String(req.body?.password ?? '')
    if (!/^[a-z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: 'Use um nome de usuário com 3 a 24 letras, números ou sublinhados.' })
    if (displayName.length < 1 || displayName.length > 48) return res.status(400).json({ error: 'O nome de exibição deve ter até 48 caracteres.' })
    if (password.length < 12 || password.length > 128) return res.status(400).json({ error: 'A senha deve ter entre 12 e 128 caracteres.' })
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) return res.status(409).json({ error: 'Esse nome de usuário já está em uso.' })
    const id = randomBytes(16).toString('hex')
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id })
    db.prepare('INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)').run(id, username, displayName, passwordHash)
    const conversation = randomBytes(16).toString('hex')
    db.prepare('INSERT INTO conversations (id, title, color) VALUES (?, ?, ?)').run(conversation, displayName, 'coral')
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(conversation, id)
    const token = newSession(id)
    return res.status(201).json({ token, user: { id, username, displayName } })
  } catch (error) { return next(error) }
})

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const username = String(req.body?.username ?? '').trim().toLowerCase()
    const password = String(req.body?.password ?? '')
    const user = db.prepare('SELECT id, username, display_name AS displayName, password_hash AS passwordHash FROM users WHERE username = ?').get(username) as { id: string; username: string; displayName: string; passwordHash: string } | undefined
    if (!user || !await argon2.verify(user.passwordHash, password).catch(() => false)) return res.status(401).json({ error: 'Nome de usuário ou senha incorretos.' })
    return res.json({ token: newSession(user.id), user: { id: user.id, username: user.username, displayName: user.displayName } })
  } catch (error) { return next(error) }
})

app.post('/api/auth/logout', requireAuth, (req: AuthRequest, res) => {
  const token = req.header('authorization')!.slice(7)
  const tokenHash = createHash('sha256').update(token).digest('hex')
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
  void io.in(`user:${req.user!.id}`).fetchSockets().then(sockets => {
    for (const socket of sockets) if (socket.data.tokenHash === tokenHash) socket.disconnect(true)
  })
  res.status(204).end()
})

app.get('/api/me', requireAuth, (req: AuthRequest, res) => res.json({ user: req.user }))

app.get('/api/users/search', requireAuth, (req: AuthRequest, res) => {
  const query = String(req.query.q ?? '').trim().replace(/^@/, '').toLowerCase()
  if (query.length < 2) return res.json({ users: [] })
  const users = db.prepare(`SELECT u.id, u.username, u.display_name AS displayName,
    CASE WHEN f.status = 'accepted' THEN 'friend'
         WHEN f.addressee_id = @me AND f.status = 'pending' THEN 'incoming'
         WHEN f.requester_id = @me AND f.status = 'pending' THEN 'outgoing'
         ELSE 'none' END AS relationship
    FROM users u LEFT JOIN friendships f ON
      (f.requester_id = @me AND f.addressee_id = u.id) OR (f.addressee_id = @me AND f.requester_id = u.id)
    WHERE u.id <> @me AND u.username LIKE @query ESCAPE '\\'
    ORDER BY u.username LIMIT 20`).all({ me: req.user!.id, query: `%${query.replace(/[\\%_]/g, '\\$&')}%` })
  return res.json({ users })
})

app.get('/api/friends', requireAuth, (req: AuthRequest, res) => {
  const friends = db.prepare(`SELECT u.id, u.username, u.display_name AS displayName, f.updated_at AS since
    FROM friendships f JOIN users u ON u.id = CASE WHEN f.requester_id = @me THEN f.addressee_id ELSE f.requester_id END
    WHERE (f.requester_id = @me OR f.addressee_id = @me) AND f.status = 'accepted'
    ORDER BY u.username`).all({ me: req.user!.id })
  const incoming = db.prepare(`SELECT f.id, u.id AS userId, u.username, u.display_name AS displayName, f.created_at AS since
    FROM friendships f JOIN users u ON u.id = f.requester_id WHERE f.addressee_id = ? AND f.status = 'pending' ORDER BY f.created_at`).all(req.user!.id)
  const outgoing = db.prepare(`SELECT f.id, u.id AS userId, u.username, u.display_name AS displayName, f.created_at AS since
    FROM friendships f JOIN users u ON u.id = f.addressee_id WHERE f.requester_id = ? AND f.status = 'pending' ORDER BY f.created_at`).all(req.user!.id)
  return res.json({ friends, incoming, outgoing })
})

app.post('/api/friend-requests', requireAuth, (req: AuthRequest, res) => {
  const username = String(req.body?.username ?? '').trim().replace(/^@/, '').toLowerCase()
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: 'Informe um nome de usuário válido.' })
  const target = db.prepare('SELECT id FROM users WHERE username = ?').get(username) as { id: string } | undefined
  if (!target) return res.status(404).json({ error: 'Não encontramos essa pessoa.' })
  if (target.id === req.user!.id) return res.status(400).json({ error: 'Você já tem a si mesmo por perto.' })
  const existing = db.prepare(`SELECT id, requester_id AS requesterId, addressee_id AS addresseeId, status FROM friendships
    WHERE (requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?)`)
    .get(req.user!.id, target.id, target.id, req.user!.id) as { id: string; requesterId: string; addresseeId: string; status: string } | undefined
  if (existing?.status === 'accepted') return res.status(409).json({ error: 'Vocês já estão conectados.' })
  if (existing?.status === 'pending' && existing.addresseeId === req.user!.id) {
    db.prepare("UPDATE friendships SET status = 'accepted', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(existing.id)
    const conversationId = createDirectConversation(req.user!.id, target.id)
    io.to(`user:${req.user!.id}`).emit('conversations:changed')
    io.to(`user:${target.id}`).emit('conversations:changed')
    io.to(`user:${req.user!.id}`).emit('contacts:changed')
    io.to(`user:${target.id}`).emit('contacts:changed')
    return res.status(200).json({ status: 'accepted', conversationId })
  }
  if (existing) return res.status(409).json({ error: 'O pedido já foi enviado.' })
  const id = randomBytes(16).toString('hex')
  db.prepare("INSERT INTO friendships (id, requester_id, addressee_id, status) VALUES (?, ?, ?, 'pending')").run(id, req.user!.id, target.id)
  io.to(`user:${target.id}`).emit('contacts:changed')
  return res.status(201).json({ status: 'pending', id })
})

app.delete('/api/friend-requests/:id', requireAuth, (req: AuthRequest, res) => {
  const other = db.prepare("SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS id FROM friendships WHERE id = ? AND status = 'pending' AND (requester_id = ? OR addressee_id = ?)")
    .get(req.user!.id, req.params.id, req.user!.id, req.user!.id) as { id: string } | undefined
  const result = db.prepare("DELETE FROM friendships WHERE id = ? AND (requester_id = ? OR addressee_id = ?) AND status = 'pending'").run(req.params.id, req.user!.id, req.user!.id)
  if (!result.changes) return res.status(404).json({ error: 'Esse pedido não está mais disponível.' })
  io.to(`user:${req.user!.id}`).emit('contacts:changed')
  if (other) io.to(`user:${other.id}`).emit('contacts:changed')
  return res.status(204).end()
})

app.delete('/api/friends/:id', requireAuth, (req: AuthRequest, res) => {
  const other = db.prepare("SELECT CASE WHEN requester_id = ? THEN addressee_id ELSE requester_id END AS id FROM friendships WHERE status = 'accepted' AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))")
    .get(req.user!.id, req.user!.id, req.params.id, req.params.id, req.user!.id) as { id: string } | undefined
  const result = db.prepare("DELETE FROM friendships WHERE status = 'accepted' AND ((requester_id = ? AND addressee_id = ?) OR (requester_id = ? AND addressee_id = ?))")
    .run(req.user!.id, req.params.id, req.params.id, req.user!.id)
  if (!result.changes) return res.status(404).json({ error: 'Essa conexão não existe.' })
  io.to(`user:${req.user!.id}`).emit('conversations:changed')
  if (other) io.to(`user:${other.id}`).emit('conversations:changed')
  io.to(`user:${req.user!.id}`).emit('contacts:changed')
  if (other) io.to(`user:${other.id}`).emit('contacts:changed')
  return res.status(204).end()
})

function createDirectConversation(firstId: string, secondId: string) {
  const existing = db.prepare(`SELECT c.id FROM conversations c JOIN conversation_members a ON a.conversation_id = c.id
    JOIN conversation_members b ON b.conversation_id = c.id WHERE c.kind = 'direct'
    AND a.user_id = ? AND b.user_id = ?`).get(firstId, secondId) as { id: string } | undefined
  if (existing) return existing.id
  const participants = db.prepare(`SELECT id, display_name AS displayName FROM users WHERE id IN (?, ?) ORDER BY username`).all(firstId, secondId) as { id: string; displayName: string }[]
  const conversationId = randomBytes(16).toString('hex')
  const title = participants.map(person => person.displayName).join(' e ')
  const create = db.transaction(() => {
    db.prepare("INSERT INTO conversations (id, title, color, kind) VALUES (?, ?, 'blue', 'direct')").run(conversationId, title)
    const addMember = db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)')
    for (const person of participants) addMember.run(conversationId, person.id)
  })
  create()
  return conversationId
}

app.get('/api/conversations', requireAuth, (req: AuthRequest, res) => {
  const conversations = db.prepare(`SELECT c.id,
    CASE WHEN c.kind = 'direct' THEN (SELECT u.display_name FROM conversation_members other JOIN users u ON u.id = other.user_id
      WHERE other.conversation_id = c.id AND other.user_id <> @me LIMIT 1) ELSE c.title END AS name,
    c.color, c.created_at AS createdAt,
    (SELECT u.username FROM conversation_members other JOIN users u ON u.id = other.user_id
      WHERE other.conversation_id = c.id AND other.user_id <> @me LIMIT 1) AS peerUsername,
    (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS preview,
    (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS lastMessageAt
    ,(SELECT COUNT(*) FROM messages unread WHERE unread.conversation_id = c.id AND unread.author_id <> @me
      AND unread.rowid > COALESCE((SELECT cr.last_read_rowid FROM conversation_reads cr
        WHERE cr.conversation_id = c.id AND cr.user_id = @me), 0)) AS unreadCount
    FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE cm.user_id = @me AND (c.kind <> 'direct' OR EXISTS (
      SELECT 1 FROM conversation_members peer JOIN friendships f ON f.status = 'accepted'
      AND ((f.requester_id = @me AND f.addressee_id = peer.user_id) OR (f.requester_id = peer.user_id AND f.addressee_id = @me))
      WHERE peer.conversation_id = c.id AND peer.user_id <> @me
    )) ORDER BY COALESCE(lastMessageAt, c.created_at) DESC`).all({ me: req.user!.id })
  res.json({ conversations })
})

app.get('/api/conversations/:id/messages', requireAuth, (req: AuthRequest, res) => {
  if (!canAccessConversation(req.params.id, req.user!.id)) return res.status(404).json({ error: 'Conversa não encontrada.' })
  const parsedLimit = Number(req.query.limit ?? 50)
  const limit = Number.isInteger(parsedLimit) ? Math.min(100, Math.max(1, parsedLimit)) : 50
  let before: { createdAt: string; rowid: number } | undefined
  if (req.query.before !== undefined) {
    const cursor = String(req.query.before)
    if (cursor.length > 256 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return res.status(400).json({ error: 'Cursor de histórico inválido.' })
    try {
      const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { createdAt?: unknown; rowid?: unknown }
      if (typeof value.createdAt !== 'string' || value.createdAt.length > 40 || !Number.isSafeInteger(value.rowid) || Number(value.rowid) < 1) {
        return res.status(400).json({ error: 'Cursor de histórico inválido.' })
      }
      before = { createdAt: value.createdAt, rowid: Number(value.rowid) }
    } catch { return res.status(400).json({ error: 'Cursor de histórico inválido.' }) }
  }
  const rows = before
    ? db.prepare(`SELECT m.rowid AS sequence, m.id, m.conversation_id AS conversationId, m.author_id AS authorId,
        u.display_name AS author, m.body AS text, m.created_at AS createdAt
        FROM messages m JOIN users u ON u.id = m.author_id
        WHERE m.conversation_id = ? AND (m.created_at < ? OR (m.created_at = ? AND m.rowid < ?))
        ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`).all(req.params.id, before.createdAt, before.createdAt, before.rowid, limit + 1) as (ApiMessageRow & { sequence: number })[]
    : db.prepare(`SELECT m.rowid AS sequence, m.id, m.conversation_id AS conversationId, m.author_id AS authorId,
        u.display_name AS author, m.body AS text, m.created_at AS createdAt
        FROM messages m JOIN users u ON u.id = m.author_id WHERE m.conversation_id = ?
        ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`).all(req.params.id, limit + 1) as (ApiMessageRow & { sequence: number })[]
  const hasOlder = rows.length > limit
  const page = rows.slice(0, limit)
  const oldest = page.at(-1)
  const nextCursor = hasOlder && oldest
    ? Buffer.from(JSON.stringify({ createdAt: oldest.createdAt, rowid: oldest.sequence })).toString('base64url')
    : null
  const messages = page.reverse().map(({ sequence: _sequence, ...message }) => message)
  return res.json({ messages, nextCursor })
})

type ApiMessageRow = { id: string; conversationId: string; authorId: string; author: string; text: string; createdAt: string }

app.post('/api/conversations/:id/read', requireAuth, (req: AuthRequest, res) => {
  if (!canAccessConversation(req.params.id, req.user!.id)) return res.status(404).json({ error: 'Conversa não encontrada.' })
  const latest = db.prepare('SELECT COALESCE(MAX(rowid), 0) AS rowid FROM messages WHERE conversation_id = ?').get(req.params.id) as { rowid: number }
  db.prepare(`INSERT INTO conversation_reads (conversation_id, user_id, last_read_rowid)
    VALUES (?, ?, ?) ON CONFLICT(conversation_id, user_id) DO UPDATE SET
    last_read_rowid = MAX(conversation_reads.last_read_rowid, excluded.last_read_rowid), updated_at = CURRENT_TIMESTAMP`)
    .run(req.params.id, req.user!.id, latest.rowid)
  return res.json({ lastReadRowId: latest.rowid })
})

app.post('/api/conversations/:id/messages', requireAuth, (req: AuthRequest, res) => {
  if (!canAccessConversation(req.params.id, req.user!.id)) return res.status(404).json({ error: 'Conversa não encontrada.' })
  const text = String(req.body?.text ?? '').trim()
  if (text.length < 1 || text.length > 4000) return res.status(400).json({ error: 'A mensagem deve ter entre 1 e 4.000 caracteres.' })
  const id = randomBytes(16).toString('hex')
  const createdAt = new Date().toISOString()
  db.prepare('INSERT INTO messages (id, conversation_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(id, req.params.id, req.user!.id, text, createdAt)
  const message = { id, conversationId: req.params.id, authorId: req.user!.id, author: req.user!.displayName, text, createdAt }
  const recipients = db.prepare('SELECT user_id AS userId FROM conversation_members WHERE conversation_id = ?').all(req.params.id) as { userId: string }[]
  for (const recipient of recipients) io.to(`user:${recipient.userId}`).emit('message:new', message)
  return res.status(201).json({ message })
})

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Prosa API request failed:', err.message)
  res.status(500).json({ error: 'O serviço encontrou um erro inesperado.' })
})

if (process.env.PROSA_NO_LISTEN !== '1') httpServer.listen(port, () => console.log(`Prosa API listening on http://localhost:${port}`))

export { app, db, httpServer, io }
