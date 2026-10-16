import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import './App.css'
import { AccountDataControls } from './AccountDataControls'
import { VoiceCall } from './VoiceCall'
import { api, ApiError, type ApiCommunity, type ApiCommunityMember, type ApiConversation, type ApiFriendData, type ApiMessage, type ApiMessageSearchResult, type ApiPerson, type ApiPin, type ApiSession, type ProsaUser } from './api'
import { io } from 'socket.io-client'

type Message = { id: string; author: string; avatarName: string; avatarColor: ProsaUser['avatarColor']; avatarFrame: ProsaUser['avatarFrame']; time: string; text: string; mine?: boolean; edited?: boolean; deleted?: boolean; pinned?: boolean; replyTo?: { id: string; author: string; authorAvatarColor: ProsaUser['avatarColor']; authorAvatarFrame: ProsaUser['avatarFrame']; text: string; deleted: boolean } | null; reactions?: { emoji: string; count: number; reactedByMe: boolean }[] }
type Conversation = { id: string; name: string; handle: string; initials: string; color: string; avatarFrame: ProsaUser['avatarFrame']; avatarName: string; online?: boolean; preview: string; time: string; unreadCount: number; olderCursor: string | null; communityId: string | null; communityName: string | null; messages: Message[] }

function localTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function fromApiMessage(message: ApiMessage, user: ProsaUser): Message {
  const mine = message.authorId === user.id
  return { id: message.id, author: mine ? 'Você' : message.author, avatarName: mine ? user.displayName : message.author, avatarColor: mine ? user.avatarColor : message.authorAvatarColor, avatarFrame: mine ? user.avatarFrame : message.authorAvatarFrame, time: localTime(message.createdAt), text: message.text, mine, edited: Boolean(message.editedAt), deleted: Boolean(message.deletedAt), pinned: Boolean(message.pinned), replyTo: message.replyTo ?? null, reactions: message.reactions ?? [] }
}

function fromApiConversation(conversation: ApiConversation, page: { messages: ApiMessage[]; nextCursor: string | null }, user: ProsaUser): Conversation {
  const name = conversation.channelName ?? conversation.name
  const direct = !conversation.communityId && Boolean(conversation.peerUsername)
  const ownSpace = !conversation.communityId && !conversation.peerUsername
  const avatarName = direct || ownSpace ? conversation.peerDisplayName : name
  const color = conversation.communityId ? ['coral', 'blue', 'violet', 'green'][parseInt(conversation.id.slice(0, 2), 16) % 4] : conversation.peerAvatarColor
  const messages = page.messages
  return { id: conversation.id, name, handle: conversation.communityName ?? (conversation.peerUsername ? `@${conversation.peerUsername}` : `@${user.username}`), initials: avatarName.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(), color, avatarFrame: conversation.communityId ? 'none' : conversation.peerAvatarFrame, avatarName, communityId: conversation.communityId, communityName: conversation.communityName, unreadCount: conversation.unreadCount, olderCursor: page.nextCursor, preview: conversation.preview ?? 'Conversa criada', time: conversation.lastMessageAt ? localTime(conversation.lastMessageAt) : 'agora', messages: messages.map(message => fromApiMessage(message, user)) }
}

function ProfileAvatar({ name, color, frame = 'none', className = '', online = false }: { name: string; color: ProsaUser['avatarColor']; frame?: ProsaUser['avatarFrame']; className?: string; online?: boolean }) {
  const initials = name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toLocaleUpperCase('pt-BR') || '?'
  return <span className={`avatar ${color} frame-${frame} ${className}`}>{initials}{online && <i />}</span>
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>, plus: <><path d="M12 5v14M5 12h14"/></>, users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.9l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1 0 1.9Z" transform="translate(-1 -1)"/></>,
    message: <><path d="M21 11.5a8.5 8.5 0 0 1-12.7 7.4L3 20l1.1-4.3A8.5 8.5 0 1 1 21 11.5Z"/></>, community: <><path d="M4 5.5 12 2l8 3.5v8L12 18l-8-4.5z"/><path d="M4 5.5 12 10l8-4.5M12 10v8M7 16.5l8-4.5"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>, paperclip: <path d="m21.4 11.1-8.5 8.5a5.7 5.7 0 0 1-8.1-8.1l9.2-9.2a3.8 3.8 0 0 1 5.4 5.4l-9.2 9.2a1.9 1.9 0 0 1-2.7-2.7l8.5-8.5"/>,
    smile: <><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></>,
    video: <><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/></>, phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.2-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.8 2.1Z"/>,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function useDialogFocus(open: boolean, dialogRef: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose }, [onClose])
  useEffect(() => {
    const targetDialog = dialogRef.current
    if (!open || !targetDialog) return
    const dialog = targetDialog
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(element => !element.hidden && element.getAttribute('aria-hidden') !== 'true')
    ;(dialog.querySelector<HTMLElement>('[autofocus],input:not([disabled])') ?? focusables()[0])?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const items = focusables()
      if (!items.length) { event.preventDefault(); dialog.focus(); return }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      if (previous?.isConnected) previous.focus()
    }
  }, [open, dialogRef])
}

function App() {
  const [chats, setChats] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState('')
  const [query, setQuery] = useState('')
  const [searchResults, setSearchResults] = useState<{ query: string; userId: string; messages: ApiMessageSearchResult[] } | null>(null)
  const [draft, setDraft] = useState('')
  const [editingMessageId, setEditingMessageId] = useState('')
  const [editDraft, setEditDraft] = useState('')
  const [replyingTo, setReplyingTo] = useState<Message | null>(null)
  const [reactionPickerId, setReactionPickerId] = useState('')
  const [pins, setPins] = useState<ApiPin[]>([])
  const [pinsOpen, setPinsOpen] = useState(false)
  const [voiceCallOpen, setVoiceCallOpen] = useState(false)
  const [voiceCallStartSignal, setVoiceCallStartSignal] = useState(0)
  const [voiceCallStartMode, setVoiceCallStartMode] = useState<'audio' | 'video'>('audio')
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false)
  const [networkState, setNetworkState] = useState<'connecting' | 'connected' | 'reconnecting' | 'offline'>(() => navigator.onLine ? 'connecting' : 'offline')
  const [restoreError, setRestoreError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [mutedUntil, setMutedUntil] = useState(0)
  const [notice, setNotice] = useState('')
  const [user, setUser] = useState<ProsaUser | null>(null)
  const [people, setPeople] = useState<ApiFriendData>({ friends: [], incoming: [], outgoing: [] })
  const [activeView, setActiveView] = useState<'messages' | 'friends' | 'communities' | 'security' | 'settings'>('messages')
  const [communities, setCommunities] = useState<ApiCommunity[]>([])
  const [selectedCommunityId, setSelectedCommunityId] = useState('')
  const [communityNameDraft, setCommunityNameDraft] = useState('')
  const [inviteCodeDraft, setInviteCodeDraft] = useState('')
  const [communityError, setCommunityError] = useState('')
  const [channelNameDraft, setChannelNameDraft] = useState('')
  const [communityMembers, setCommunityMembers] = useState<ApiCommunityMember[]>([])
  const [communityRenameDraft, setCommunityRenameDraft] = useState('')
  const [communityDialog, setCommunityDialog] = useState<'create' | 'join' | null>(null)
  const [profileOpen, setProfileOpen] = useState(false)
  const [profileDraft, setProfileDraft] = useState({ displayName: '', username: '', bio: '', avatarColor: 'violet' as ProsaUser['avatarColor'], avatarFrame: 'none' as ProsaUser['avatarFrame'] })
  const [communityPickerId, setCommunityPickerId] = useState('')
  const [sessions, setSessions] = useState<ApiSession[]>([])
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [startupEnabled, setStartupEnabled] = useState(false)
  const [startupLoading, setStartupLoading] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(() => localStorage.getItem('prosa.reduce-motion') === 'true')
  const [currentPasswordDraft, setCurrentPasswordDraft] = useState('')
  const [newPasswordDraft, setNewPasswordDraft] = useState('')
  const [confirmPasswordDraft, setConfirmPasswordDraft] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [addContactOpen, setAddContactOpen] = useState(false)
  const [peopleQuery, setPeopleQuery] = useState('')
  const [peopleResults, setPeopleResults] = useState<ApiPerson[]>([])
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register')
  const [authName, setAuthName] = useState('')
  const [authUsername, setAuthUsername] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [serverDraft, setServerDraft] = useState(() => api.serverUrl().replace(/\/api$/, ''))
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const active = chats.find(chat => chat.id === activeId) ?? chats[0]
  const voiceCallEnabled = Boolean(active && user && !active.communityId && active.handle !== `@${user.username}`)
  const activeConversationId = active?.id
  const visiblePins = pins.filter(pin => pin.conversationId === activeConversationId)
  const muted = Boolean(mutedUntil)
  const selectedCommunity = communities.find(community => community.id === selectedCommunityId) ?? communities[0]
  const chatsRef = useRef(chats)
  const messageScrollRef = useRef<HTMLDivElement>(null)
  const preserveScrollRef = useRef<{ height: number; top: number } | null>(null)
  const nearBottomRef = useRef(true)
  const renderedMessageCountRef = useRef(0)
  const renderedConversationIdRef = useRef('')
  const messagesViewVisibleRef = useRef(false)
  const socketRef = useRef<ReturnType<typeof io> | null>(null)
  const pendingMessageIdRef = useRef<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const mobileNavigationRef = useRef<HTMLElement>(null)
  const accountMenuRef = useRef<HTMLDivElement>(null)
  const accountMenuTriggerRef = useRef<HTMLButtonElement>(null)
  const addContactDialogRef = useRef<HTMLElement>(null)
  const communityDialogRef = useRef<HTMLElement>(null)
  const profileDialogRef = useRef<HTMLElement>(null)
  const filtered = useMemo(() => chats.filter(chat => `${chat.name} ${chat.handle}`.toLowerCase().includes(query.toLowerCase())), [chats, query])
  const personalChats = filtered.filter(chat => chat.handle === `@${user?.username}`)
  const directChats = filtered.filter(chat => !chat.communityId && chat.handle !== `@${user?.username}`)
  const channelChats = filtered.filter(chat => Boolean(chat.communityId))

  useDialogFocus(mobileNavigationOpen, mobileNavigationRef, () => setMobileNavigationOpen(false))
  useDialogFocus(addContactOpen, addContactDialogRef, () => setAddContactOpen(false))
  useDialogFocus(Boolean(communityDialog), communityDialogRef, () => setCommunityDialog(null))
  useDialogFocus(profileOpen, profileDialogRef, () => setProfileOpen(false))

  async function saveProfile(event: FormEvent) {
    event.preventDefault()
    try {
      const { user: updated } = await api.updateProfile(profileDraft)
      setUser(updated)
      setProfileOpen(false)
      setNotice('Perfil atualizado.')
      void Promise.all([refreshConversations(updated), refreshPeople(), refreshCommunities()]).catch(error => setNotice(error instanceof Error ? error.message : 'Perfil salvo; não foi possível atualizar todas as listas.'))
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível salvar seu perfil.') }
  }

  async function changeStartupSetting(enabled: boolean) {
    setStartupLoading(true)
    try { await api.setStartupEnabled(enabled); setStartupEnabled(enabled); setNotice(enabled ? 'O Prosa iniciará com o sistema.' : 'O início automático foi desativado.') }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível alterar a inicialização do sistema.') }
    finally { setStartupLoading(false) }
  }

  function changeReducedMotion(enabled: boolean) {
    setReducedMotion(enabled)
    setNotice(enabled ? 'Animações reduzidas.' : 'Animações padrão restauradas.')
  }

  function conversationButton(chat: Conversation, mobile = false) {
    const activeChat = activeId === chat.id
    return <button key={chat.id} className={`conversation ${activeChat ? 'active' : ''}`} aria-current={activeChat ? 'true' : undefined} onClick={() => void openConversation(chat.id)}>
      {chat.communityId ? <span className={`avatar ${chat.color}`}>{chat.initials}</span> : <ProfileAvatar name={chat.avatarName} color={chat.color as ProsaUser['avatarColor']} frame={chat.avatarFrame} online={chat.online} />}<span className="conversation-copy"><span className="conversation-top"><strong>{chat.name}</strong><time>{chat.time}</time></span><span className="conversation-bottom"><span>{chat.communityName ? `${chat.communityName} · ${chat.name} · ${chat.preview}` : chat.preview}</span>{chat.unreadCount > 0 && <i className="unread-dot" title={`${chat.unreadCount} mensagens não lidas`} aria-label={`${chat.unreadCount} mensagens não lidas`} />}</span></span>{mobile && chat.communityId && <span className="sr-only">Canal de comunidade</span>}
    </button>
  }

  function recentConversationGroups(mobile = false) {
    if (query.trim().length >= 2) return filtered.length ? filtered.map(chat => conversationButton(chat, mobile)) : <p className="empty-people">Nenhuma conversa encontrada.</p>
    return <>
      {directChats.length > 0 && <section className="conversation-group"><h3>Conversas diretas</h3>{directChats.map(chat => conversationButton(chat, mobile))}</section>}
      {personalChats.length > 0 && <section className="conversation-group"><h3>Seu espaço</h3>{personalChats.map(chat => conversationButton(chat, mobile))}</section>}
      {channelChats.length > 0 && <section className="conversation-group"><h3>Canais</h3>{channelChats.map(chat => conversationButton(chat, mobile))}</section>}
      {!filtered.length && <p className="empty-people">Suas conversas aparecerão aqui quando você se conectar com alguém.</p>}
    </>
  }

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const mac = /mac/i.test(navigator.platform)
      const modifier = mac ? event.metaKey : event.ctrlKey
      const target = event.target
      const editing = target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      if (modifier && event.key.toLowerCase() === 'k' && !event.altKey && !event.shiftKey && !event.isComposing && !editing) {
        event.preventDefault()
        searchInputRef.current?.focus()
      }
      if (event.key === 'Escape') {
        setEmojiPickerOpen(false)
        setAccountMenuOpen(false)
        setPinsOpen(false)
      }
    }
    window.addEventListener('keydown', keydown)
    const offline = () => setNetworkState('offline')
    const online = () => { setNetworkState('reconnecting'); socketRef.current?.disconnect().connect() }
    window.addEventListener('offline', offline)
    window.addEventListener('online', online)
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('offline', offline); window.removeEventListener('online', online) }
  }, [])

  useEffect(() => {
    if (!accountMenuOpen) return
    const closeOutside = (event: PointerEvent) => { if (event.target instanceof Node && !accountMenuRef.current?.contains(event.target)) setAccountMenuOpen(false) }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [accountMenuOpen])

  useEffect(() => {
    if (!accountMenuOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); setAccountMenuOpen(false); accountMenuTriggerRef.current?.focus() }
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [accountMenuOpen])

  useEffect(() => { chatsRef.current = chats }, [chats])

  useEffect(() => { document.documentElement.classList.toggle('user-reduced-motion', reducedMotion); localStorage.setItem('prosa.reduce-motion', String(reducedMotion)) }, [reducedMotion])

  useEffect(() => {
    if (activeView !== 'settings' || !api.supportsStartupSettings()) return
    let mounted = true
    void api.getStartupEnabled().then(value => { if (mounted) setStartupEnabled(value) }).catch(error => { if (mounted) setNotice(error instanceof Error ? error.message : 'Não foi possível ler a inicialização do sistema.') }).finally(() => { if (mounted) setStartupLoading(false) })
    return () => { mounted = false }
  }, [activeView])

  useLayoutEffect(() => {
    if (activeView !== 'messages' || !active) {
      messagesViewVisibleRef.current = false
      return
    }
    const scroller = messageScrollRef.current
    if (!scroller) { messagesViewVisibleRef.current = false; return }
    const conversationChanged = !messagesViewVisibleRef.current || renderedConversationIdRef.current !== active.id
    messagesViewVisibleRef.current = true
    if (conversationChanged) {
      renderedConversationIdRef.current = active.id
      preserveScrollRef.current = null
      if (pendingMessageIdRef.current) {
        const target = scroller.querySelector(`[data-message-id="${pendingMessageIdRef.current}"]`)
        target?.scrollIntoView({ block: 'center' })
        pendingMessageIdRef.current = null
      } else scroller.scrollTop = scroller.scrollHeight
      nearBottomRef.current = true
      renderedMessageCountRef.current = active.messages.length
    } else if (pendingMessageIdRef.current) {
      const target = scroller.querySelector(`[data-message-id="${pendingMessageIdRef.current}"]`)
      target?.scrollIntoView({ block: 'center' })
      pendingMessageIdRef.current = null
    } else if (preserveScrollRef.current) {
      const previous = preserveScrollRef.current
      scroller.scrollTop = previous.top + scroller.scrollHeight - previous.height
      preserveScrollRef.current = null
    } else if (active && renderedMessageCountRef.current !== active.messages.length && nearBottomRef.current) {
      scroller.scrollTop = scroller.scrollHeight
    }
    renderedMessageCountRef.current = active?.messages.length ?? 0
  }, [active, activeView])

  async function refreshConversations(currentUser = user) {
    if (!currentUser) return
    const { conversations } = await api.conversations()
    const mapped = await Promise.all(conversations.map(async conversation => {
      const page = await api.messages(conversation.id)
      return fromApiConversation(conversation, page, currentUser)
    }))
    setChats(mapped)
    setActiveId(current => mapped.some(chat => chat.id === current) ? current : mapped[0]?.id ?? '')
  }

  async function refreshSessions() {
    setLoadingSessions(true)
    try { setSessions((await api.sessions()).sessions) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível carregar as sessões.') }
    finally { setLoadingSessions(false) }
  }

  async function refreshPeople() {
    setPeople(await api.friends())
  }

  async function refreshCommunities() {
    const result = await api.communities()
    setCommunities(result.communities)
    setSelectedCommunityId(current => result.communities.some(item => item.id === current) ? current : result.communities[0]?.id ?? '')
    setCommunityPickerId(current => result.communities.some(item => item.id === current) ? current : result.communities[0]?.id ?? '')
  }

  useEffect(() => {
    if (!user || peopleQuery.trim().replace(/^@/, '').length < 2) return
    let active = true
    const timer = window.setTimeout(() => {
      api.searchUsers(peopleQuery).then(result => { if (active) setPeopleResults(result.users) }).catch(error => { if (active) setNotice(error instanceof Error ? error.message : 'A busca falhou.') })
    }, 180)
    return () => { active = false; window.clearTimeout(timer) }
  }, [peopleQuery, user])

  useEffect(() => {
    const term = query.trim()
    if (!user || activeView !== 'messages' || term.length < 2) return
    let current = true
    const timer = window.setTimeout(() => {
      api.searchMessages(term).then(result => { if (current) setSearchResults({ query: term, userId: user.id, messages: result.messages }) })
        .catch(error => { if (current) setNotice(error instanceof Error ? error.message : 'A busca falhou.') })
    }, 250)
    return () => { current = false; window.clearTimeout(timer) }
  }, [query, activeView, user])

  useEffect(() => {
    let mounted = true
    void (async () => {
      try {
        if (!await api.hasSession()) return
        if (api.hasPendingSecureSessionMigration()) setNotice('Não foi possível proteger a sessão antiga com o chaveiro do sistema. Ela continua ativa neste dispositivo; configure o chaveiro e entre novamente para migrá-la.')
        const { user: currentUser } = await api.me()
        if (!mounted) return
        setUser(currentUser)
        const [{ conversations }, nextPeople, nextCommunities] = await Promise.all([api.conversations(), api.friends(), api.communities()])
        const mapped = await Promise.all(conversations.map(async conversation => {
          const page = await api.messages(conversation.id)
          return fromApiConversation(conversation, page, currentUser)
        }))
        if (mounted) { setChats(mapped); setActiveId(mapped[0]?.id ?? ''); setPeople(nextPeople); setCommunities(nextCommunities.communities); setSelectedCommunityId(nextCommunities.communities[0]?.id ?? ''); setCommunityPickerId(nextCommunities.communities[0]?.id ?? ''); setNetworkState('connected') }
      } catch (error) {
        if (!mounted) return
        if (error instanceof ApiError && error.status === 401) void api.logout()
        else {
          setRestoreError(error instanceof Error ? error.message : 'Não foi possível conectar ao serviço. Sua sessão foi preservada; verifique a conexão e tente novamente.')
          setNetworkState(navigator.onLine ? 'reconnecting' : 'offline')
        }
      } finally { if (mounted) setLoading(false) }
    })()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!user) return
    const timer = window.setInterval(() => { void refreshPeople().catch(() => undefined) }, 6000)
    return () => window.clearInterval(timer)
  }, [user])

  useEffect(() => {
    if (!user || !activeConversationId) return
    const socket = io(api.socketOrigin(), { auth: callback => { void api.sessionToken().then(token => callback(token ? { token } : {})) }, withCredentials: api.desktopPlatform() === 'web', reconnection: true, reconnectionDelayMax: 5000 })
    socketRef.current = socket
    socket.on('connect', () => { setNetworkState('connected'); socket.emit('conversation:join', activeConversationId, (result: { ok: boolean }) => {
      if (!result.ok) setNotice('Esta conversa não está mais disponível.')
    }) })
    socket.on('disconnect', () => setNetworkState(navigator.onLine ? 'reconnecting' : 'offline'))
    socket.on('connect_error', () => setNetworkState(navigator.onLine ? 'reconnecting' : 'offline'))
    socket.on('session:expired', () => { void signOut().then(() => setNotice('Sua sessão expirou. Entre novamente para continuar.')) })
    socket.on('conversations:changed', () => { void refreshConversations(user).catch(() => undefined) })
    socket.on('contacts:changed', () => { void refreshPeople().catch(() => undefined) })
    socket.on('communities:changed', () => { void refreshCommunities().catch(() => undefined); if (selectedCommunityId) void refreshCommunityMembers(selectedCommunityId).catch(() => undefined) })
    socket.on('message:new', (message: ApiMessage) => {
      const mapped = fromApiMessage(message, user)
      const found = chatsRef.current.some(chat => chat.id === message.conversationId)
      const isOpen = message.conversationId === activeConversationId
      setChats(current => current.map(chat => {
        if (chat.id !== message.conversationId) return chat
        const alreadyLoaded = chat.messages.some(existing => existing.id === message.id)
        return { ...chat, preview: message.text, time: mapped.time, unreadCount: message.authorId !== user.id && !isOpen ? chat.unreadCount + 1 : chat.unreadCount, messages: !alreadyLoaded && isOpen ? [...chat.messages, mapped] : chat.messages }
      }))
      if (isOpen && message.authorId !== user.id) void api.markRead(message.conversationId).catch(() => undefined)
      if (isOpen && message.authorId !== user.id) setAnnouncement(`Nova mensagem de ${mapped.author}`)
      if (!found) void refreshConversations(user).catch(() => undefined)
    })
    socket.on('message:updated', (message: ApiMessage) => {
      const mapped = fromApiMessage(message, user)
      setChats(current => current.map(chat => chat.id !== message.conversationId ? chat : {
        ...chat, preview: chat.messages.at(-1)?.id === message.id ? message.text : chat.preview,
        messages: chat.messages.map(existing => existing.id === message.id ? mapped : existing),
      }))
    })
    socket.on('message:deleted', (event: { id: string; conversationId: string }) => {
      setChats(current => current.map(chat => chat.id !== event.conversationId ? chat : {
        ...chat, preview: chat.messages.at(-1)?.id === event.id ? 'Mensagem removida' : chat.preview,
        messages: chat.messages.map(existing => existing.id === event.id ? { ...existing, text: '', deleted: true, reactions: [] } : existing.replyTo?.id === event.id ? { ...existing, replyTo: { ...existing.replyTo, text: '', deleted: true } } : existing),
      }))
      setReplyingTo(current => current?.id === event.id ? null : current)
      setSearchResults(current => current ? { ...current, messages: current.messages.filter(message => message.id !== event.id) } : current)
    })
    socket.on('message:reaction', (event: { messageId: string; conversationId: string; userId: string; emoji: string; count: number; reactedByMe: boolean }) => {
      setChats(current => current.map(chat => chat.id !== event.conversationId ? chat : {
        ...chat,
        messages: chat.messages.map(message => {
          if (message.id !== event.messageId) return message
          const reactions = message.reactions ?? []
          const next = reactions.filter(reaction => reaction.emoji !== event.emoji)
          if (event.count > 0) next.push({ emoji: event.emoji, count: event.count, reactedByMe: event.userId === user.id && event.reactedByMe })
          return { ...message, reactions: next }
        }),
      }))
    })
    socket.on('message:pinned', (event: { messageId: string; conversationId: string; pinned: boolean }) => {
      setChats(current => current.map(chat => chat.id === event.conversationId ? { ...chat, messages: chat.messages.map(message => message.id === event.messageId ? { ...message, pinned: event.pinned } : message) } : chat))
      if (!event.pinned) setPins(current => current.filter(pin => pin.id !== event.messageId))
      else if (event.conversationId === activeConversationId) void api.pins(event.conversationId).then(result => setPins(result.pins)).catch(() => {})
    })
    socket.on('notification:new', (event: { conversationId: string; messageId: string; author: string; preview: string }) => {
      if (event.conversationId !== activeConversationId) setNotice(`${event.author}: ${event.preview}`)
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') new Notification(`${event.author} · Prosa`, { body: event.preview, tag: event.conversationId })
    })
    return () => { if (socketRef.current === socket) socketRef.current = null; socket.emit('conversation:leave', activeConversationId); socket.disconnect() }
  }, [activeConversationId, selectedCommunityId, user])

  useEffect(() => {
    if (!activeConversationId || activeView !== 'messages') return
    api.notificationSettings().then(result => setMutedUntil(result.settings.find(item => item.conversationId === activeConversationId)?.mutedUntil ?? 0)).catch(() => setMutedUntil(0))
  }, [activeConversationId, activeView])

  useEffect(() => {
    if (!activeConversationId || activeView !== 'messages') return
    let mounted = true
    api.pins(activeConversationId).then(result => { if (mounted) setPins(result.pins) }).catch(() => { if (mounted) setPins([]) })
    return () => { mounted = false }
  }, [activeConversationId, activeView])

  async function submitAuth(event: FormEvent) {
    event.preventDefault()
    if (api.isAndroid() && !api.hasServer()) { setNotice('Configure o endereço HTTPS do serviço antes de entrar.'); return }
    setBusy(true); setNotice('')
    try {
      const nextUser = authMode === 'register'
        ? await api.register(authUsername, authName, authPassword)
        : await api.login(authUsername, authPassword)
      setUser(nextUser)
      setRestoreError('')
      setNetworkState('connected')
      setChats([])
      await Promise.all([refreshConversations(nextUser), refreshPeople(), refreshCommunities()])
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível entrar.') }
    finally { setBusy(false) }
  }

  async function changePassword(event: FormEvent) {
    event.preventDefault()
    if (newPasswordDraft !== confirmPasswordDraft) { setNotice('As novas senhas não coincidem.'); return }
    setChangingPassword(true)
    try {
      await api.changePassword(currentPasswordDraft, newPasswordDraft)
      setCurrentPasswordDraft(''); setNewPasswordDraft(''); setConfirmPasswordDraft('')
      await refreshSessions()
      setNotice('Senha alterada. Os outros dispositivos foram desconectados.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível alterar a senha.') }
    finally { setChangingPassword(false) }
  }

  async function revokeSession(session: ApiSession) {
    try {
      await api.revokeSession(session.id)
      setSessions(current => current.filter(item => item.id !== session.id))
      setNotice(`Sessão encerrada: ${session.label}.`)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível encerrar a sessão.') }
  }

  async function signOut() {
    await api.logout().catch(() => undefined)
    setUser(null); setChats([]); setPeople({ friends: [], incoming: [], outgoing: [] }); setCommunities([]); setSelectedCommunityId(''); setSessions([]); setPeopleResults([]); setActiveId(''); setNotice('')
  }

  async function createCommunity(event: FormEvent) {
    event.preventDefault()
    try {
      const { community } = await api.createCommunity(communityNameDraft)
      setCommunityNameDraft('')
      setSelectedCommunityId(community.id)
      setNotice(`Comunidade “${community.name}” criada.`)
      await Promise.all([refreshCommunities(), refreshConversations()])
      setCommunityDialog(null)
      setActiveView('messages')
      if (community.channels[0]) await openConversation(community.channels[0].conversationId)
    } catch (error) { setCommunityError(error instanceof Error ? error.message : 'Não foi possível criar a comunidade.') }
  }

  async function joinCommunity(event: FormEvent) {
    event.preventDefault()
    try {
      const { communityId } = await api.joinCommunity(inviteCodeDraft)
      setInviteCodeDraft('')
      setSelectedCommunityId(communityId)
      setNotice('Você entrou na comunidade.')
      await Promise.all([refreshCommunities(), refreshConversations()])
      setCommunityDialog(null)
    } catch (error) { setCommunityError(error instanceof Error ? error.message : 'Não foi possível entrar na comunidade.') }
  }

  async function createChannel(event: FormEvent) {
    event.preventDefault()
    if (!selectedCommunity) return
    try {
      await api.createCommunityChannel(selectedCommunity.id, channelNameDraft)
      setChannelNameDraft('')
      await Promise.all([refreshCommunities(), refreshConversations()])
      setNotice('Canal criado.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível criar o canal.') }
  }

  async function refreshCommunityMembers(communityId: string) {
    try { const result = await api.communityMembers(communityId); setCommunityMembers(result.members) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível carregar participantes.') }
  }

  async function renameSelectedCommunity(event: FormEvent) {
    event.preventDefault()
    if (!selectedCommunity) return
    try {
      await api.renameCommunity(selectedCommunity.id, communityRenameDraft)
      setCommunityRenameDraft('')
      await refreshCommunities()
      setNotice('Comunidade renomeada.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível renomear a comunidade.') }
  }

  async function deleteSelectedCommunity() {
    if (!selectedCommunity || selectedCommunity.role !== 'owner') return
    if (!window.confirm(`Excluir “${selectedCommunity.name}” e todos os seus canais? Essa ação não pode ser desfeita.`)) return
    try {
      await api.deleteCommunity(selectedCommunity.id)
      setCommunityMembers([])
      await refreshCommunities()
      await refreshConversations(user!)
      setNotice('Comunidade excluída.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível excluir a comunidade.') }
  }

  async function changeCommunityRole(member: ApiCommunityMember) {
    if (!selectedCommunity) return
    const role = member.role === 'admin' ? 'member' : 'admin'
    try { await api.setCommunityMemberRole(selectedCommunity.id, member.id, role); await refreshCommunityMembers(selectedCommunity.id); await refreshCommunities() }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível alterar o cargo.') }
  }

  async function removeCommunityMember(member: ApiCommunityMember) {
    if (!selectedCommunity) return
    const confirmation = member.id === user?.id ? `Sair da comunidade “${selectedCommunity.name}”?` : `Remover @${member.username} da comunidade “${selectedCommunity.name}”?`
    if (!window.confirm(confirmation)) return
    try { await api.removeCommunityMember(selectedCommunity.id, member.id); await refreshCommunityMembers(selectedCommunity.id); await refreshCommunities(); await refreshConversations(user!) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível remover o participante.') }
  }

  async function rotateSelectedInvite() {
    if (!selectedCommunity) return
    try {
      await api.rotateCommunityInvite(selectedCommunity.id)
      await refreshCommunities()
      setNotice('Código de convite renovado. O anterior não funciona mais.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível renovar o convite.') }
  }

  async function sendFriendRequest(person: ApiPerson) {
    try {
      const result = await api.requestFriend(person.username)
      setNotice(result.status === 'accepted' ? 'Vocês agora estão conectados.' : `Pedido enviado para ${person.displayName}.`)
      setPeopleResults(current => current.map(item => item.id === person.id ? { ...item, relationship: result.status === 'accepted' ? 'friend' : 'outgoing' } : item))
      await Promise.all([refreshPeople(), refreshConversations()])
      if (result.conversationId) { setAddContactOpen(false); setActiveView('messages'); setActiveId(result.conversationId) }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível enviar o pedido.') }
  }

  async function acceptRequest(person: ApiPerson) {
    await sendFriendRequest(person)
  }

  async function dismissRequest(id: string) {
    try { await api.dismissFriendRequest(id); setNotice('Pedido removido.'); await refreshPeople() }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível remover o pedido.') }
  }

  async function removeConnection(person: ApiPerson) {
    try { await api.removeFriend(person.id); setNotice(`Você e ${person.displayName} não estão mais conectados.`); await refreshPeople() }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível remover a conexão.') }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || !active) return
    try {
      const { message } = await api.sendMessage(active.id, text, replyingTo?.id)
      if (user) {
        const mapped = fromApiMessage(message, user)
        setChats(current => current.map(chat => chat.id === active.id && !chat.messages.some(existing => existing.id === mapped.id) ? { ...chat, preview: text, time: mapped.time, messages: [...chat.messages, mapped] } : chat))
      }
      setDraft('')
      setReplyingTo(null)
      setAnnouncement('Mensagem enviada')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'A mensagem não foi enviada.') }
  }

  async function saveMessageEdit(event: FormEvent) {
    event.preventDefault()
    if (!active || !editingMessageId) return
    try {
      const { message } = await api.updateMessage(active.id, editingMessageId, editDraft)
      if (user) {
        const mapped = fromApiMessage(message, user)
        setChats(current => current.map(chat => chat.id !== active.id ? chat : {
          ...chat, preview: chat.messages.at(-1)?.id === message.id ? message.text : chat.preview,
          messages: chat.messages.map(existing => existing.id === message.id ? mapped : existing),
        }))
      }
      setEditingMessageId(''); setEditDraft('')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'A mensagem não foi editada.') }
  }

  async function removeMessage(messageId: string) {
    if (!active) return
    try {
      await api.deleteMessage(active.id, messageId)
      setChats(current => current.map(chat => chat.id !== active.id ? chat : {
        ...chat, preview: chat.messages.at(-1)?.id === messageId ? 'Mensagem removida' : chat.preview,
        messages: chat.messages.map(message => message.id === messageId ? { ...message, text: '', deleted: true } : message),
      }))
      setSearchResults(current => current ? { ...current, messages: current.messages.filter(message => message.id !== messageId) } : current)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'A mensagem não foi removida.') }
  }

  async function toggleReaction(messageId: string, emoji: string) {
    if (!active) return
    try {
      const { reaction } = await api.toggleReaction(active.id, messageId, emoji)
      setChats(current => current.map(chat => chat.id !== active.id ? chat : {
        ...chat,
        messages: chat.messages.map(message => {
          if (message.id !== messageId) return message
          const next = (message.reactions ?? []).filter(item => item.emoji !== emoji)
          if (reaction.count > 0) next.push(reaction)
          return { ...message, reactions: next }
        }),
      }))
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível registrar a reação.') }
  }

  async function togglePin(message: Message) {
    if (!active) return
    try {
      const result = await api.setPinned(active.id, message.id, !message.pinned)
      setChats(current => current.map(chat => chat.id !== active.id ? chat : { ...chat, messages: chat.messages.map(item => item.id === message.id ? { ...item, pinned: result.pinned } : item) }))
      const refreshed = await api.pins(active.id)
      setPins(refreshed.pins)
      setNotice(result.pinned ? 'Mensagem fixada na conversa.' : 'Mensagem desafixada.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível atualizar as mensagens fixadas.') }
  }

  async function openPinnedMessage(messageId: string) {
    if (!active) return
    setPinsOpen(false)
    await openConversation(active.id, messageId)
    window.setTimeout(() => document.querySelector(`[data-message-id="${messageId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
  }

  async function changeMute(muteForMs: number) {
    if (!active) return
    try {
      const result = await api.setMuted(active.id, muteForMs)
      setMutedUntil(result.mutedUntil)
      setNotice(result.mutedUntil ? 'Notificações silenciadas para esta conversa.' : 'Notificações reativadas para esta conversa.')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível alterar as notificações.') }
  }

  async function openConversation(id: string, targetMessageId?: string) {
    setMobileNavigationOpen(false)
    setActiveView('messages')
    setActiveId(id)
    setAnnouncement(`Conversa aberta: ${chats.find(chat => chat.id === id)?.name ?? 'conversa'}`)
    setNotice('')
    if (!user) return
    try {
      const page = targetMessageId ? await api.messageContext(id, targetMessageId) : await api.messages(id)
      await api.markRead(id)
      pendingMessageIdRef.current = targetMessageId ?? null
      setChats(current => current.map(chat => chat.id === id ? {
        ...chat,
        messages: page.messages.map(message => fromApiMessage(message, user)),
        olderCursor: page.nextCursor,
        unreadCount: 0,
        preview: targetMessageId ? chat.preview : page.messages.at(-1)?.text ?? chat.preview,
        time: targetMessageId ? chat.time : page.messages.at(-1) ? localTime(page.messages.at(-1)!.createdAt) : chat.time,
      } : chat))
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível abrir essa conversa.') }
  }

  async function loadOlderMessages() {
    if (!active?.olderCursor || !user || loadingOlder) return
    setLoadingOlder(true)
    try {
      const page = await api.messages(active.id, active.olderCursor)
      const scroller = messageScrollRef.current
      if (scroller) preserveScrollRef.current = { height: scroller.scrollHeight, top: scroller.scrollTop }
      setChats(current => current.map(chat => chat.id === active.id ? {
        ...chat,
        olderCursor: page.nextCursor,
        messages: [...page.messages.map(message => fromApiMessage(message, user)), ...chat.messages.filter(existing => !page.messages.some(message => message.id === existing.id))],
      } : chat))
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível carregar o histórico.') }
    finally { setLoadingOlder(false) }
  }

  function renderCommunitiesPanel() {
    return <div className="contacts-panel community-panel"><header className="chat-header"><div><p className="eyebrow">SEU ESPAÇO COLETIVO</p><h2>Comunidades</h2></div><span className="community-total">{communities.length} no seu espaço</span></header><div className="contacts-content">
      <section className="community-actions" aria-label="Ações de comunidade"><button className="auth-submit" onClick={() => { setCommunityError(''); setCommunityDialog('create') }}>Criar comunidade</button><button className="person-action primary" onClick={() => { setCommunityError(''); setCommunityDialog('join') }}>Entrar com convite</button></section>
      <section className="people-section"><h3>Suas comunidades <span>{communities.length}</span></h3>{communities.length ? communities.map(community => <article className={`community-card ${selectedCommunity?.id === community.id ? 'selected' : ''}`} key={community.id}>
        <button className="community-card-heading" aria-pressed={selectedCommunity?.id === community.id} onClick={() => { setSelectedCommunityId(community.id); setCommunityPickerId(community.id); void refreshCommunityMembers(community.id) }}><span className="avatar violet">{community.name.slice(0, 1).toLocaleUpperCase('pt-BR')}</span><span className="person-info"><strong>{community.name}</strong><span>{community.memberCount} participantes · {community.role === 'owner' ? 'responsável' : community.role === 'admin' ? 'administrador' : 'participante'}</span></span><span className="community-open-label">Abrir</span></button>
      </article>) : <p className="empty-people">Crie uma comunidade ou entre com um convite para começar.</p>}</section>
      {selectedCommunity && <section className="people-section community-details"><h3>{selectedCommunity.name} <span>{selectedCommunity.channels.length} canais</span></h3><p className="community-details-copy">{selectedCommunity.memberCount} participantes · {selectedCommunity.role === 'owner' ? 'responsável' : selectedCommunity.role === 'admin' ? 'administrador' : 'participante'}</p>{selectedCommunity.channels.map(channel => <button className="community-channel-item" key={channel.id} onClick={() => void openConversation(channel.conversationId)}><span>#</span>{channel.name}<small>Abrir canal</small></button>)}</section>}
      {selectedCommunity && <section className="people-section"><h3>Participantes <span>{communityMembers.length || selectedCommunity.memberCount}</span></h3>{selectedCommunity.role === 'member' && communityMembers.map(member => <article className="person-row" key={member.id}><span className={`avatar ${member.avatarColor} frame-${member.avatarFrame}`}>{member.displayName.slice(0,1).toLocaleUpperCase('pt-BR')}</span><div className="person-info"><strong>{member.displayName}</strong><span>@{member.username} · {member.role === 'owner' ? 'responsável' : member.role === 'admin' ? 'administrador' : 'participante'}</span></div></article>)}</section>}
      {selectedCommunity && (selectedCommunity.role === 'owner' || selectedCommunity.role === 'admin') && <details className="community-admin"><summary>Gerenciar comunidade</summary>{selectedCommunity.inviteCode && <div className="invite-code-row"><span>Código de convite</span><code>{selectedCommunity.inviteCode}</code><button className="person-action" onClick={() => void rotateSelectedInvite()}>Renovar</button></div>}<section className="people-section"><form className="community-form add-channel" onSubmit={createChannel}><div><h3>Novo canal em {selectedCommunity.name}</h3><p>Use letras, números ou hífens, de 2 a 32 caracteres.</p></div><label>Nome do canal<input autoComplete="off" required minLength={2} maxLength={32} value={channelNameDraft} onChange={event => setChannelNameDraft(event.target.value)} placeholder="ex.: novidades" /></label><button className="person-action primary">Criar canal</button></form></section><section className="people-section"><h3>Participantes <span>{communityMembers.length || selectedCommunity.memberCount}</span></h3>{communityMembers.map(member => <article className="person-row" key={member.id}><span className={`avatar ${member.avatarColor} frame-${member.avatarFrame}`}>{member.displayName.slice(0,1).toLocaleUpperCase('pt-BR')}</span><div className="person-info"><strong>{member.displayName}</strong><span>@{member.username} · {member.role === 'owner' ? 'responsável' : member.role === 'admin' ? 'administrador' : 'participante'}</span></div>{selectedCommunity.role === 'owner' && member.role !== 'owner' && <><button className="person-action" onClick={() => void changeCommunityRole(member)}>{member.role === 'admin' ? 'Remover admin' : 'Promover admin'}</button><button className="person-action" onClick={() => void removeCommunityMember(member)}>Remover</button></>}{selectedCommunity.role === 'admin' && member.role === 'member' && <button className="person-action" onClick={() => void removeCommunityMember(member)}>Remover</button>}</article>)}</section>{selectedCommunity.role === 'owner' && <section className="people-section"><form className="community-form" onSubmit={renameSelectedCommunity}><div><h3>Configurações</h3><p>Altere o nome exibido nos espaços de participantes.</p></div><label>Novo nome<input autoComplete="off" required minLength={2} maxLength={48} value={communityRenameDraft} onChange={event => setCommunityRenameDraft(event.target.value)} placeholder={selectedCommunity.name} /></label><button className="person-action primary">Salvar nome</button></form><button className="person-action danger community-delete" onClick={() => void deleteSelectedCommunity()}>Excluir comunidade e canais</button></section>}</details>}
      {selectedCommunity && selectedCommunity.role !== 'owner' && <section className="people-section"><button className="person-action danger" onClick={() => { if (user) void removeCommunityMember({ id: user.id, username: user.username, displayName: user.displayName, bio: user.bio, avatarColor: user.avatarColor, avatarFrame: user.avatarFrame, role: 'member', joinedAt: '' }) }}>Sair da comunidade</button></section>}
    </div></div>
  }

  function renderSettingsPanel() {
    const platform = api.desktopPlatform()
    const platformName = platform === 'windows' ? 'Windows' : platform === 'linux' ? 'Linux' : platform === 'android' ? 'Android' : 'Navegador'
    return <div className="contacts-panel settings-panel"><header className="chat-header"><div><p className="eyebrow">PREFERÊNCIAS DO APLICATIVO</p><h2>Configurações</h2></div><span className="settings-platform">{platformName}</span></header><div className="contacts-content"><section className="people-section"><h3>Acessibilidade</h3><label className="setting-row"><span><strong>Reduzir animações</strong><small>Evita movimentos e transições decorativas neste dispositivo.</small></span><input type="checkbox" checked={reducedMotion} onChange={event => changeReducedMotion(event.target.checked)} /></label></section>{api.supportsStartupSettings() && <section className="people-section"><h3>Inicialização</h3><label className="setting-row"><span><strong>Iniciar o Prosa com o sistema</strong><small>{platform === 'windows' ? 'Adiciona ou remove o Prosa dos aplicativos de inicialização do Windows.' : 'Cria ou remove a entrada do Prosa na inicialização da sua sessão Linux.'}</small></span><input type="checkbox" checked={startupEnabled} disabled={startupLoading} onChange={event => void changeStartupSetting(event.target.checked)} /></label></section>}<section className="people-section"><h3>Notificações</h3><p className="settings-note">Silencie notificações por conversa pelo ícone de sino. Notificações do sistema ainda não estão disponíveis.</p></section><button className="person-action" onClick={() => { changeReducedMotion(false); if (api.supportsStartupSettings()) void changeStartupSetting(false) }}>Restaurar padrões disponíveis</button></div></div>
  }

  if (loading) return <main className="auth-screen"><div className="auth-card"><img className="auth-brand" src={`${import.meta.env.BASE_URL}prosa-logo.png`} alt="Prosa" /><p>Conectando ao Prosa…</p></div></main>

  if (restoreError) return <main className="auth-screen"><section className="auth-card" aria-labelledby="connection-error-title"><img className="auth-brand" src={`${import.meta.env.BASE_URL}prosa-logo.png`} alt="Prosa" /><p className="eyebrow">CONEXÃO</p><h1 id="connection-error-title">Não foi possível abrir sua conta.</h1><p className="auth-error" role="alert">{restoreError}</p><button className="auth-submit" onClick={() => window.location.reload()}>Tentar novamente</button></section></main>

  if (!user) return <main className="auth-screen"><form className="auth-card" onSubmit={submitAuth}><img className="auth-brand" src={`${import.meta.env.BASE_URL}prosa-logo.png`} alt="Prosa" /><p className="eyebrow">CONVERSAS QUE APROXIMAM</p><h1>{authMode === 'register' ? 'Seu espaço começa aqui.' : 'Que bom ter você de volta.'}</h1><p className="auth-description">{authMode === 'register' ? 'Crie sua conta para começar a conversar.' : 'Entre para continuar suas conversas.'}</p>{api.isAndroid() && <><label>Endereço seguro do serviço<input type="url" autoComplete="url" required={!api.hasServer()} value={serverDraft} onChange={event => setServerDraft(event.target.value)} placeholder="https://prosa.seudominio.com" /></label><button type="button" className="server-save" onClick={() => { try { const endpoint = api.saveServerUrl(serverDraft); setServerDraft(endpoint.replace(/\/api$/, '')); setNotice('Endereço do serviço salvo neste dispositivo.') } catch (error) { setNotice(error instanceof Error ? error.message : 'Endereço inválido.') } }}>Salvar endereço</button></>}{authMode === 'register' && <label>Como podemos te chamar?<input autoComplete="name" required maxLength={48} value={authName} onChange={event => setAuthName(event.target.value)} placeholder="Nome de exibição" /></label>}<label>Nome de usuário<input autoComplete="username" required minLength={3} maxLength={24} value={authUsername} onChange={event => setAuthUsername(event.target.value)} placeholder="ex.: ana_silva" /></label><label>Senha<input autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} required minLength={authMode === 'register' ? 12 : 1} maxLength={128} type="password" value={authPassword} onChange={event => setAuthPassword(event.target.value)} placeholder={authMode === 'register' ? 'Pelo menos 12 caracteres' : 'Sua senha'} /></label>{notice && <p className="auth-error" role="alert">{notice}</p>}<button className="auth-submit" disabled={busy}>{busy ? 'Aguarde…' : authMode === 'register' ? 'Criar conta' : 'Entrar'}</button><p className="auth-switch">{authMode === 'register' ? 'Já tem uma conta?' : 'Primeira vez por aqui?'} <button type="button" onClick={() => { setAuthMode(authMode === 'register' ? 'login' : 'register'); setNotice('') }}>{authMode === 'register' ? 'Entrar' : 'Criar conta'}</button></p>{!api.isAndroid() && <p className="auth-local-note">Conta de desenvolvimento: o serviço local guarda os dados neste dispositivo.</p>}</form></main>

  return <main className="app-shell">
    <aside className="rail" aria-label="Navegação principal">
      <a className="brand-mark" href="#inicio" aria-label="Prosa início"><img src={`${import.meta.env.BASE_URL}prosa-logo.png`} alt="" /></a>
      <div className="rail-divider" />
      <button className={`rail-button ${activeView === 'messages' ? 'selected' : ''}`} aria-label="Mensagens" aria-current={activeView === 'messages' ? 'page' : undefined} onClick={() => { setActiveView('messages'); if (window.matchMedia('(max-width: 700px)').matches) setMobileNavigationOpen(true) }}><Icon name="message" /></button>
      <button className={`rail-button ${activeView === 'friends' ? 'selected' : ''}`} aria-label="Contatos" aria-current={activeView === 'friends' ? 'page' : undefined} onClick={() => setActiveView('friends')}><Icon name="users" /></button>
      <button className={`rail-button ${activeView === 'communities' ? 'selected' : ''}`} aria-label="Comunidades" aria-current={activeView === 'communities' ? 'page' : undefined} onClick={() => setActiveView('communities')}><Icon name="community" /></button>
      <button className="rail-button" aria-label="Adicionar contato" onClick={() => { setAddContactOpen(true); setPeopleQuery(''); setPeopleResults([]) }}><Icon name="plus" /></button>
      <div className="rail-spacer" />
      <button id="security-nav" className={`rail-button ${activeView === 'security' ? 'selected' : ''}`} aria-label="Segurança e sessões" aria-current={activeView === 'security' ? 'page' : undefined} onClick={() => { setActiveView('security'); void refreshSessions() }}><Icon name="settings" /></button>
      <div className="account-menu" ref={accountMenuRef}><button id="account-menu-trigger" ref={accountMenuTriggerRef} className={`profile-orb ${user.avatarColor} frame-${user.avatarFrame}`} aria-label={`Abrir opções da conta de ${user.displayName}`} aria-expanded={accountMenuOpen} aria-controls="account-menu-options" onClick={() => setAccountMenuOpen(value => !value)}>{user.displayName.slice(0, 1).toUpperCase()}<span className="presence-dot" /></button><div className="account-menu-options" id="account-menu-options" aria-label="Opções da conta" hidden={!accountMenuOpen}><strong>{user.displayName}</strong><span>@{user.username}</span><button onClick={() => { setAccountMenuOpen(false); setProfileDraft({ displayName: user.displayName, username: user.username, bio: user.bio, avatarColor: user.avatarColor, avatarFrame: user.avatarFrame }); setProfileOpen(true) }}>Editar perfil</button><button onClick={() => { setAccountMenuOpen(false); if (api.supportsStartupSettings()) setStartupLoading(true); setActiveView('settings'); document.getElementById('account-menu-trigger')?.focus() }}>Configurações</button><button onClick={() => { setAccountMenuOpen(false); setActiveView('security'); void refreshSessions(); document.getElementById('security-nav')?.focus() }}>Segurança e sessões</button><button onClick={() => { setAccountMenuOpen(false); void signOut() }}>Sair da conta</button></div></div>
    </aside>

    <aside className="sidebar" aria-label="Lista de conversas e busca">
      <header className="sidebar-heading"><div><p className="eyebrow">{user.displayName.toLocaleUpperCase('pt-BR')}</p><h1>{activeView === 'friends' ? 'Contatos' : activeView === 'communities' ? 'Comunidades' : activeView === 'security' ? 'Segurança' : activeView === 'settings' ? 'Configurações' : 'Mensagens'}</h1></div>{activeView === 'communities' ? <button className="icon-button new-chat" aria-label="Atualizar comunidades" onClick={() => void refreshCommunities()}><Icon name="more" size={18} /></button> : activeView === 'security' ? <button className="icon-button new-chat" aria-label="Atualizar sessões" onClick={() => void refreshSessions()}><Icon name="more" size={18} /></button> : activeView === 'settings' ? null : <button className="icon-button new-chat" aria-label="Adicionar contato" onClick={() => { setAddContactOpen(true); setPeopleQuery(''); setPeopleResults([]) }}><Icon name="plus" size={18} /></button>}</header>
      {activeView !== 'security' && activeView !== 'settings' && <label className="search-box"><Icon name="search" size={17} /><input ref={searchInputRef} aria-keyshortcuts={/mac/i.test(navigator.platform) ? 'Meta+K' : 'Control+K'} value={query} onChange={event => setQuery(event.target.value)} placeholder={activeView === 'friends' ? 'Buscar contatos' : activeView === 'communities' ? 'Canais da comunidade' : 'Buscar conversas e mensagens'} /><kbd>{/mac/i.test(navigator.platform) ? '⌘ K' : 'Ctrl K'}</kbd></label>}
      {activeView !== 'security' && activeView !== 'settings' && <nav className="tabs" aria-label="Navegação">{[{ id: 'messages', label: 'Mensagens' }, { id: 'friends', label: 'Contatos' }, { id: 'communities', label: 'Comunidades' }].map(item => <button key={item.id} className={`tab ${activeView === item.id ? 'active' : ''}`} aria-current={activeView === item.id ? 'page' : undefined} onClick={() => setActiveView(item.id as 'messages' | 'friends' | 'communities')}>{item.label}{item.id === 'friends' && people.incoming.length > 0 && <span className="tab-count">{people.incoming.length}</span>}</button>)}</nav>}
      {activeView === 'messages' && communities.length > 0 && <label className="community-picker"><span>COMUNIDADE</span><select value={communityPickerId} onChange={event => { setCommunityPickerId(event.target.value); setSelectedCommunityId(event.target.value) }}>{communities.map(community => <option key={community.id} value={community.id}>{community.name}</option>)}</select></label>}
      {activeView !== 'settings' && <><div className="section-label"><span>{activeView === 'friends' ? 'CONECTADOS' : activeView === 'communities' ? 'CANAIS' : activeView === 'security' ? 'CONTA' : query.trim().length >= 2 ? 'CONVERSAS' : 'RECENTES'}</span><button aria-label="Atualizar lista" onClick={() => void (activeView === 'friends' ? refreshPeople() : activeView === 'communities' ? refreshCommunities() : activeView === 'security' ? refreshSessions() : refreshConversations())}><Icon name="more" size={17} /></button></div>
      <div className="conversation-list">{activeView === 'security' ? <p className="empty-people">Sessões e dispositivos da sua conta.</p> : activeView === 'messages' ? recentConversationGroups() : activeView === 'friends' ? people.friends.filter(person => `${person.displayName} ${person.username}`.toLowerCase().includes(query.toLowerCase())).map(person => <button key={person.id} className={`conversation ${activeId === chats.find(chat => chat.handle === `@${person.username}`)?.id ? 'active' : ''}`} onClick={() => { const conversation = chats.find(chat => chat.handle === `@${person.username}`); if (conversation) void openConversation(conversation.id) }}><span className={`avatar ${person.avatarColor} frame-${person.avatarFrame}`}>{person.displayName.split(/\s+/).map(part => part[0]).join('').slice(0,2).toUpperCase()}</span><span className="conversation-copy"><span className="conversation-top"><strong>{person.displayName}</strong></span><span className="conversation-bottom"><span>@{person.username}</span></span></span></button>) : selectedCommunity ? selectedCommunity.channels.filter(channel => channel.name.toLowerCase().includes(query.toLowerCase())).map(channel => <button key={channel.id} className={`conversation ${activeId === channel.conversationId ? 'active' : ''}`} onClick={() => void openConversation(channel.conversationId)}><span className="avatar violet">#</span><span className="conversation-copy"><span className="conversation-top"><strong>{channel.name}</strong></span><span className="conversation-bottom"><span>{selectedCommunity.name}</span></span></span></button>) : <p className="empty-people">Selecione uma comunidade no painel.</p>}</div></>}
      {activeView === 'messages' && query.trim().length >= 2 && <div className="search-results" aria-live="polite"><div className="search-results-title">MENSAGENS</div>{!searchResults || searchResults.query !== query.trim() || searchResults.userId !== user.id ? <p className="empty-search">Buscando mensagens…</p> : searchResults.messages.length ? searchResults.messages.map(result => <button className="search-result" key={result.id} onClick={() => void openConversation(result.conversationId, result.id)}><span className="search-result-top"><strong>{result.conversationName}</strong><time>{localTime(result.createdAt)}</time></span><span className="search-result-text">{result.author}: {result.text}</span></button>) : <p className="empty-search">Nenhuma mensagem encontrada.</p>}</div>}
      <div className="sidebar-bottom"><div className="sync-mark"><span /> Sessão ativa · @{user.username}</div></div>
    </aside>

    {mobileNavigationOpen && <div className="mobile-navigation-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setMobileNavigationOpen(false) }}><section className="mobile-navigation" ref={mobileNavigationRef} role="dialog" aria-modal="true" aria-labelledby="mobile-navigation-title">
      <header><h2 id="mobile-navigation-title">Navegação</h2><button className="modal-close" onClick={() => setMobileNavigationOpen(false)} aria-label="Fechar navegação">×</button></header>
      <label className="search-box mobile-navigation-search"><Icon name="search" size={17} /><input value={query} onChange={event => setQuery(event.target.value)} aria-label="Buscar conversas e canais" placeholder="Buscar conversas e canais" /><span className="keyboard-shortcut-hint">{/mac/i.test(navigator.platform) ? '⌘ K' : 'Ctrl K'}</span></label>
      <nav className="mobile-navigation-tabs" aria-label="Seções">{[{ id: 'messages', label: 'Mensagens' }, { id: 'friends', label: 'Contatos' }, { id: 'communities', label: 'Comunidades' }].map(item => <button key={item.id} aria-current={activeView === item.id ? 'page' : undefined} onClick={() => { setActiveView(item.id as 'messages' | 'friends' | 'communities'); setMobileNavigationOpen(false) }}>{item.label}</button>)}</nav>
      {activeView === 'messages' && communities.length > 0 && <label className="community-picker"><span>COMUNIDADE</span><select aria-label="Selecionar comunidade" value={communityPickerId} onChange={event => { setCommunityPickerId(event.target.value); setSelectedCommunityId(event.target.value) }}>{communities.map(community => <option key={community.id} value={community.id}>{community.name}</option>)}</select></label>}
      <div className="mobile-chat-list">{activeView === 'messages' && recentConversationGroups(true)}{activeView === 'friends' && <button className="person-action primary mobile-add-contact" onClick={() => { setMobileNavigationOpen(false); setAddContactOpen(true); setPeopleQuery(''); setPeopleResults([]) }}>Encontrar pessoas</button>}</div>
    </section></div>}

    <section className="chat-panel">
      {activeView === 'settings' ? renderSettingsPanel() : activeView === 'security' ? <div className="contacts-panel security-panel"><header className="chat-header"><div><p className="eyebrow">PROTEÇÃO DA CONTA</p><h2>Sessões ativas</h2></div><button className="person-action" onClick={() => void refreshSessions()} disabled={loadingSessions}>{loadingSessions ? 'Atualizando…' : 'Atualizar'}</button></header><div className="contacts-content"><p className="security-intro">Confira os dispositivos conectados à sua conta. Encerrar uma sessão desconecta o aparelho escolhido.</p><section className="people-section"><h3>Dispositivos <span>{sessions.length}</span></h3>{loadingSessions ? <p className="empty-people">Carregando sessões…</p> : sessions.length ? sessions.map(session => <article className="person-row session-row" key={session.id}><span className={`avatar ${session.current ? 'green' : 'violet'}`}><Icon name="settings" size={17}/></span><div className="person-info"><strong>{session.label}{Boolean(session.current) && <span className="current-session">Este dispositivo</span>}</strong><span>Atividade: {session.lastSeenAt > 0 ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(session.lastSeenAt)) : 'não registrada'} · expira em {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(session.expiresAt))}</span></div>{!session.current && <button className="person-action" onClick={() => void revokeSession(session)}>Encerrar</button>}</article>) : <p className="empty-people">Nenhuma sessão ativa foi encontrada.</p>}</section><section className="people-section"><form className="password-form" onSubmit={changePassword}><div><h3>Alterar senha</h3><p>Para proteger a conta, os outros dispositivos serão desconectados.</p></div><label>Senha atual<input type="password" autoComplete="current-password" required maxLength={128} value={currentPasswordDraft} onChange={event => setCurrentPasswordDraft(event.target.value)} /></label><label>Nova senha<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={newPasswordDraft} onChange={event => setNewPasswordDraft(event.target.value)} placeholder="Pelo menos 12 caracteres" /></label><label>Confirme a nova senha<input type="password" autoComplete="new-password" required minLength={12} maxLength={128} value={confirmPasswordDraft} onChange={event => setConfirmPasswordDraft(event.target.value)} /></label><button className="person-action primary" disabled={changingPassword}>{changingPassword ? 'Salvando…' : 'Atualizar senha'}</button></form></section><AccountDataControls user={user} onDeleted={signOut} onNotice={setNotice}/><p className="security-note">Os dispositivos são identificados pelo navegador ou aplicativo que iniciou a sessão. Se reconhecer algo estranho, encerre essa sessão e altere sua senha.</p></div></div> : activeView === 'communities' ? renderCommunitiesPanel() : activeView === 'friends' ? <div className="contacts-panel"><header className="chat-header"><div><p className="eyebrow">SUA REDE</p><h2>Contatos</h2></div><button className="auth-submit contact-add" onClick={() => { setAddContactOpen(true); setPeopleQuery(''); setPeopleResults([]) }}>Adicionar pessoa</button></header><div className="contacts-content">{people.incoming.length > 0 && <section className="people-section"><h3>Pedidos recebidos <span>{people.incoming.length}</span></h3>{people.incoming.map(person => <article className="person-row" key={person.id}><span className={`avatar ${person.avatarColor} frame-${person.avatarFrame}`}>{person.displayName.split(/\s+/).map(part => part[0]).join('').slice(0,2).toUpperCase()}</span><div className="person-info"><strong>{person.displayName}</strong><span>@{person.username}</span></div><button className="person-action primary" onClick={() => void acceptRequest(person)}>Aceitar</button><button className="person-action" onClick={() => void dismissRequest(person.id)}>Remover</button></article>)}</section>}{people.outgoing.length > 0 && <section className="people-section"><h3>Pedidos enviados</h3>{people.outgoing.map(person => <article className="person-row" key={person.id}><span className={`avatar ${person.avatarColor} frame-${person.avatarFrame}`}>{person.displayName.split(/\s+/).map(part => part[0]).join('').slice(0,2).toUpperCase()}</span><div className="person-info"><strong>{person.displayName}</strong><span>@{person.username} · aguardando resposta</span></div><button className="person-action" onClick={() => void dismissRequest(person.id)}>Cancelar</button></article>)}</section>}<section className="people-section"><h3>Conectados <span>{people.friends.length}</span></h3>{people.friends.length ? people.friends.map(person => <article className="person-row" key={person.id}><span className={`avatar ${person.avatarColor} frame-${person.avatarFrame}`}>{person.displayName.split(/\s+/).map(part => part[0]).join('').slice(0,2).toUpperCase()}<i /></span><div className="person-info"><strong>{person.displayName}</strong><span>@{person.username}</span></div><button className="person-action primary" onClick={() => { const conversation = chats.find(chat => chat.handle === `@${person.username}`); if (conversation) { setActiveView('messages'); setActiveId(conversation.id) } }}>Mensagem</button><button className="person-action" onClick={() => void removeConnection(person)}>Remover</button></article>) : <p className="empty-people">Seus contatos aparecerão aqui quando aceitarem um pedido.</p>}</section></div></div> : active ? <>
      <header className="chat-header"><button className="icon-button mobile-nav-toggle" aria-label="Abrir conversas e navegação" onClick={() => setMobileNavigationOpen(true)}><Icon name="message" /></button><div className="chat-person">{active.communityId ? <span className={`avatar small ${active.color}`}>{active.initials}{active.online && <i />}</span> : <ProfileAvatar name={active.avatarName} color={active.color as ProsaUser['avatarColor']} frame={active.avatarFrame} className="small" online={active.online} />}<div><h2>{active.name}</h2><p>{active.communityName ? `${active.communityName} · canal` : active.handle === `@${user.username}` ? 'Conversa pessoal' : 'Conversa direta'}</p></div></div><div className="header-actions"><button className="icon-button" aria-label="Mensagens fixadas" aria-expanded={pinsOpen} onClick={() => setPinsOpen(value => !value)}>📌<span className="pin-count">{visiblePins.length}</span></button><details className="mute-menu"><summary aria-label="Configurar notificações">{muted ? '🔕' : '🔔'}</summary><div><strong>Notificações</strong>{[[0, 'Ativadas'], [3600000, '1 hora'], [28800000, '8 horas'], [86400000, '24 horas'], [604800000, '7 dias']].map(([duration, label]) => <button key={duration} onClick={() => void changeMute(Number(duration))}>{label}</button>)}</div></details>{voiceCallEnabled && <><button className="icon-button" aria-label="Chamada de voz" onClick={() => { setVoiceCallOpen(true); setVoiceCallStartMode('audio'); setVoiceCallStartSignal(value => value + 1) }}><Icon name="phone" /></button><button className="icon-button" aria-label="Chamada de vídeo" onClick={() => { setVoiceCallOpen(true); setVoiceCallStartMode('video'); setVoiceCallStartSignal(value => value + 1) }}><Icon name="video" /></button></>}</div>{pinsOpen && <section className="pins-panel" aria-label="Mensagens fixadas"><header><strong>Fixadas</strong><button aria-label="Fechar fixadas" onClick={() => setPinsOpen(false)}>×</button></header>{visiblePins.length ? visiblePins.map(pin => <button key={pin.id} className="pin-item" onClick={() => void openPinnedMessage(pin.id)}><strong>{pin.author}</strong><span>{pin.text}</span></button>) : <p>Nenhuma mensagem fixada.</p>}</section>}</header>
      <VoiceCall conversationId={active.id} peerName={active.name} enabled={voiceCallEnabled} open={voiceCallOpen} startSignal={voiceCallStartSignal} startMode={voiceCallStartMode} onIncoming={() => setVoiceCallOpen(true)} onClose={() => setVoiceCallOpen(false)} onNotice={setNotice} />
      <div className="message-scroll" ref={messageScrollRef} onScroll={event => { const element = event.currentTarget; nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100 }}><div className="day-divider"><span>HISTÓRICO</span></div>{active.olderCursor && <button className="load-older" disabled={loadingOlder} onClick={() => void loadOlderMessages()}>{loadingOlder ? 'Carregando…' : 'Carregar mensagens anteriores'}</button>}<div className="messages">{active.messages.length === 0 ? <div className="messages-empty" role="status"><h3>{active.handle === `@${user?.username}` ? "Seu espaço ainda está vazio" : `Comece a conversar em ${active.name}`}</h3><p>{active.handle === `@${user?.username}` ? "Escreva uma mensagem para guardar uma nota ou uma ideia." : "Envie a primeira mensagem para iniciar a conversa."}</p></div> : active.messages.map((message, index) => {
        const previous = active.messages[index - 1]
        const grouped = previous?.author === message.author
        return <article key={message.id} data-message-id={message.id} className={`message ${message.mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}`}><div className="message-avatar-slot">{!grouped && <ProfileAvatar name={message.avatarName} color={message.avatarColor} frame={message.avatarFrame} className="tiny" />}</div><div className="message-body">{!grouped && <div className="message-meta"><strong>{message.mine ? 'Você' : message.author}</strong><time>{message.time}</time></div>}{message.pinned && <span className="message-pin-label">📌 Fixada</span>}{editingMessageId === message.id ? <form className="message-edit-form" onSubmit={saveMessageEdit}><textarea aria-label="Editar mensagem" maxLength={4000} value={editDraft} onChange={event => setEditDraft(event.target.value)} autoFocus /><div><button type="button" onClick={() => { setEditingMessageId(''); setEditDraft('') }}>Cancelar</button><button type="submit" disabled={!editDraft.trim()}>Salvar</button></div></form> : <>{message.replyTo && <button className="reply-preview" onClick={() => void openConversation(active.id, message.replyTo!.id)}><strong>{message.replyTo.author}</strong><span>{message.replyTo.deleted ? "Mensagem removida" : message.replyTo.text}</span></button>}<p className={message.deleted ? 'message-deleted' : undefined}>{message.deleted ? 'Esta mensagem foi removida.' : message.text}{message.edited && !message.deleted && <small className="message-edited"> editada</small>}</p>{message.mine && !message.deleted && <div className="message-actions"><button onClick={() => { setEditingMessageId(message.id); setEditDraft(message.text) }}>Editar</button><button onClick={() => void removeMessage(message.id)}>Remover</button></div>}</>}{!message.deleted && <div className={`message-social-controls ${reactionPickerId === message.id ? 'open' : ''}`}><button onClick={() => setReplyingTo(message)}>Responder</button><button aria-pressed={Boolean(message.pinned)} onClick={() => void togglePin(message)}>{message.pinned ? 'Desafixar' : 'Fixar'}</button><button aria-expanded={reactionPickerId === message.id} aria-controls={`reaction-picker-${message.id}`} onClick={() => setReactionPickerId(current => current === message.id ? '' : message.id)}>Reagir</button>{message.reactions?.map(reaction => <button key={reaction.emoji} className={`message-reaction ${reaction.reactedByMe ? 'selected' : ''}`} aria-label={`${reaction.emoji}: ${reaction.count}`} onClick={() => void toggleReaction(message.id, reaction.emoji)}>{reaction.emoji} <span>{reaction.count}</span></button>)}{reactionPickerId === message.id && !message.deleted && <span className="reaction-picker" id={`reaction-picker-${message.id}`}>{['👍', '❤️', '😂', '😮', '🎉', '🔥'].map(emoji => <button key={emoji} aria-label={`Reagir com ${emoji}`} onClick={() => { void toggleReaction(message.id, emoji); setReactionPickerId('') }}>{emoji}</button>)}</span>}</div>}</div></article>
      })}</div></div>
      <form className="composer" onSubmit={sendMessage}>{replyingTo && <div className="reply-draft"><span>Respondendo a <strong>{replyingTo.author}</strong>: {replyingTo.deleted ? 'Mensagem removida' : replyingTo.text}</span><button type="button" aria-label="Cancelar resposta" onClick={() => setReplyingTo(null)}>×</button></div>}<div className="composer-controls"><input aria-label="Escrever mensagem" value={draft} onChange={event => setDraft(event.target.value)} placeholder={`Escreva para ${active.name.split(' ')[0]}...`} /><button type="button" className="composer-tool" aria-label="Escolher emoji" aria-expanded={emojiPickerOpen} aria-controls="composer-emoji-picker" onClick={() => setEmojiPickerOpen(value => !value)}><Icon name="smile" size={19} /></button>{emojiPickerOpen && <div className="emoji-picker" id="composer-emoji-picker" role="group" aria-label="Emojis"><span>{['🙂','😂','❤️','👍','🎉','✨'].map(emoji => <button type="button" key={emoji} aria-label={`Inserir ${emoji}`} onClick={() => { setDraft(value => `${value}${value ? ' ' : ''}${emoji}`); setEmojiPickerOpen(false) }}>{emoji}</button>)}</span></div>}<button type="submit" className="send-button" aria-label="Enviar mensagem" disabled={!draft.trim()}><Icon name="send" size={17} /></button></div></form>
      <footer className="chat-footnote" role="status" aria-live="polite">{networkState === 'connected' ? 'Conectado · mensagens sincronizadas em tempo real' : networkState === 'reconnecting' || networkState === 'connecting' ? 'Reconectando · aguarde para continuar enviando mensagens' : 'Sem conexão · verifique a rede para enviar e receber mensagens'}</footer><span className="sr-only" aria-live="polite">{announcement}</span></> : <div className="empty-chat"><img className="auth-brand" src={`${import.meta.env.BASE_URL}prosa-logo.png`} alt="Prosa" /><h2>Seu Prosa está pronto.</h2><p>Encontre pessoas pelo nome de usuário para começar uma conversa.</p><button className="auth-submit" onClick={() => { setAddContactOpen(true); setPeopleQuery(''); setPeopleResults([]) }}>Encontrar pessoas</button><p className="chat-footnote" role="status" aria-live="polite">{networkState === 'connected' ? 'Conectado · mensagens sincronizadas em tempo real' : networkState === 'reconnecting' || networkState === 'connecting' ? 'Reconectando · aguarde para continuar enviando mensagens' : 'Sem conexão · verifique a rede para enviar e receber mensagens'}</p></div>}
      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Fechar aviso">×</button></div>}
      {profileOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setProfileOpen(false) }}><section className="people-modal profile-dialog" ref={profileDialogRef} role="dialog" aria-modal="true" aria-labelledby="profile-dialog-title"><button className="modal-close" onClick={() => setProfileOpen(false)} aria-label="Fechar">×</button><p className="eyebrow">SUA IDENTIDADE</p><h2 id="profile-dialog-title">Editar perfil</h2><p>Seu identificador ajuda outras pessoas a encontrar você. A descrição é texto simples e pública.</p><form onSubmit={saveProfile}><label>Nome de exibição<input autoFocus required maxLength={48} value={profileDraft.displayName} onChange={event => setProfileDraft(value => ({ ...value, displayName: event.target.value }))} /></label><label>Identificador público<input required minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]+" value={profileDraft.username} onChange={event => setProfileDraft(value => ({ ...value, username: event.target.value }))} /></label><label>Descrição curta<textarea maxLength={160} value={profileDraft.bio} onChange={event => setProfileDraft(value => ({ ...value, bio: event.target.value }))} /><small>{profileDraft.bio.length}/160 · texto simples</small></label><label>Cor do avatar<select value={profileDraft.avatarColor} onChange={event => setProfileDraft(value => ({ ...value, avatarColor: event.target.value as ProsaUser['avatarColor'] }))}><option value="violet">Violeta</option><option value="blue">Azul</option><option value="green">Verde</option><option value="coral">Coral</option></select></label><label>Moldura<select value={profileDraft.avatarFrame} onChange={event => setProfileDraft(value => ({ ...value, avatarFrame: event.target.value as ProsaUser['avatarFrame'] }))}><option value="none">Sem moldura</option><option value="ring">Anel violeta</option><option value="spark">Brilho discreto</option></select></label><div className="profile-preview" aria-live="polite"><ProfileAvatar name={profileDraft.displayName} color={profileDraft.avatarColor} frame={profileDraft.avatarFrame} /><span>{profileDraft.displayName || 'Prévia do nome'} · @{profileDraft.username || 'identificador'}</span></div><button className="auth-submit">Salvar perfil</button></form></section></div>}
      {communityDialog && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setCommunityDialog(null) }}><section className="people-modal community-dialog" ref={communityDialogRef} role="dialog" aria-modal="true" aria-labelledby="community-dialog-title"><button className="modal-close" onClick={() => setCommunityDialog(null)} aria-label="Fechar">×</button><p className="eyebrow">COMUNIDADES</p><h2 id="community-dialog-title">{communityDialog === 'create' ? 'Criar comunidade' : 'Entrar com convite'}</h2><p>{communityDialog === 'create' ? 'Reúna pessoas em canais organizados por assunto. Um canal “geral” será criado para você começar.' : 'Insira o código compartilhado por quem administra a comunidade.'}</p>{communityDialog === 'create' ? <form onSubmit={createCommunity}><label>Nome da comunidade<input autoFocus autoComplete="off" required minLength={2} maxLength={48} value={communityNameDraft} onChange={event => { setCommunityNameDraft(event.target.value); setCommunityError('') }} placeholder="ex.: Clube de leitura" /></label>{communityError && <p className="form-error" role="alert">{communityError}</p>}<button className="auth-submit">Criar comunidade</button></form> : <form onSubmit={joinCommunity}><label>Código de convite<input autoFocus autoComplete="off" required minLength={10} maxLength={32} value={inviteCodeDraft} onChange={event => { setInviteCodeDraft(event.target.value); setCommunityError('') }} placeholder="Cole o código de convite" /></label>{communityError && <p className="form-error" role="alert">{communityError}</p>}<button className="auth-submit">Entrar na comunidade</button></form>}</section></div>}
      {addContactOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setAddContactOpen(false) }}><section className="people-modal" ref={addContactDialogRef} role="dialog" aria-modal="true" aria-labelledby="add-contact-title"><button className="modal-close" onClick={() => setAddContactOpen(false)} aria-label="Fechar">×</button><p className="eyebrow">AMPLIE SUA REDE</p><h2 id="add-contact-title">Encontre pessoas</h2><p>Busque pelo nome de usuário para enviar um pedido de conexão.</p><label className="people-search"><Icon name="search" size={17} /><input autoFocus value={peopleQuery} onChange={event => { setPeopleQuery(event.target.value); if (event.target.value.trim().replace(/^@/, '').length < 2) setPeopleResults([]) }} placeholder="Digite pelo menos 2 caracteres" /></label><div className="people-results">{peopleQuery.trim().length < 2 ? <p className="empty-people">Comece digitando um nome de usuário.</p> : peopleResults.length ? peopleResults.map(person => <article className="person-row" key={person.id}><span className={`avatar ${person.avatarColor} frame-${person.avatarFrame}`}>{person.displayName.split(/\s+/).map(part => part[0]).join('').slice(0,2).toUpperCase()}</span><div className="person-info"><strong>{person.displayName}</strong><span>@{person.username}</span></div>{person.relationship === 'none' && <button className="person-action primary" onClick={() => void sendFriendRequest(person)}>Conectar</button>}{person.relationship === 'incoming' && <button className="person-action primary" onClick={() => void acceptRequest(person)}>Aceitar</button>}{person.relationship === 'outgoing' && <span className="relationship-label">Pedido enviado</span>}{person.relationship === 'friend' && <span className="relationship-label">Conectados</span>}</article>) : <p className="empty-people">Nenhuma pessoa encontrada.</p>}</div></section></div>}
    </section>
  </main>
}

export default App
