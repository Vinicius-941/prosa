import { Capacitor, registerPlugin } from '@capacitor/core'

const ProsaSessionVault = registerPlugin<{ getToken(): Promise<{ value: string | null }>; setToken(options: { value: string }): Promise<void>; clearToken(): Promise<void> }>('ProsaSessionVault')

export type AvatarColor = 'violet' | 'blue' | 'green' | 'coral'
export type AvatarFrame = 'none' | 'ring' | 'spark'
export type ProsaUser = { id: string; username: string; displayName: string; bio: string; avatarColor: AvatarColor; avatarFrame: AvatarFrame }
export type ApiIdentity = { displayName: string; username: string; bio: string; avatarColor: AvatarColor; avatarFrame: AvatarFrame }
export type ApiReaction = { emoji: string; count: number; reactedByMe: boolean }
export type ApiReply = { id: string; author: string; authorAvatarColor: AvatarColor; authorAvatarFrame: AvatarFrame; text: string; deleted: boolean }
export type ApiConversation = { id: string; name: string; color: string; preview: string | null; lastMessageAt: string | null; peerUsername: string | null; peerDisplayName: string; peerBio: string; peerAvatarColor: AvatarColor; peerAvatarFrame: AvatarFrame; unreadCount: number; communityId: string | null; communityName: string | null; channelName: string | null }
export type ApiMessage = { id: string; conversationId: string; authorId: string; author: string; authorAvatarColor: AvatarColor; authorAvatarFrame: AvatarFrame; text: string; createdAt: string; editedAt: string | null; deletedAt: string | null; replyTo?: ApiReply | null; reactions?: ApiReaction[]; pinned?: boolean }
export type ApiPin = { id: string; conversationId: string; authorId: string; author: string; authorAvatarColor: AvatarColor; authorAvatarFrame: AvatarFrame; text: string; createdAt: string; pinnedAt: string; pinnedBy: string }
export type ApiMessageSearchResult = ApiMessage & { conversationName: string }
export type ApiCommunityChannel = { id: string; conversationId: string; name: string; position?: number }
export type ApiCommunity = { id: string; name: string; inviteCode: string | null; role: 'owner' | 'admin' | 'member'; memberCount: number; channels: ApiCommunityChannel[] }
export type ApiCommunityMember = ApiIdentity & { id: string; role: 'owner' | 'admin' | 'member'; joinedAt: string }
export type ApiMessagePage = { messages: ApiMessage[]; nextCursor: string | null }
export type ApiSession = { id: string; label: string; createdAt: number; lastSeenAt: number; expiresAt: number; current: number }
export type ApiPerson = ApiIdentity & { id: string; userId?: string; relationship?: 'none' | 'incoming' | 'outgoing' | 'friend' }
export type ApiFriendData = { friends: ApiPerson[]; incoming: ApiPerson[]; outgoing: ApiPerson[] }
type AuthResult = { token?: string; user: ProsaUser }

export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) { super(message); this.name = 'ApiError'; this.status = status }
}

const tokenKey = 'prosa.session'
const apiServerKey = 'prosa.server'
let legacySessionMigrationAttempted = false
let legacySessionMigrationPending = false
let csrfToken: string | null = null
const browserClient = !window.prosaDesktop && Capacitor.getPlatform() !== 'android'

function apiBase() {
  return (window.prosaDesktop?.apiUrl ?? import.meta.env.VITE_API_URL ?? localStorage.getItem(apiServerKey) ?? '/api').replace(/\/+$/, '')
}

function socketOrigin() {
  const base = apiBase()
  return base.startsWith('http') ? base.replace(/\/api\/?$/, '') : undefined
}

async function sessionToken() {
  if (browserClient) return localStorage.getItem(tokenKey)
  const desktop = window.prosaDesktop
  const android = Capacitor.getPlatform() === 'android'
  if (!desktop && !android) return localStorage.getItem(tokenKey)
  let stored: string | null
  try { stored = desktop ? await desktop.getSessionToken() : (await ProsaSessionVault.getToken()).value }
  catch (error) {
    const legacy = localStorage.getItem(tokenKey)
    if (!android || !legacy) throw error
    legacySessionMigrationPending = true
    return legacy
  }
  if (stored) return stored
  const legacy = localStorage.getItem(tokenKey)
  if (legacy && !legacySessionMigrationAttempted) {
    legacySessionMigrationAttempted = true
    try {
      if (desktop) await desktop.setSessionToken(legacy)
      else await ProsaSessionVault.setToken({ value: legacy })
      localStorage.removeItem(tokenKey)
    } catch {
      legacySessionMigrationPending = true
      return legacy
    }
  }
  return legacy
}

async function storeSession(token: string) {
  if (window.prosaDesktop || Capacitor.getPlatform() === 'android') {
    try {
      if (window.prosaDesktop) await window.prosaDesktop.setSessionToken(token)
      else await ProsaSessionVault.setToken({ value: token })
      localStorage.removeItem(tokenKey)
    } catch (error) {
      await fetch(`${apiBase()}/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } }).catch(() => undefined)
      throw error
    }
  } else localStorage.setItem(tokenKey, token)
}

async function clearSession() {
  try {
    if (window.prosaDesktop) await window.prosaDesktop.clearSessionToken()
    else if (Capacitor.getPlatform() === 'android') await ProsaSessionVault.clearToken()
  } finally { localStorage.removeItem(tokenKey) }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers)
  if (options.body) headers.set('content-type', 'application/json')
  if (browserClient) {
    headers.set('x-prosa-client', 'web')
    if (options.method && !['GET', 'HEAD', 'OPTIONS'].includes(options.method.toUpperCase())) {
      if (!csrfToken) {
        const response = await fetch(`${apiBase()}/auth/csrf`, { headers: { 'x-prosa-client': 'web' }, credentials: 'include' })
        if (!response.ok) throw new ApiError('Não foi possível iniciar uma sessão segura.', response.status)
        csrfToken = (await response.json() as { token: string }).token
      }
      headers.set('x-prosa-csrf', csrfToken)
    }
  }
  const token = await sessionToken()
  if (token) headers.set('authorization', `Bearer ${token}`)
  const response = await fetch(`${apiBase()}${path}`, { ...options, headers, ...(browserClient ? { credentials: 'include' as const } : {}) })
  if (response.headers.get('x-prosa-session-migrated') === '1') localStorage.removeItem(tokenKey)
  if (!response.ok) {
    if (browserClient && response.status === 401) localStorage.removeItem(tokenKey)
    const result = await response.json().catch(() => ({})) as { error?: string }
    throw new ApiError(result.error ?? `Falha na solicitação (${response.status}).`, response.status)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  isAndroid: () => Capacitor.getPlatform() === 'android',
  desktopPlatform: () => window.prosaDesktop?.platform === 'win32' ? 'windows' : window.prosaDesktop?.platform === 'linux' ? 'linux' : Capacitor.getPlatform() === 'android' ? 'android' : 'web',
  supportsStartupSettings: () => Boolean(window.prosaDesktop && ['win32', 'linux'].includes(window.prosaDesktop.platform)),
  getStartupEnabled: () => window.prosaDesktop!.getStartupEnabled(),
  setStartupEnabled: (enabled: boolean) => window.prosaDesktop!.setStartupEnabled(enabled),
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
    if (result.token) await storeSession(result.token)
    else localStorage.removeItem(tokenKey)
    return result.user
  },
  async login(username: string, password: string) {
    const result = await request<AuthResult>('/auth/login', { method: 'POST', body: JSON.stringify({ username, password }) })
    if (result.token) await storeSession(result.token)
    else localStorage.removeItem(tokenKey)
    return result.user
  },
  me: () => request<{ user: ProsaUser }>('/me'),
  updateProfile: (profile: Pick<ProsaUser, 'displayName' | 'username' | 'bio' | 'avatarColor' | 'avatarFrame'>) => request<{ user: ProsaUser }>('/me', { method: 'PATCH', body: JSON.stringify(profile) }),
  async exportAccount() {
    const headers = new Headers()
    const token = await sessionToken()
    if (token) headers.set('authorization', `Bearer ${token}`)
    if (browserClient) headers.set('x-prosa-client', 'web')
    const response = await fetch(`${apiBase()}/account/export`, { headers, ...(browserClient ? { credentials: 'include' as const } : {}) })
    if (response.headers.get('x-prosa-session-migrated') === '1') localStorage.removeItem(tokenKey)
    if (!response.ok) {
      if (browserClient && response.status === 401) localStorage.removeItem(tokenKey)
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
    csrfToken = null
    await clearSession()
  },
  changePassword: (currentPassword: string, newPassword: string) => request<void>('/auth/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword }) }),
  sessions: () => request<{ sessions: ApiSession[] }>('/sessions'),
  revokeSession: (id: string) => request<void>(`/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  logout: async () => { try { await request('/auth/logout', { method: 'POST' }) } finally { csrfToken = null; await clearSession() } },
  conversations: () => request<{ conversations: ApiConversation[] }>('/conversations'),
  communities: () => request<{ communities: ApiCommunity[] }>('/communities'),
  createCommunity: (name: string) => request<{ community: ApiCommunity }>('/communities', { method: 'POST', body: JSON.stringify({ name }) }),
  joinCommunity: (inviteCode: string) => request<{ communityId: string }>('/communities/join', { method: 'POST', body: JSON.stringify({ inviteCode }) }),
  rotateCommunityInvite: (communityId: string) => request<{ communityId: string; inviteCode: string }>(`/communities/${encodeURIComponent(communityId)}/invite/rotate`, { method: 'POST' }),
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
  hasSession: async () => {
    if (!browserClient) return Boolean(await sessionToken())
    try { await request('/auth/session'); return true }
    catch (error) { if (error instanceof ApiError && error.status === 401) return false; throw error }
  },
  hasPendingSecureSessionMigration: () => legacySessionMigrationPending,
  sessionToken,
}
