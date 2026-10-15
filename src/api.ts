export type ProsaUser = { id: string; username: string; displayName: string }
export type ApiConversation = { id: string; name: string; color: string; preview: string | null; lastMessageAt: string | null; peerUsername: string | null; unreadCount: number }
export type ApiMessage = { id: string; conversationId: string; authorId: string; author: string; text: string; createdAt: string }
export type ApiMessagePage = { messages: ApiMessage[]; nextCursor: string | null }
export type ApiPerson = { id: string; userId?: string; username: string; displayName: string; relationship?: 'none' | 'incoming' | 'outgoing' | 'friend' }
export type ApiFriendData = { friends: ApiPerson[]; incoming: ApiPerson[]; outgoing: ApiPerson[] }
type AuthResult = { token: string; user: ProsaUser }

const tokenKey = 'prosa.session'
const base = import.meta.env.VITE_API_URL ?? '/api'

function sessionToken() { return localStorage.getItem(tokenKey) }

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body) headers.set('content-type', 'application/json')
  const token = sessionToken()
  if (token) headers.set('authorization', `Bearer ${token}`)
  const response = await fetch(`${base}${path}`, { ...options, headers })
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(result.error ?? `Falha na solicitação (${response.status}).`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  async register(username: string, displayName: string, password: string) {
    const result = await request<AuthResult>('/auth/register', { method: 'POST', body: JSON.stringify({ username, displayName, password }) })
    localStorage.setItem(tokenKey, result.token)
    return result.user
  },
  async login(username: string, password: string) {
    const result = await request<AuthResult>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
    localStorage.setItem(tokenKey, result.token)
    return result.user
  },
  me: () => request<{ user: ProsaUser }>('/me'),
  logout: async () => { try { await request('/auth/logout', { method: 'POST' }) } finally { localStorage.removeItem(tokenKey) } },
  conversations: () => request<{ conversations: ApiConversation[] }>('/conversations'),
  messages: (id: string, before?: string | null) => request<ApiMessagePage>(`/conversations/${encodeURIComponent(id)}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  markRead: (id: string) => request<{ lastReadRowId: number }>(`/conversations/${encodeURIComponent(id)}/read`, { method: 'POST' }),
  sendMessage: (id: string, text: string) => request<{ message: ApiMessage }>(`/conversations/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ text }) }),
  searchUsers: (query: string) => request<{ users: ApiPerson[] }>(`/users/search?q=${encodeURIComponent(query)}`),
  friends: () => request<ApiFriendData>('/friends'),
  requestFriend: (username: string) => request<{ status: 'pending' | 'accepted'; id?: string; conversationId?: string }>('/friend-requests', { method: 'POST', body: JSON.stringify({ username }) }),
  dismissFriendRequest: (id: string) => request<void>(`/friend-requests/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  removeFriend: (id: string) => request<void>(`/friends/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  hasSession: () => Boolean(sessionToken()),
  sessionToken,
}
