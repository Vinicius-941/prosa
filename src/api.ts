import { Capacitor } from '@capacitor/core'

export type ProsaUser = { id: string; username: string; displayName: string }
export type ApiReaction = { emoji: string; count: number; reactedByMe: boolean }
export type ApiReply = { id: string; author: string; text: string; deleted: boolean }
export type ApiConversation = { id: string; name: string; color: string; preview: string | null; lastMessageAt: string | null; peerUsername: string | null; unreadCount: number; communityId: string | null; communityName: string | null; channelName: string | null }
export type ApiMessage = { id: string; conversationId: string; authorId: string; author: string; text: string; createdAt: string; editedAt: string | null; deletedAt: string | null; replyTo?: ApiReply | null; reactions?: ApiReaction[]; pinned?: boolean }
export type ApiPin = { id: string; conversationId: string; authorId: string; author: string; text: string; createdAt: string; pinnedAt: string; pinnedBy: string }
export type ApiMessageSearchResult = ApiMessage & { conversationName: string }
export type ApiCommunityChannel = { id: string; conversationId: string; name: string; position?: number }
export type ApiCommunity = { id: string; name: string; inviteCode: string | null; role: 'owner' | 'admin' | 'member'; memberCount: number; channels: ApiCommunityChannel[] }
export type ApiCommunityMember = { id: string; username: string; displayName: string; role: 'owner' | 'admin' | 'member'; joinedAt: string }
export type ApiMessagePage = { messages: ApiMessage[]; nextCursor: string | null }
export type ApiSession = { id: string; label: string; createdAt: number; lastSeenAt: number; expiresAt: number; current: number }
export type ApiPerson = { id: string; userId?: string; username: string; displayName: string; relationship?: 'none' | 'incoming' | 'outgoing' | 'friend' }
export type ApiFriendData = { friends: ApiPerson[]; incoming: ApiPerson[]; outgoing: ApiPerson[] }
type AuthResult = { token: string; user: ProsaUser }

const tokenKey = 'prosa.session'
const apiServerKey = 'prosa.server'

function apiBase() {
  return (window.prosaDesktop?.apiUrl ?? import.meta.env.VITE_API_URL ?? localStorage.getItem(apiServerKey) ?? '/api').replace(/\/+$/, '')
}

function socketOrigin() {
  const base = apiBase()
  return base.startsWith('http') ? base.replace(/\/api\/?$/, '') : undefined
}

function sessionToken() { return localStorage.getItem(tokenKey) }

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body) headers.set('content-type', 'application/json')
  const token = sessionToken()
  if (token) headers.set('authorization', `Bearer ${token}`)
  const response = await fetch(`${apiBase()}${path}`, { ...options, headers })
  if (!response.ok) {
    const result = await response.json().catch(() => ({})) as { error?: string }
    throw new Error(result.error ?? `Falha na solicitação (${response.status}).`)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  isAndroid: () => Capacitor.getPlatform() === 'android',
  serverUrl: () => localStorage.getItem(apiServerKey) ?? '',
  hasServer: () => Boolean(window.prosaDesktop?.apiUrl ?? import.meta.env.VITE_API_URL ?? localStorage.getItem(apiServerKey)),
  saveServerUrl(value: string) {
    let parsed: URL
    try { parsed = new URL(value.trim()) } catch { throw new Error('Informe um endereço completo do serviço.') }
    if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('Informe apenas o endereço base do serviço, sem credenciais ou parâmetros.')
    if (parsed.protocol !== 'https:' && parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') throw new Error('O endereço do serviço precisa usar uma conexão segura (HTTPS).')
    const root = parsed.toString().replace(/\/$/, '').replace(/\/api$/, '')
    const endpoint = `${root}/api`
    localStorage.setItem(apiServerKey, endpoint)
    return endpoint
  },
  socketOrigin,
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
  async exportAccount() {
    const headers = new Headers()
    const token = sessionToken()
    if (token) headers.set('authorization', `Bearer ${token}`)
    const response = await fetch(`${apiBase()}/account/export`, { headers })
    if (!response.ok) {
      const result = await response.json().catch(() => ({})) as { error?: string }
      throw new Error(result.error ?? `Falha na solicitação (${response.status}).`)
    }
    const url = URL.createObjectURL(await response.blob())
    const link = document.createElement('a')
    link.href = url
    link.download = 'prosa-account-export.json'
    document.body.append(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
  async deleteAccount(currentPassword: string, confirmation: string) {
    await request<void>('/account', { method: 'DELETE', body: JSON.stringify({ currentPassword, confirmation }) })
    localStorage.removeItem(tokenKey)
  },
  changePassword: (currentPassword: string, newPassword: string) => request<void>('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  sessions: () => request<{ sessions: ApiSession[] }>('/sessions'),
  revokeSession: (id: string) => request<void>(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  logout: async () => { try { await request('/auth/logout', { method: 'POST' }) } finally { localStorage.removeItem(tokenKey) } },
  conversations: () => request<{ conversations: ApiConversation[] }>('/conversations'),
  communities: () => request<{ communities: ApiCommunity[] }>('/communities'),
  createCommunity: (name: string) => request<{ community: ApiCommunity }>('/communities', { method: 'POST', body: JSON.stringify({ name }) }),
  joinCommunity: (inviteCode: string) => request<{ communityId: string }>('/communities/join', { method: 'POST', body: JSON.stringify({ inviteCode }) }),
  createCommunityChannel: (communityId: string, name: string) => request<{ channel: ApiCommunityChannel }>(`/communities/${encodeURIComponent(communityId)}/channels`, { method: 'POST', body: JSON.stringify({ name }) }),
  communityMembers: (communityId: string) => request<{ members: ApiCommunityMember[] }>(`/communities/${encodeURIComponent(communityId)}/members`),
  setCommunityMemberRole: (communityId: string, userId: string, role: 'admin' | 'member') => request<{ communityId: string; userId: string; role: string }>(`/communities/${encodeURIComponent(communityId)}/members/${encodeURIComponent(userId)}/role`, { method: 'PUT', body: JSON.stringify({ role }) }),
  removeCommunityMember: (communityId: string, userId: string) => request<void>(`/communities/${encodeURIComponent(communityId)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  renameCommunity: (communityId: string, name: string) => request<{ id: string; name: string }>(`/communities/${encodeURIComponent(communityId)}`, { method: 'PATCH', body: JSON.stringify({ name }) }),
  deleteCommunity: (communityId: string) => request<void>(`/communities/${encodeURIComponent(communityId)}`, { method: 'DELETE' }),
  messages: (id: string, before?: string | null) => request<ApiMessagePage>(`/conversations/${encodeURIComponent(id)}/messages${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  messageContext: (id: string, messageId: string) => request<ApiMessagePage>(`/conversations/${encodeURIComponent(id)}/messages?around=${encodeURIComponent(messageId)}`),
  searchMessages: (query: string) => request<{ messages: ApiMessageSearchResult[] }>(`/messages/search?q=${encodeURIComponent(query)}`),
  markRead: (id: string) => request<{ lastReadRowId: number }>(`/conversations/${encodeURIComponent(id)}/read`, { method: 'POST' }),
  sendMessage: (id: string, text: string, replyToMessageId?: string) => request<{ message: ApiMessage }>(`/conversations/${encodeURIComponent(id)}/messages`, { method: 'POST', body: JSON.stringify({ text, replyToMessageId }) }),
  updateMessage: (conversationId: string, messageId: string, text: string) => request<{ message: ApiMessage }>(`/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`, { method: 'PATCH', body: JSON.stringify({ text }) }),
  deleteMessage: (conversationId: string, messageId: string) => request<void>(`/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' }),
  toggleReaction: (conversationId: string, messageId: string, emoji: string) => request<{ reaction: ApiReaction }>(`/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reactions`, { method: 'PUT', body: JSON.stringify({ emoji }) }),
  pins: (conversationId: string) => request<{ pins: ApiPin[] }>(`/conversations/${encodeURIComponent(conversationId)}/pins`),
  setPinned: (conversationId: string, messageId: string, pinned: boolean) => request<{ messageId: string; conversationId: string; pinned: boolean }>(`/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/pin`, { method: 'PUT', body: JSON.stringify({ pinned }) }),
  notificationSettings: () => request<{ settings: { conversationId: string; mutedUntil: number }[] }>('/notification-settings'),
  setMuted: (conversationId: string, muteForMs: number) => request<{ conversationId: string; mutedUntil: number }>(`/conversations/${encodeURIComponent(conversationId)}/notification-settings`, { method: 'PUT', body: JSON.stringify({ muteForMs }) }),
  searchUsers: (query: string) => request<{ users: ApiPerson[] }>(`/users/search?q=${encodeURIComponent(query)}`),
  friends: () => request<ApiFriendData>('/friends'),
  requestFriend: (username: string) => request<{ status: 'pending' | 'accepted'; id?: string; conversationId?: string }>('/friend-requests', { method: 'POST', body: JSON.stringify({ username }) }),
  dismissFriendRequest: (id: string) => request<void>(`/friend-requests/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  removeFriend: (id: string) => request<void>(`/friends/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  hasSession: () => Boolean(sessionToken()),
  sessionToken,
}
