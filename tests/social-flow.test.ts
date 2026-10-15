import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { io as connectSocket } from 'socket.io-client'

process.env.PROSA_NO_LISTEN = '1'
process.env.PROSA_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'prosa-social-'))
const legacyDb = new Database(path.join(process.env.PROSA_DATA_DIR, 'prosa.sqlite'))
legacyDb.exec("CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, color TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
legacyDb.exec("CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, password_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
legacyDb.exec("CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL)")
const legacyToken = 'legacy-existing-session-token-012345678901'
legacyDb.prepare('INSERT INTO users (id, username, display_name, password_hash) VALUES (?, ?, ?, ?)').run('legacy-user', 'legacy_user', 'Usuário anterior', 'unused')
legacyDb.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(createHash('sha256').update(legacyToken).digest('hex'), 'legacy-user', Date.now() + 60_000)
legacyDb.close()

const { db, httpServer, io } = await import('../server/index.ts')

type Account = { token: string; user: { id: string; username: string; displayName: string } }

test('two accounts connect, exchange persisted live messages, and unrelated accounts are denied', async () => {
  await new Promise<void>(resolve => httpServer.listen(0, resolve))
  const address = httpServer.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const base = `${origin}/api`
  const health = await fetch(`${base}/health`)
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), { status: 'ok', service: 'prosa' })
  const tag = Math.random().toString(36).slice(2, 10)

  async function sendHttp(route: string, token?: string, init: RequestInit = {}) {
    return fetch(`${base}${route}`, {
      ...init,
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
    })
  }

  async function request<T>(route: string, token?: string, init: RequestInit = {}): Promise<T> {
    const result = await sendHttp(route, token, init)
    if (!result.ok) throw new Error(`${result.status}: ${await result.text()}`)
    return result.status === 204 ? undefined as T : result.json() as Promise<T>
  }

  async function register(prefix: string, displayName: string): Promise<Account> {
    return request<Account>('/auth/register', undefined, {
      method: 'POST',
      body: JSON.stringify({ username: `${prefix}_${tag}`, displayName, password: 'SenhaDeIntegracao!2026' }),
    })
  }

  const migratedSessions = await request<{ sessions: { id: string; label: string }[] }>('/sessions', legacyToken)
  assert.equal(migratedSessions.sessions.length, 1)
  assert.match(migratedSessions.sessions[0].id, /^[a-f0-9]{32}$/)
  const alice = await register('alice', 'Alice Aurora')
  const bruno = await register('bruno', 'Bruno Bairro')
  const carla = await register('carla', 'Carla Costa')
  const aliceSecondSession = await request<Account>('/auth/login', undefined, {
    method: 'POST', headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64) AppleWebKit Chrome/130.0' },
    body: JSON.stringify({ username: alice.user.username, password: 'SenhaDeIntegracao!2026' }),
  })
  const aliceSessions = await request<{ sessions: { id: string; label: string; current: number }[] }>('/sessions', alice.token)
  assert.equal(aliceSessions.sessions.length, 2)
  const currentAliceSession = aliceSessions.sessions.find(session => session.current)
  assert.ok(currentAliceSession)
  const otherAliceSession = aliceSessions.sessions.find(session => !session.current)
  assert.ok(otherAliceSession)
  assert.match(otherAliceSession.label, /Windows/)
  const denySelfRevoke = await sendHttp(`/sessions/${currentAliceSession.id}`, alice.token, { method: 'DELETE' })
  assert.equal(denySelfRevoke.status, 400)
  await request<void>(`/sessions/${otherAliceSession.id}`, alice.token, { method: 'DELETE' })
  const revokedAliceSession = await sendHttp('/me', aliceSecondSession.token)
  assert.equal(revokedAliceSession.status, 401)
  assert.equal((await request<{ sessions: { id: string; current: number }[] }>('/sessions', alice.token)).sessions.length, 1)

  const search = await request<{ users: { username: string }[] }>(`/users/search?q=${bruno.user.username}`, alice.token)
  assert.ok(search.users.some(person => person.username === bruno.user.username))

  const pending = await request<{ status: string }>('/friend-requests', alice.token, {
    method: 'POST', body: JSON.stringify({ username: bruno.user.username }),
  })
  assert.equal(pending.status, 'pending')
  const inbox = await request<{ incoming: { username: string }[] }>('/friends', bruno.token)
  assert.ok(inbox.incoming.some(person => person.username === alice.user.username))

  const accepted = await request<{ status: string; conversationId: string }>('/friend-requests', bruno.token, {
    method: 'POST', body: JSON.stringify({ username: alice.user.username }),
  })
  assert.equal(accepted.status, 'accepted')

  const newCommunity = await request<{ community: { id: string; inviteCode: string; channels: { id: string; conversationId: string; name: string }[] } }>('/communities', alice.token, {
    method: 'POST', body: JSON.stringify({ name: 'Núcleo Prosa' }),
  })
  const generalChannel = newCommunity.community.channels[0]
  assert.equal(generalChannel.name, 'geral')
  assert.equal((await request<{ communities: { id: string }[] }>('/communities', bruno.token)).communities.length, 0)
  const joinedCommunity = await request<{ communityId: string }>('/communities/join', bruno.token, {
    method: 'POST', body: JSON.stringify({ inviteCode: newCommunity.community.inviteCode }),
  })
  assert.equal(joinedCommunity.communityId, newCommunity.community.id)
  const brunoCommunity = await request<{ communities: { id: string; role: string; inviteCode: string | null; channels: { conversationId: string }[] }[] }>('/communities', bruno.token)
  assert.equal(brunoCommunity.communities[0].role, 'member')
  assert.equal(brunoCommunity.communities[0].inviteCode, null)
  assert.equal(brunoCommunity.communities[0].channels[0].conversationId, generalChannel.conversationId)
  const extraChannel = await request<{ channel: { conversationId: string; name: string } }>(`/communities/${newCommunity.community.id}/channels`, alice.token, {
    method: 'POST', body: JSON.stringify({ name: 'ideias' }),
  })
  assert.equal(extraChannel.channel.name, 'ideias')
  const memberCreateChannel = await sendHttp(`/communities/${newCommunity.community.id}/channels`, bruno.token, {
    method: 'POST', body: JSON.stringify({ name: 'restrito' }),
  })
  assert.equal(memberCreateChannel.status, 403)
  const outsiderHistory = await sendHttp(`/conversations/${generalChannel.conversationId}/messages`, carla.token)
  assert.equal(outsiderHistory.status, 404)
  await request(`/conversations/${generalChannel.conversationId}/messages`, alice.token, {
    method: 'POST', body: JSON.stringify({ text: 'Mensagem da comunidade' }),
  })
  const communityHistory = await request<{ messages: { text: string }[] }>(`/conversations/${generalChannel.conversationId}/messages`, bruno.token)
  assert.equal(communityHistory.messages[0].text, 'Mensagem da comunidade')

  const aliceConversations = await request<{ conversations: { id: string }[] }>('/conversations', alice.token)
  const brunoConversations = await request<{ conversations: { id: string; unreadCount: number }[] }>('/conversations', bruno.token)
  assert.ok(aliceConversations.conversations.some(item => item.id === accepted.conversationId))
  assert.ok(brunoConversations.conversations.some(item => item.id === accepted.conversationId))
  for (let index = 1; index <= 55; index++) {
    await request(`/conversations/${accepted.conversationId}/messages`, alice.token, {
      method: 'POST', body: JSON.stringify({ text: `Histórico ${index}` }),
    })
  }
  const messageMatches = await request<{ messages: { id: string; conversationId: string; conversationName: string; text: string }[] }>('/messages/search?q=Hist%C3%B3rico%2023', bruno.token)
  assert.equal(messageMatches.messages.length, 1)
  assert.equal(messageMatches.messages[0].text, 'Histórico 23')
  assert.equal(messageMatches.messages[0].conversationId, accepted.conversationId)
  const aroundMatch = await request<{ messages: { id: string; text: string }[] }>(`/conversations/${accepted.conversationId}/messages?around=${messageMatches.messages[0].id}`, bruno.token)
  assert.equal(aroundMatch.messages.at(-1)?.id, messageMatches.messages[0].id)
  const unrelatedMatches = await request<{ messages: { id: string }[] }>('/messages/search?q=Hist%C3%B3rico', carla.token)
  assert.equal(unrelatedMatches.messages.length, 0)
  const wildcardMatches = await request<{ messages: { id: string }[] }>('/messages/search?q=%25%25', bruno.token)
  assert.equal(wildcardMatches.messages.length, 0)
  const unread = await request<{ conversations: { id: string; unreadCount: number }[] }>('/conversations', bruno.token)
  assert.equal(unread.conversations.find(item => item.id === accepted.conversationId)?.unreadCount, 55)
  const firstPage = await request<{ messages: { text: string }[]; nextCursor: string | null }>(`/conversations/${accepted.conversationId}/messages`, bruno.token)
  assert.equal(firstPage.messages.length, 50)
  assert.ok(firstPage.nextCursor)
  const secondPage = await request<{ messages: { text: string }[]; nextCursor: string | null }>(`/conversations/${accepted.conversationId}/messages?before=${encodeURIComponent(firstPage.nextCursor!)}`, bruno.token)
  assert.equal(secondPage.messages.length, 5)
  assert.equal(secondPage.nextCursor, null)
  assert.deepEqual([...secondPage.messages, ...firstPage.messages].map(item => item.text), Array.from({ length: 55 }, (_, index) => `Histórico ${index + 1}`))
  await request(`/conversations/${accepted.conversationId}/read`, bruno.token, { method: 'POST' })
  const read = await request<{ conversations: { id: string; unreadCount: number }[] }>('/conversations', bruno.token)
  assert.equal(read.conversations.find(item => item.id === accepted.conversationId)?.unreadCount, 0)

  const brunoSocket = connectSocket(origin, { auth: { token: bruno.token }, reconnection: false })
  try {
    await new Promise<void>((resolve, reject) => {
      brunoSocket.once('connect', resolve)
      brunoSocket.once('connect_error', reject)
    })
    const joined = await new Promise<{ ok: boolean }>(resolve => brunoSocket.emit('conversation:join', accepted.conversationId, resolve))
    assert.equal(joined.ok, true)
    const joinedChannel = await new Promise<{ ok: boolean }>(resolve => brunoSocket.emit('conversation:join', generalChannel.conversationId, resolve))
    assert.equal(joinedChannel.ok, true)

    const nextLiveMessage = new Promise<{ text: string }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for a live message')), 3000)
      brunoSocket.once('message:new', message => { clearTimeout(timeout); resolve(message) })
    })
    const sent = await request<{ message: { text: string } }>(`/conversations/${accepted.conversationId}/messages`, alice.token, {
      method: 'POST', body: JSON.stringify({ text: 'Mensagem em tempo real' }),
    })
    assert.equal(sent.message.text, 'Mensagem em tempo real')
    assert.equal((await nextLiveMessage).text, sent.message.text)

    const history = await request<{ messages: { text: string }[] }>(`/conversations/${accepted.conversationId}/messages`, bruno.token)
    assert.equal(history.messages.at(-1)?.text, sent.message.text)

    const deniedJoin = await new Promise<{ ok: boolean }>((resolve, reject) => {
      const carlaSocket = connectSocket(origin, { auth: { token: carla.token }, reconnection: false })
      const timer = setTimeout(() => { carlaSocket.disconnect(); reject(new Error('Timed out checking access control')) }, 3000)
      carlaSocket.once('connect_error', error => { clearTimeout(timer); carlaSocket.disconnect(); reject(error) })
      carlaSocket.once('connect', () => carlaSocket.emit('conversation:join', accepted.conversationId, result => {
        clearTimeout(timer); carlaSocket.disconnect(); resolve(result)
      }))
    })
    assert.equal(deniedJoin.ok, false)

    await request<void>(`/friends/${bruno.user.id}`, alice.token, { method: 'DELETE' })
    const revokedJoin = await new Promise<{ ok: boolean }>(resolve => brunoSocket.emit('conversation:join', accepted.conversationId, resolve))
    assert.equal(revokedJoin.ok, false)
    const removedFriends = await request<{ friends: { id: string }[] }>('/friends', alice.token)
    assert.equal(removedFriends.friends.length, 0)
    const channelAfterUnfriend = await request<{ messages: { text: string }[] }>(`/conversations/${generalChannel.conversationId}/messages`, bruno.token)
    assert.equal(channelAfterUnfriend.messages[0].text, 'Mensagem da comunidade')
    const revokedSearch = await request<{ messages: { id: string }[] }>('/messages/search?q=Hist%C3%B3rico%2023', bruno.token)
    assert.equal(revokedSearch.messages.length, 0)
    const removedConversations = await request<{ conversations: { id: string }[] }>('/conversations', bruno.token)
    assert.ok(!removedConversations.conversations.some(item => item.id === accepted.conversationId))
  } finally {
    brunoSocket.disconnect()
    await new Promise<void>(resolve => io.close(() => resolve()))
    db.close()
    rmSync(process.env.PROSA_DATA_DIR!, { recursive: true, force: true })
  }
})
