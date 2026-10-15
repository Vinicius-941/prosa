import assert from 'node:assert/strict'
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
legacyDb.close()

const { db, httpServer, io } = await import('../server/index.ts')

type Account = { token: string; user: { id: string; username: string; displayName: string } }

test('two accounts connect, exchange persisted live messages, and unrelated accounts are denied', async () => {
  await new Promise<void>(resolve => httpServer.listen(0, resolve))
  const address = httpServer.address()
  assert.ok(address && typeof address !== 'string')
  const origin = `http://127.0.0.1:${address.port}`
  const base = `${origin}/api`
  const tag = Math.random().toString(36).slice(2, 10)

  async function request<T>(route: string, token?: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${base}${route}`, {
      ...init,
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
    })
    if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`)
    return response.status === 204 ? undefined as T : response.json() as Promise<T>
  }

  async function register(prefix: string, displayName: string): Promise<Account> {
    return request<Account>('/auth/register', undefined, {
      method: 'POST',
      body: JSON.stringify({ username: `${prefix}_${tag}`, displayName, password: 'SenhaDeIntegracao!2026' }),
    })
  }

  const alice = await register('alice', 'Alice Aurora')
  const bruno = await register('bruno', 'Bruno Bairro')
  const carla = await register('carla', 'Carla Costa')

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
