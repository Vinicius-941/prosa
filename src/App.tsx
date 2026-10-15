import { useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import './App.css'
import { api, type ApiConversation, type ApiFriendData, type ApiMessage, type ApiPerson, type ProsaUser } from './api'
import { io } from 'socket.io-client'

type Message = { id: string; author: string; time: string; text: string; mine?: boolean }
type Conversation = { id: string; name: string; handle: string; initials: string; color: string; online?: boolean; preview: string; time: string; unreadCount: number; olderCursor: string | null; messages: Message[] }

function localTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function fromApiMessage(message: ApiMessage, user: ProsaUser): Message {
  return { id: message.id, author: message.authorId === user.id ? 'Você' : message.author, time: localTime(message.createdAt), text: message.text, mine: message.authorId === user.id }
}

function fromApiConversation(conversation: ApiConversation, page: { messages: ApiMessage[]; nextCursor: string | null }, user: ProsaUser): Conversation {
  const initials = conversation.name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()
  const color = ['coral', 'blue', 'violet', 'green'][parseInt(conversation.id.slice(0, 2), 16) % 4]
  const messages = page.messages
  return { id: conversation.id, name: conversation.name, handle: conversation.peerUsername ? `@${conversation.peerUsername}` : `@${user.username}`, initials, color, unreadCount: conversation.unreadCount, olderCursor: page.nextCursor, preview: conversation.preview ?? 'Conversa criada', time: conversation.lastMessageAt ? localTime(conversation.lastMessageAt) : 'agora', messages: messages.map(message => fromApiMessage(message, user)) }
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>, plus: <><path d="M12 5v14M5 12h14"/></>, users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.6.9l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.6-.9l-1.7.6-1.4-2.4 1.4-1.1a7 7 0 0 1 0-1.9l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.6-.9l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.6.9l1.7-.6 1.4 2.4-1.4 1.1a7 7 0 0 1 0 1.9Z" transform="translate(-1 -1)"/></>,
    message: <><path d="M21 11.5a8.5 8.5 0 0 1-12.7 7.4L3 20l1.1-4.3A8.5 8.5 0 1 1 21 11.5Z"/></>,
    send: <><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></>, paperclip: <path d="m21.4 11.1-8.5 8.5a5.7 5.7 0 0 1-8.1-8.1l9.2-9.2a3.8 3.8 0 0 1 5.4 5.4l-9.2 9.2a1.9 1.9 0 0 1-2.7-2.7l8.5-8.5"/>,
    smile: <><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></>,
    video: <><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/></>, phone: <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.2-1.3a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.8 2.1Z"/>,
    more: <><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  }
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>
}

function App() {
  const [chats, setChats] = useState<Conversation[]>([])
  const [activeId, setActiveId] = useState('')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [notice, setNotice] = useState('')
  const [user, setUser] = useState<ProsaUser | null>(null)
  const [people, setPeople] = useState<ApiFriendData>({ friends: [], incoming: [], outgoing: [] })
  const [activeView, setActiveView] = useState<'messages' | 'friends'>('messages')
  const [addContactOpen, setAddContactOpen] = useState(false)
  const [peopleQuery, setPeopleQuery] = useState('')
  const [peopleResults, setPeopleResults] = useState<ApiPerson[]>([])
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register')
  const [authName, setAuthName] = useState('')
  const [authUsername, setAuthUsername] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [loading, setLoading] = useState(() => api.hasSession())
  const [busy, setBusy] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const active = chats.find(chat => chat.id === activeId) ?? chats[0]
  const activeConversationId = active?.id
  const chatsRef = useRef(chats)
  const messageScrollRef = useRef<HTMLDivElement>(null)
  const preserveScrollRef = useRef<{ height: number; top: number } | null>(null)
  const nearBottomRef = useRef(true)
  const renderedMessageCountRef = useRef(0)
  const filtered = useMemo(() => chats.filter(chat => `${chat.name} ${chat.handle}`.toLowerCase().includes(query.toLowerCase())), [chats, query])

  useEffect(() => { chatsRef.current = chats }, [chats])

  useLayoutEffect(() => {
    const scroller = messageScrollRef.current
    if (!scroller) return
    if (preserveScrollRef.current) {
      const previous = preserveScrollRef.current
      scroller.scrollTop = previous.top + scroller.scrollHeight - previous.height
      preserveScrollRef.current = null
    } else if (active && renderedMessageCountRef.current !== active.messages.length && nearBottomRef.current) {
      scroller.scrollTop = scroller.scrollHeight
    }
    renderedMessageCountRef.current = active?.messages.length ?? 0
  }, [active])

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

  async function refreshPeople() {
    setPeople(await api.friends())
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
    let mounted = true
    if (!api.hasSession()) return () => { mounted = false }
    api.me().then(async ({ user: currentUser }) => {
      if (!mounted) return
      setUser(currentUser)
      const [{ conversations }, nextPeople] = await Promise.all([api.conversations(), api.friends()])
      const mapped = await Promise.all(conversations.map(async conversation => {
        const page = await api.messages(conversation.id)
        return fromApiConversation(conversation, page, currentUser)
      }))
      if (mounted) { setChats(mapped); setActiveId(mapped[0]?.id ?? ''); setPeople(nextPeople) }
    }).catch(() => { void api.logout() }).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    if (!user) return
    const timer = window.setInterval(() => { void refreshPeople().catch(() => undefined) }, 6000)
    return () => window.clearInterval(timer)
  }, [user])

  useEffect(() => {
    if (!user || !activeConversationId) return
    const socketOrigin = (window.prosaDesktop?.apiUrl ?? import.meta.env.VITE_API_URL)?.replace(/\/api\/?$/, '') || undefined
    const socket = io(socketOrigin, { auth: { token: api.sessionToken() }, reconnection: true, reconnectionDelayMax: 5000 })
    socket.on('connect', () => socket.emit('conversation:join', activeConversationId, (result: { ok: boolean }) => {
      if (!result.ok) setNotice('Esta conversa não está mais disponível.')
    }))
    socket.on('conversations:changed', () => { void refreshConversations(user).catch(() => undefined) })
    socket.on('contacts:changed', () => { void refreshPeople().catch(() => undefined) })
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
      if (!found) void refreshConversations(user).catch(() => undefined)
    })
    return () => { socket.emit('conversation:leave', activeConversationId); socket.disconnect() }
  }, [activeConversationId, user])

  async function submitAuth(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setNotice('')
    try {
      const nextUser = authMode === 'register'
        ? await api.register(authUsername, authName, authPassword)
        : await api.login(authUsername, authPassword)
      setUser(nextUser)
      setChats([])
      await Promise.all([refreshConversations(nextUser), refreshPeople()])
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível entrar.') }
    finally { setBusy(false) }
  }

  async function signOut() {
    await api.logout().catch(() => undefined)
    setUser(null); setChats([]); setPeople({ friends: [], incoming: [], outgoing: [] }); setPeopleResults([]); setActiveId(''); setNotice('')
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
      const { message } = await api.sendMessage(active.id, text)
      if (user) {
        const mapped = fromApiMessage(message, user)
        setChats(current => current.map(chat => chat.id === active.id && !chat.messages.some(existing => existing.id === mapped.id) ? { ...chat, preview: text, time: mapped.time, messages: [...chat.messages, mapped] } : chat))
      }
      setDraft('')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'A mensagem não foi enviada.') }
  }

  async function openConversation(id: string) {
    setActiveView('messages')
    setActiveId(id)
    setNotice('')
    if (!user) return
    try {
      const page = await api.messages(id)
      await api.markRead(id)
      setChats(current => current.map(chat => chat.id === id ? {
        ...chat,
        messages: page.messages.map(message => fromApiMessage(message, user)),
        olderCursor: page.nextCursor,
        unreadCount: 0,
        preview: page.messages.at(-1)?.text ?? chat.preview,
        time: page.messages.at(-1) ? localTime(page.messages.at(-1)!.createdAt) : chat.time,
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

  if (loading) return <main className="auth-screen"><div className="auth-card"><span className="auth-brand">p</span><p>Conectando ao Prosa…</p></div></main>

  if (!user) return <main className="auth-screen"><form className="auth-card" onSubmit={submitAuth}><span className="auth-brand">p</span><p className="eyebrow">CONVERSAS QUE APROXIMAM</p><h1>{authMode === 'register' ? 'Seu espaço começa aqui.' : 'Que bom ter você de volta.'}</h1><p className="auth-description">{authMode === 'register' ? 'Crie sua conta para começar a conversar.' : 'Entre para continuar suas conversas.'}</p>{authMode === 'register' && <label>Como podemos te chamar?<input autoComplete="name" required maxLength={48} value={authName} onChange={event => setAuthName(event.target.value)} placeholder="Nome de exibição" /></label>}<label>Nome de usuário<input autoComplete="username" required minLength={3} maxLength={24} value={authUsername} onChange={event => setAuthUsername(event.target.value)} placeholder="ex.: ana_silva" /></label><label>Senha<input autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} required minLength={authMode === 'register' ? 12 : 1} maxLength={128} type="password" value={authPassword} onChange={event => setAuthPassword(event.target.value)} placeholder={authMode === 'register' ? 'Pelo menos 12 caracteres' : 'Sua senha'} /></label>{notice && <p className="auth-error" role="alert">{notice}</p>}<button className="auth-submit" disabled={busy}>{busy ? 'Aguarde…' : authMode === 'register' ? 'Criar conta' : 'Entrar'}</button><p className="auth-switch">{authMode === 'register' ? 'Já tem uma conta?' : 'Primeira vez por aqui?'} <button type="button" onClick={() => { setAuthMode(authMode === 'register' ? 'login' : 'register'); setNotice('') }}>{authMode === 'register' ? 'Entrar' : 'Criar conta'}</button></p><p className="auth-local-note">Conta de desenvolvimento: o serviço local guarda os dados neste dispositivo.</p></form></main>

  return <main className="app-shell">
    <aside className="rail">
      <a className="brand-mark" href="#inicio" aria-label="Prosa início"><span>p</span></a>
      <div className="rail-divider" />
      <button className={`rail-button ${activeView === 'messages' ? 'selected' : ''}`} aria-label="Mensagens" onClick={() => setActiveView('messages')}><Icon name="message" /></button>
      <button className={`rail-button ${activeView === 'friends' ? 'selected' : ''}`} aria-label="Contatos" onClick={() => setActiveView('friends')}><Icon name="users" /></button>
      <button className="rail-button" aria-label="Adicionar contato" onClick={() => { setAddContactOpen(true); setPeopleQuery(''); setPeopleResults([]) }}><Icon name="plus" /></button>
      <div className="rail-spacer" />
      <button className="rail-button" aria-label="Configurações" onClick={() => setNotice('As configurações de conta chegam na próxima etapa.')}><Icon name="settings" /></button>
      <button className="profile-orb" aria-label="Sair da conta" onClick={() => void signOut()} title={`${user.displayName} · sair`}>{user.displayName.slice(0, 1).toUpperCase()}<span className="presence-dot" /></button>
    </aside>

    <aside className="sidebar">
      <header className="sidebar-heading"><div><p className="eyebrow">{user.displayName.toLocaleUpperCase('pt-BR')}</p><h1>{activeView === 'friends' ? 'Contatos' : 'Mensagens'}</h1></div><button className="icon-button new-chat" aria-label="Adicionar contato" onClick={() => { setAddContactOpen(true); setPeopleQuery(''); setPeopleResults([]) }}><Icon name="plus" size={18} /></button></header>
      <label className="search-box"><Icon name="search" size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={activeView === 'friends' ? 'Buscar contatos' : 'Buscar conversas'} /><kbd>⌘ K</kbd></label>
      <nav className="tabs" aria-label="Navegação">{[{ id: 'messages', label: 'Mensagens' }, { id: 'friends', label: 'Contatos' }].map(item => <button key={item.id} className={`tab ${activeView === item.id ? 'active' : ''}`} onClick={() => setActiveView(item.id as 'messages' | 'friends')}>{item.label}{item.id === 'friends' && people.incoming.length > 0 && <span className="tab-count">{people.incoming.length}</span>}</button>)}</nav>
      <div className="section-label"><span>{activeView === 'friends' ? 'CONECTADOS' : 'RECENTES'}</span><button aria-label="Atualizar lista" onClick={() => void (activeView === 'friends' ? refreshPeople() : refreshConversations())}><Icon name="more" size={17} /></button></div>
      <div className="conversation-list">{activeView === 'messages' ? filtered.map(chat => <button key={chat.id} className={`conversation ${activeId === chat.id ? 'active' : ''}`} onClick={() => void openConversation(chat.id)}>
        <span className={`avatar ${chat.color}`}>{chat.initials}{chat.online && <i />}</span><span className="conversation-copy"><span className="conversation-top"><strong>{chat.name}</strong><time>{chat.time}</time></span><span className="conversation-bottom"><span>{chat.preview}</span>{chat.unreadCount > 0 && <i className="unread-dot" title={`${chat.unreadCount} mensagens não lidas`} />}</span></span>
      </button>) : people.friends.filter(person => `${person.displayName} ${person.username}`.toLowerCase().includes(query.toLowerCase())).map(person => <button key={person.id} className={`conversation ${activeId === chats.find(chat => chat.handle === `@${person.username}`)?.id ? 'active' : ''}`} onClick={() => { const conversation = chats.find(chat => chat.handle === `@${person.username}`); if (conversation) void openConversation(conversation.id) }}><span className="avatar blue">{person.displayName.split(/\s+/).map(part => part[0]).join('').slice(0,2).toUpperCase()}</span><span className="conversation-copy"><span className="conversation-top"><strong>{person.displayName}</strong></span><span className="conversation-bottom"><span>@{person.username}</span></span></span></button>)}</div>
      <div className="sidebar-bottom"><div className="sync-mark"><span /> Sessão ativa · @{user.username}</div></div>
    </aside>

    <section className="chat-panel">
      {activeView === 'friends' ? <div className="contacts-panel"><header className="chat-header"><div><p className="eyebrow">SUA REDE</p><h2>Contatos</h2></div><button className="auth-submit contact-add" onClick={() => { setAddContactOpen(true); setPeopleQuery(''); setPeopleResults([]) }}>Adicionar pessoa</button></header><div className="contacts-content">{people.incoming.length > 0 && <section className="people-section"><h3>Pedidos recebidos <span>{people.incoming.length}</span></h3>{people.incoming.map(person => <article className="person-row" key={person.id}><span className="avatar violet">{person.displayName.split(/\s+/).map(part => part[0]).join('').slice(0,2).toUpperCase()}</span><div className="person-info"><strong>{person.displayName}</strong><span>@{person.username}</span></div><button className="person-action primary" onClick={() => void acceptRequest(person)}>Aceitar</button><button className="person-action" onClick={() => void dismissRequest(person.id)}>Remover</button></article>)}</section>}{people.outgoing.length > 0 && <section className="people-section"><h3>Pedidos enviados</h3>{people.outgoing.map(person => <article className="person-row" key={person.id}><span className="avatar blue">{person.displayName.split(/\s+/).map(part => part[0]).join('').slice(0,2).toUpperCase()}</span><div className="person-info"><strong>{person.displayName}</strong><span>@{person.username} · aguardando resposta</span></div><button className="person-action" onClick={() => void dismissRequest(person.id)}>Cancelar</button></article>)}</section>}<section className="people-section"><h3>Conectados <span>{people.friends.length}</span></h3>{people.friends.length ? people.friends.map(person => <article className="person-row" key={person.id}><span className="avatar green">{person.displayName.split(/\s+/).map(part => part[0]).join('').slice(0,2).toUpperCase()}<i /></span><div className="person-info"><strong>{person.displayName}</strong><span>@{person.username}</span></div><button className="person-action primary" onClick={() => { const conversation = chats.find(chat => chat.handle === `@${person.username}`); if (conversation) { setActiveView('messages'); setActiveId(conversation.id) } }}>Mensagem</button><button className="person-action" onClick={() => void removeConnection(person)}>Remover</button></article>) : <p className="empty-people">Seus contatos aparecerão aqui quando aceitarem um pedido.</p>}</section></div></div> : active ? <>
      <header className="chat-header"><div className="chat-person"><span className={`avatar small ${active.color}`}>{active.initials}{active.online && <i />}</span><div><h2>{active.name}</h2><p>{active.handle === `@${user.username}` ? 'Conversa pessoal' : 'Conversa direta'}</p></div></div><div className="header-actions"><button className="icon-button" aria-label="Chamada de voz" onClick={() => setNotice('Chamadas estarão disponíveis quando a conexão em tempo real for configurada.')}><Icon name="phone" /></button><button className="icon-button" aria-label="Chamada de vídeo" onClick={() => setNotice('Chamadas estarão disponíveis quando a conexão em tempo real for configurada.')}><Icon name="video" /></button><span className="action-divider" /><button className="icon-button" aria-label="Mais opções" onClick={() => setNotice('Mais opções de conversa em breve.')}><Icon name="more" /></button></div></header>
      <div className="message-scroll" ref={messageScrollRef} onScroll={event => { const element = event.currentTarget; nearBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 100 }}><div className="day-divider"><span>HISTÓRICO</span></div>{active.olderCursor && <button className="load-older" disabled={loadingOlder} onClick={() => void loadOlderMessages()}>{loadingOlder ? 'Carregando…' : 'Carregar mensagens anteriores'}</button>}<div className="messages">{active.messages.map((message, index) => {
        const previous = active.messages[index - 1]
        const grouped = previous?.author === message.author
        return <article key={message.id} className={`message ${message.mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}`}><div className="message-avatar-slot">{!grouped && <span className={`avatar tiny ${message.mine ? 'self' : active.color}`}>{message.mine ? 'V' : message.author.split(' ').map(part => part[0]).join('').slice(0, 2)}</span>}</div><div className="message-body">{!grouped && <div className="message-meta"><strong>{message.mine ? 'Você' : message.author}</strong><time>{message.time}</time></div>}<p>{message.text}</p></div></article>
      })}</div></div>
      <form className="composer" onSubmit={sendMessage}><button type="button" className="composer-tool attach" aria-label="Anexar arquivo" onClick={() => setNotice('O envio de arquivos será ativado com o armazenamento do Prosa.')}><Icon name="paperclip" size={19} /></button><input aria-label="Escrever mensagem" value={draft} onChange={event => setDraft(event.target.value)} placeholder={`Escreva para ${active.name.split(' ')[0]}...`} /><button type="button" className="composer-tool" aria-label="Emoji" onClick={() => setDraft(value => `${value} ✨`)}><Icon name="smile" size={19} /></button><button type="submit" className="send-button" aria-label="Enviar mensagem" disabled={!draft.trim()}><Icon name="send" size={17} /></button></form>
      <footer className="chat-footnote">Mensagens salvas no banco local do Prosa.</footer></> : <div className="empty-chat"><span className="auth-brand">p</span><h2>Seu Prosa está pronto.</h2><p>Encontre pessoas pelo nome de usuário para começar uma conversa.</p><button className="auth-submit" onClick={() => { setAddContactOpen(true); setPeopleQuery(''); setPeopleResults([]) }}>Encontrar pessoas</button></div>}
      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Fechar aviso">×</button></div>}
      {addContactOpen && <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setAddContactOpen(false) }}><section className="people-modal" role="dialog" aria-modal="true" aria-labelledby="add-contact-title"><button className="modal-close" onClick={() => setAddContactOpen(false)} aria-label="Fechar">×</button><p className="eyebrow">AMPLIE SUA REDE</p><h2 id="add-contact-title">Encontre pessoas</h2><p>Busque pelo nome de usuário para enviar um pedido de conexão.</p><label className="people-search"><Icon name="search" size={17} /><input autoFocus value={peopleQuery} onChange={event => { setPeopleQuery(event.target.value); if (event.target.value.trim().replace(/^@/, '').length < 2) setPeopleResults([]) }} placeholder="Digite pelo menos 2 caracteres" /></label><div className="people-results">{peopleQuery.trim().length < 2 ? <p className="empty-people">Comece digitando um nome de usuário.</p> : peopleResults.length ? peopleResults.map(person => <article className="person-row" key={person.id}><span className="avatar blue">{person.displayName.split(/\s+/).map(part => part[0]).join('').slice(0,2).toUpperCase()}</span><div className="person-info"><strong>{person.displayName}</strong><span>@{person.username}</span></div>{person.relationship === 'none' && <button className="person-action primary" onClick={() => void sendFriendRequest(person)}>Conectar</button>}{person.relationship === 'incoming' && <button className="person-action primary" onClick={() => void acceptRequest(person)}>Aceitar</button>}{person.relationship === 'outgoing' && <span className="relationship-label">Pedido enviado</span>}{person.relationship === 'friend' && <span className="relationship-label">Conectados</span>}</article>) : <p className="empty-people">Nenhuma pessoa encontrada.</p>}</div></section></div>}
    </section>
  </main>
}

export default App
