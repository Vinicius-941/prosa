import 'dotenv/config'
import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import argon2 from 'argon2'
import Database from 'better-sqlite3'
import cors from 'cors'
import express, { type NextFunction, type Request, type Response } from 'express'
import rateLimit from 'express-rate-limit'
import helmet from 'helmet'

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
    id TEXT PRIMARY KEY, title TEXT NOT NULL, color TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS conversation_members (
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    PRIMARY KEY (conversation_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS messages_conversation_created ON messages(conversation_id, created_at);
`)

const app = express()
app.disable('x-powered-by')
app.use(helmet())
app.use(cors({ origin: process.env.CLIENT_ORIGIN?.split(',') ?? ['http://localhost:5173'] }))
app.use(express.json({ limit: '32kb' }))
app.use('/api/auth', rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }))

const createSession = db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
const sessionUser = db.prepare(`SELECT users.id, users.username, users.display_name AS displayName
  FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?`)
type AuthRequest = Request & { user?: { id: string; username: string; displayName: string } }

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
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(createHash('sha256').update(token).digest('hex'))
  res.status(204).end()
})

app.get('/api/me', requireAuth, (req: AuthRequest, res) => res.json({ user: req.user }))

app.get('/api/conversations', requireAuth, (req: AuthRequest, res) => {
  const conversations = db.prepare(`SELECT c.id, c.title AS name, c.color, c.created_at AS createdAt,
    (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS preview,
    (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC, m.rowid DESC LIMIT 1) AS lastMessageAt
    FROM conversations c JOIN conversation_members cm ON cm.conversation_id = c.id
    WHERE cm.user_id = ? ORDER BY COALESCE(lastMessageAt, c.created_at) DESC`).all(req.user!.id)
  res.json({ conversations })
})

app.get('/api/conversations/:id/messages', requireAuth, (req: AuthRequest, res) => {
  const allowed = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(req.params.id, req.user!.id)
  if (!allowed) return res.status(404).json({ error: 'Conversa não encontrada.' })
  const messages = db.prepare(`SELECT m.id, m.conversation_id AS conversationId, m.author_id AS authorId,
    u.display_name AS author, m.body AS text, m.created_at AS createdAt
    FROM messages m JOIN users u ON u.id = m.author_id WHERE m.conversation_id = ?
    ORDER BY m.created_at ASC, m.rowid ASC LIMIT 500`).all(req.params.id)
  return res.json({ messages })
})

app.post('/api/conversations/:id/messages', requireAuth, (req: AuthRequest, res) => {
  const allowed = db.prepare('SELECT 1 FROM conversation_members WHERE conversation_id = ? AND user_id = ?').get(req.params.id, req.user!.id)
  if (!allowed) return res.status(404).json({ error: 'Conversa não encontrada.' })
  const text = String(req.body?.text ?? '').trim()
  if (text.length < 1 || text.length > 4000) return res.status(400).json({ error: 'A mensagem deve ter entre 1 e 4.000 caracteres.' })
  const id = randomBytes(16).toString('hex')
  const createdAt = new Date().toISOString()
  db.prepare('INSERT INTO messages (id, conversation_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)').run(id, req.params.id, req.user!.id, text, createdAt)
  return res.status(201).json({ message: { id, conversationId: req.params.id, authorId: req.user!.id, author: req.user!.displayName, text, createdAt } })
})

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Prosa API request failed:', err.message)
  res.status(500).json({ error: 'O serviço encontrou um erro inesperado.' })
})

app.listen(port, () => console.log(`Prosa API listening on http://localhost:${port}`))
