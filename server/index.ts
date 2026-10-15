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
const host = process.env.HOST ?? '127.0.0.1'
const production = process.env.NODE_ENV === 'production'
const configuredOrigins = process.env.CLIENT_ORIGIN?.split(',').map(origin => origin.trim()).filter(Boolean)
if (production && (!configuredOrigins?.length || configuredOrigins.includes('*'))) {
  throw new Error('Em produção, CLIENT_ORIGIN precisa listar origens específicas e permitidas.')
}
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT precisa ser uma porta válida entre 0 e 65535.')
if (production && port === 0) throw new Error('PORT 0 não é permitido em produção.')
const allowedOrigins = configuredOrigins?.length ? configuredOrigins : ['http://localhost:5173']
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
    id TEXT NOT NULL UNIQUE, token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    label TEXT NOT NULL DEFAULT 'Dispositivo', created_at INTEGER NOT NULL DEFAULT 0,
    last_seen_at INTEGER NOT NULL DEFAULT 0, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, color TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'personal' CHECK (kind IN ('personal', 'direct', 'channel')),
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
const sessionColumns = db.pragma('table_info(sessions)') as { name: string }[]
if (!sessionColumns.some(column => column.name === 'id')) db.exec("ALTER TABLE sessions ADD COLUMN id TEXT NOT NULL DEFAULT ''")
if (!sessionColumns.some(column => column.name === 'label')) db.exec("ALTER TABLE sessions ADD COLUMN label TEXT NOT NULL DEFAULT 'Dispositivo'")
if (!sessionColumns.some(column => column.name === 'created_at')) db.exec('ALTER TABLE sessions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0')
if (!sessionColumns.some(column => column.name === 'last_seen_at')) db.exec('ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER NOT NULL DEFAULT 0')
db.prepare("UPDATE sessions SET id = lower(hex(randomblob(16))) WHERE id = ''").run()
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS sessions_id ON sessions(id)')
db.exec('CREATE INDEX IF NOT EXISTS sessions_user_expiry ON sessions(user_id, expires_at)')
db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
const conversationColumns = db.pragma('table_info(conversations)') as { name: string }[]
if (!conversationColumns.some(column => column.name === 'kind')) {
  db.exec("ALTER TABLE conversations ADD COLUMN kind TEXT NOT NULL DEFAULT 'personal'")
}
const conversationSchema = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'conversations'").get() as { sql: string } | undefined
if (conversationSchema && !conversationSchema.sql.includes("'channel'")) {
  db.pragma('foreign_keys = OFF')
  try {
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE conversations_next (
        id TEXT PRIMARY KEY, title TEXT NOT NULL, color TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'personal' CHECK (kind IN ('personal', 'direct', 'channel')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO conversations_next (id, title, color, kind, created_at)
        SELECT id, title, color, kind, created_at FROM conversations;
      DROP TABLE conversations;
      ALTER TABLE conversations_next RENAME TO conversations;
      COMMIT;`)
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  } finally {
    db.pragma('foreign_keys = ON')
  }
}
db.exec(`
  CREATE TABLE IF NOT EXISTS communities (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, invite_code TEXT NOT NULL UNIQUE,
    owner_id TEXT NOT NULL REFERENCES users(id), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS community_members (
    community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (community_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS community_channels (
    id TEXT PRIMARY KEY, community_id TEXT NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
    conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
    name TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
    UNIQUE (community_id, name)
  );
  CREATE INDEX IF NOT EXISTS community_members_user ON community_members(user_id, joined_at);
`)

const app = express()
app.disable('x-powered-by')
app.use(helmet())
app.use(cors({ origin: allowedOrigins }))
app.use(express.json({ limit: '32kb' }))
app.use('/api/auth', rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }))
app.use('/api/users/search', rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: 'draft-8', legacyHeaders: false }))
app.use('/api/messages/search', rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: 'draft-8', legacyHeaders: false }))
app.use('/api/friend-requests', rateLimit({ windowMs: 60 * 60_000, limit: 40, standardHeaders: 'draft-8', legacyHeaders: false }))
app.use('/api/communities/join', rateLimit({ windowMs: 60 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }))

const createSession = db.prepare('INSERT INTO sessions (id, token_hash, user_id, label, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
const sessionUser = db.prepare(`SELECT users.id, users.username, users.display_name AS displayName
  FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?`)
type AuthRequest = Request & { user?: { id: string; username: string; displayName: string }; sessionId?: string; tokenHash?: string }
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
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const user = sessionUser.get(tokenHash, Date.now()) as AuthRequest['user'] | undefined
  if (!user) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ? AND expires_at <= ?').run(tokenHash, Date.now())
    return res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' })
  }
  const session = db.prepare('SELECT id, last_seen_at AS lastSeenAt FROM sessions WHERE token_hash = ?').get(tokenHash) as { id: string; lastSeenAt: number } | undefined
  if (!session) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
    return res.status(401).json({ error: 'Sua sessão expirou. Entre novamente.' })
  }
  req.user = user
  req.sessionId = session.id
  req.tokenHash = tokenHash
  if (Date.now() - session.lastSeenAt > 60_000) db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(Date.now(), session.id)
  return next()
}

function sessionLabel(userAgent: string | undefined) {
  if (!userAgent) return 'Dispositivo desconhecido'
  const platform = /Windows/i.test(userAgent) ? 'Windows' : /Android/i.test(userAgent) ? 'Android' : /iPhone|iPad|iOS/i.test(userAgent) ? 'iPhone ou iPad' : /Mac OS|Macintosh/i.test(userAgent) ? 'Mac' : /Linux/i.test(userAgent) ? 'Linux' : 'Dispositivo'
  const browser = /Edg\//i.test(userAgent) ? 'Edge' : /Firefox\//i.test(userAgent) ? 'Firefox' : /Chrome\//i.test(userAgent) ? 'Chrome' : /Safari\//i.test(userAgent) ? 'Safari' : 'Prosa'
  return `${browser} · ${platform}`
}

function newSession(userId: string, userAgent?: string) {
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  // Session credentials are stored only as SHA-256 digests.
  createSession.run(randomBytes(16).toString('hex'), createHash('sha256').update(token).digest('hex'), userId, sessionLabel(userAgent), now, now, now + 30 * 24 * 60 * 60_000)
  return token
}

function canAccessConversation(conversationId: string, userId: string) {
  const conversation = db.prepare(`SELECT c.kind FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE c.id = ? AND cm.user_id = ?`).get(conversationId, userId) as { kind: string } | undefined
  if (!conversation) return false
  if (conversation.kind === 'channel') return Boolean(db.prepare(`SELECT 1 FROM community_channels cc
    JOIN community_members cm ON cm.community_id = cc.community_id
    WHERE cc.conversation_id = ? AND cm.user_id = ? LIMIT 1`).get(conversationId, userId))
  if (conversation.kind !== 'direct') return true
  return Boolean(db.prepare(`SELECT 1 FROM conversation_members peer JOIN friendships f ON f.status = 'accepted'
    AND ((f.requester_id = ? AND f.addressee_id = peer.user_id) OR (f.requester_id = peer.user_id AND f.addressee_id = ?))
    WHERE peer.conversation_id = ? AND peer.user_id <> ? LIMIT 1`).get(userId, userId, conversationId, userId))
}

app.get('/api/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get()
    return res.json({ status: 'ok', service: 'prosa' })
  } catch {
    return res.status(503).json({ status: 'unavailable', service: 'prosa' })
  }
})

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
    const token = newSession(id, req.header('user-agent'))
    return res.status(201).json({ token, user: { id, username, displayName } })
  } catch (error) { return next(error) }
})

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const username = String(req.body?.username ?? '').trim().toLowerCase()
    const password = String(req.body?.password ?? '')
    const user = db.prepare('SELECT id, username, display_name AS displayName, password_hash AS passwordHash FROM users WHERE username = ?').get(username) as { id: string; username: string; displayName: string; passwordHash: string } | undefined
    if (!user || !await argon2.verify(user.passwordHash, password).catch(() => false)) return res.status(401).json({ error: 'Nome de usuário ou senha incorretos.' })
    return res.json({ token: newSession(user.id, req.header('user-agent')), user: { id: user.id, username: user.username, displayName: user.displayName } })
  } catch (error) { return next(error) }
})

app.post('/api/auth/logout', requireAuth, (req: AuthRequest, res) => {
  const tokenHash = req.tokenHash!
  db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(req.sessionId, req.user!.id)
  void io.in(`user:${req.user!.id}`).fetchSockets().then(sockets => {
    for (const socket of sockets) if (socket.data.tokenHash === tokenHash) socket.disconnect(true)
  })
  res.status(204).end()
})

app.get('/api/me', requireAuth, (req: AuthRequest, res) => res.json({ user: req.user }))

app.get('/api/sessions', requireAuth, (req: AuthRequest, res) => {
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at <= ?').run(req.user!.id, Date.now())
  const sessions = db.prepare(`SELECT id, label, created_at AS createdAt, last_seen_at AS lastSeenAt,
    expires_at AS expiresAt, id = ? AS current FROM sessions WHERE user_id = ? AND expires_at > ?
    ORDER BY current DESC, last_seen_at DESC`).all(req.sessionId, req.user!.id, Date.now())
  return res.json({ sessions })
})

app.delete('/api/sessions/:id', requireAuth, (req: AuthRequest, res) => {
  if (!/^[a-f0-9]{32}$/.test(req.params.id)) return res.status(400).json({ error: 'Sessão inválida.' })
  if (req.params.id === req.sessionId) return res.status(400).json({ error: 'Use a opção de sair para encerrar esta sessão.' })
  const target = db.prepare('SELECT token_hash AS tokenHash FROM sessions WHERE id = ? AND user_id = ?').get(req.params.id, req.user!.id) as { tokenHash: string } | undefined
  if (!target) return res.status(404).json({ error: 'Essa sessão não está mais ativa.' })
  const result = db.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').run(req.params.id, req.user!.id)
  if (!result.changes) return res.status(404).json({ error: 'Essa sessão não está mais ativa.' })
  void io.in(`user:${req.user!.id}`).fetchSockets().then(sockets => {
    for (const socket of sockets) if (socket.data.tokenHash === target.tokenHash) socket.disconnect(true)
  })
  return res.status(204).end()
})

app.get('/api/communities', requireAuth, (req: AuthRequest, res) => {
  const rows = db.prepare(`SELECT c.id, c.name, c.invite_code AS inviteCode, cm.role,
    (SELECT COUNT(*) FROM community_members countMembers WHERE countMembers.community_id = c.id) AS memberCount
    FROM communities c JOIN community_members cm ON cm.community_id = c.id
    WHERE cm.user_id = ? ORDER BY c.name COLLATE NOCASE`).all(req.user!.id) as { id: string; name: string; inviteCode: string; role: string; memberCount: number }[]
  const channelQuery = db.prepare(`SELECT id, conversation_id AS conversationId, name, position
    FROM community_channels WHERE community_id = ? ORDER BY position, name COLLATE NOCASE`)
  const communities = rows.map(({ inviteCode, ...community }) => ({
    ...community,
    inviteCode: community.role === 'owner' || community.role === 'admin' ? inviteCode : null,
    channels: channelQuery.all(community.id),
  }))
  return res.json({ communities })
})

app.post('/api/communities', requireAuth, rateLimit({ windowMs: 60 * 60_000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false }), (req: AuthRequest, res) => {
  const name = String(req.body?.name ?? '').trim()
  if (name.length < 2 || name.length > 48) return res.status(400).json({ error: 'O nome da comunidade deve ter entre 2 e 48 caracteres.' })
  const id = randomBytes(16).toString('hex')
  const channelId = randomBytes(16).toString('hex')
  const conversationId = randomBytes(16).toString('hex')
  const inviteCode = randomBytes(9).toString('base64url')
  const create = db.transaction(() => {
    db.prepare('INSERT INTO communities (id, name, invite_code, owner_id) VALUES (?, ?, ?, ?)').run(id, name, inviteCode, req.user!.id)
    db.prepare("INSERT INTO community_members (community_id, user_id, role) VALUES (?, ?, 'owner')").run(id, req.user!.id)
    db.prepare("INSERT INTO conversations (id, title, color, kind) VALUES (?, 'geral', 'violet', 'channel')").run(conversationId)
    db.prepare('INSERT INTO community_channels (id, community_id, conversation_id, name, position) VALUES (?, ?, ?, ?, 0)')
      .run(channelId, id, conversationId, 'geral')
    db.prepare('INSERT INTO conversation_members (conversation_id, user_id) VALUES (?, ?)').run(conversationId, req.user!.id)
  })
  create()
  io.to(`user:${req.user!.id}`).emit('conversations:changed')
  io.to(`user:${req.user!.id}`).emit('communities:changed')
  return res.status(201).json({ community: { id, name, role: 'owner', inviteCode, channels: [{ id: channelId, conversationId, name: 'geral' }] } })
})

app.post('/api/communities/join', requireAuth, (req: AuthRequest, res) => {
  const inviteCode = String(req.body?.inviteCode ?? '').trim()
  if (!/^[A-Za-z0-9_-]{10,32}$/.test(inviteCode)) return res.status(400).json({ error: 'Código de convite inválido.' })
  const community = db.prepare('SELECT id FROM communities WHERE invite_code = ?').get(inviteCode) as { id: string } | undefined
  if (!community) return res.status(404).json({ error: 'Não encontramos essa comunidade.' })
  const existing = db.prepare('SELECT 1 FROM community_members WHERE community_id = ? AND user_id = ?').get(community.id, req.user!.id)
  if (existing) return res.status(409).json({ error: 'Você já participa desta comunidade.' })
  const join = db.transaction(() => {
    db.prepare("INSERT INTO community_members (community_id, user_id, role) VALUES (?, ?, 'member')").run(community.id, req.user!.id)
    db.prepare(`INSERT INTO conversation_members (conversation_id, user_id)
      SELECT conversation_id, ? FROM community_channels WHERE community_id = ?`).run(req.user!.id, community.id)
  })
  join()
  const members = db.prepare('SELECT user_id AS userId FROM community_members WHERE community_id = ?').all(community.id) as { userId: string }[]
  for (const member of members) {
    io.to(`user:${member.userId}`).emit('communities:changed')
    io.to(`user:${member.userId}`).emit('conversations:changed')
  }
  return res.status(200).json({ communityId: community.id })
})

app.post('/api/communities/:id/channels', requireAuth, (req: AuthRequest, res) => {
  const name = String(req.body?.name ?? '').trim()
  if (!/^[\p{L}\p{N}][\p{L}\p{N}-]{1,31}$/u.test(name)) return res.status(400).json({ error: 'Use de 2 a 32 letras, números ou hífens no nome do canal.' })
  const membership = db.prepare('SELECT role FROM community_members WHERE community_id = ? AND user_id = ?')
    .get(req.params.id, req.user!.id) as { role: string } | undefined
  if (!membership) return res.status(404).json({ error: 'Comunidade não encontrada.' })
  if (membership.role !== 'owner' && membership.role !== 'admin') return res.status(403).json({ error: 'Somente responsáveis podem criar canais.' })
  const channelId = randomBytes(16).toString('hex')
  const conversationId = randomBytes(16).toString('hex')
  try {
    const create = db.transaction(() => {
      db.prepare('INSERT INTO conversations (id, title, color, kind) VALUES (?, ?, ?, ?)').run(conversationId, name, 'violet', 'channel')
      db.prepare('INSERT INTO community_channels (id, community_id, conversation_id, name, position) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), -1) + 1 FROM community_channels WHERE community_id = ?))')
        .run(channelId, req.params.id, conversationId, name, req.params.id)
      db.prepare(`INSERT INTO conversation_members (conversation_id, user_id)
        SELECT ?, user_id FROM community_members WHERE community_id = ?`).run(conversationId, req.params.id)
    })
    create()
  } catch (error) {
    if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) return res.status(409).json({ error: 'Já existe um canal com esse nome.' })
    throw error
  }
  const members = db.prepare('SELECT user_id AS userId FROM community_members WHERE community_id = ?').all(req.params.id) as { userId: string }[]
  for (const member of members) {
    io.to(`user:${member.userId}`).emit('communities:changed')
    io.to(`user:${member.userId}`).emit('conversations:changed')
  }
  return res.status(201).json({ channel: { id: channelId, conversationId, name } })
})

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

app.get('/api/messages/search', requireAuth, (req: AuthRequest, res) => {
  const query = String(req.query.q ?? '').trim()
  if (query.length < 2) return res.json({ messages: [] })
  if (query.length > 100) return res.status(400).json({ error: 'A busca aceita até 100 caracteres.' })
  const pattern = `%${query.replace(/[!%_]/g, '!$&')}%`
  const messages = db.prepare(`SELECT m.id, m.conversation_id AS conversationId, m.author_id AS authorId,
    u.display_name AS author, m.body AS text, m.created_at AS createdAt,
    CASE WHEN c.kind = 'direct' THEN (SELECT peer.display_name FROM conversation_members other
      JOIN users peer ON peer.id = other.user_id WHERE other.conversation_id = c.id AND other.user_id <> @me LIMIT 1)
      WHEN c.kind = 'channel' THEN (SELECT community.name || ' · #' || cc.name FROM community_channels cc
        JOIN communities community ON community.id = cc.community_id WHERE cc.conversation_id = c.id LIMIT 1)
      ELSE c.title END AS conversationName
    FROM messages m JOIN conversations c ON c.id = m.conversation_id
    JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = @me
    JOIN users u ON u.id = m.author_id
    WHERE m.body LIKE @pattern ESCAPE '!'
      AND ((c.kind = 'channel' AND EXISTS (SELECT 1 FROM community_channels cc JOIN community_members cm
        ON cm.community_id = cc.community_id WHERE cc.conversation_id = c.id AND cm.user_id = @me))
        OR (c.kind <> 'channel' AND (c.kind <> 'direct' OR EXISTS (
        SELECT 1 FROM conversation_members peer JOIN friendships f ON f.status = 'accepted'
        AND ((f.requester_id = @me AND f.addressee_id = peer.user_id) OR (f.requester_id = peer.user_id AND f.addressee_id = @me))
        WHERE peer.conversation_id = c.id AND peer.user_id <> @me
      ))))
    ORDER BY m.created_at DESC, m.rowid DESC LIMIT 40`).all({ me: req.user!.id, pattern })
  return res.json({ messages })
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
    CASE WHEN c.kind = 'direct' THEN (SELECT u.username FROM conversation_members other JOIN users u ON u.id = other.user_id
      WHERE other.conversation_id = c.id AND other.user_id <> @me LIMIT 1) END AS peerUsername,
    community.id AS communityId, community.name AS communityName, cc.name AS channelName,
    (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS preview,
    (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS lastMessageAt
    ,(SELECT COUNT(*) FROM messages unread WHERE unread.conversation_id = c.id AND unread.author_id <> @me
      AND unread.rowid > COALESCE((SELECT cr.last_read_rowid FROM conversation_reads cr
        WHERE cr.conversation_id = c.id AND cr.user_id = @me), 0)) AS unreadCount
    FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
    LEFT JOIN community_channels cc ON cc.conversation_id = c.id
    LEFT JOIN communities community ON community.id = cc.community_id
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
  let pivot: { createdAt: string; sequence: number } | undefined
  if (req.query.around !== undefined) {
    const targetId = String(req.query.around)
    if (!/^[a-f0-9]{32}$/.test(targetId)) return res.status(400).json({ error: 'Mensagem de referência inválida.' })
    pivot = db.prepare('SELECT created_at AS createdAt, rowid AS sequence FROM messages WHERE id = ? AND conversation_id = ?')
      .get(targetId, req.params.id) as { createdAt: string; sequence: number } | undefined
    if (!pivot) return res.status(404).json({ error: 'Mensagem não encontrada.' })
  }
  const rows = pivot
    ? db.prepare(`SELECT m.rowid AS sequence, m.id, m.conversation_id AS conversationId, m.author_id AS authorId,
        u.display_name AS author, m.body AS text, m.created_at AS createdAt
        FROM messages m JOIN users u ON u.id = m.author_id
        WHERE m.conversation_id = ? AND (m.created_at < ? OR (m.created_at = ? AND m.rowid <= ?))
        ORDER BY m.created_at DESC, m.rowid DESC LIMIT ?`).all(req.params.id, pivot.createdAt, pivot.createdAt, pivot.sequence, limit + 1) as (ApiMessageRow & { sequence: number })[]
    : before
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

if (process.env.PROSA_NO_LISTEN !== '1') {
  httpServer.listen(port, host, () => {
    const address = httpServer.address()
    const activePort = address && typeof address !== 'string' ? address.port : port
    console.log(`Prosa API listening on http://${host}:${activePort}`)
  })
  const shutdown = () => {
    httpServer.close(() => {
      io.close()
      db.close()
      process.exit(0)
    })
    setTimeout(() => process.exit(1), 10_000).unref()
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}

export { app, db, httpServer, io }
