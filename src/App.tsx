import { useEffect, useMemo, useState, type FormEvent } from 'react'
import './App.css'
import { api, type ApiConversation, type ApiMessage, type ProsaUser } from './api'

type Message = { id: number; author: string; time: string; text: string; mine?: boolean }
type Conversation = { id: string; name: string; handle: string; initials: string; color: string; online?: boolean; preview: string; time: string; unread?: number; messages: Message[] }

function localTime(value: string) {
  return new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function fromApiMessage(message: ApiMessage, user: ProsaUser): Message {
  return { id: Date.parse(message.createdAt), author: message.authorId === user.id ? 'Você' : message.author, time: localTime(message.createdAt), text: message.text, mine: message.authorId === user.id }
}

function fromApiConversation(conversation: ApiConversation, messages: ApiMessage[], user: ProsaUser): Conversation {
  const initials = conversation.name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()
  const color = ['coral', 'blue', 'violet', 'green'][parseInt(conversation.id.slice(0, 2), 16) % 4]
  return { id: conversation.id, name: conversation.name, handle: `@${user.username}`, initials, color, preview: messages.at(-1)?.text ?? 'Conversa criada', time: messages.at(-1) ? localTime(messages.at(-1)!.createdAt) : 'agora', messages: messages.map(message => fromApiMessage(message, user)) }
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>, plus: <><path d="M12 5v14M5 12h14"/></>,
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
  const [tab, setTab] = useState('Todas')
  const [notice, setNotice] = useState('')
  const [user, setUser] = useState<ProsaUser | null>(null)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('register')
  const [authName, setAuthName] = useState('')
  const [authUsername, setAuthUsername] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [loading, setLoading] = useState(() => api.hasSession())
  const [busy, setBusy] = useState(false)
  const active = chats.find(chat => chat.id === activeId) ?? chats[0]
  const filtered = useMemo(() => chats.filter(chat => `${chat.name} ${chat.handle}`.toLowerCase().includes(query.toLowerCase())), [chats, query])

  async function refreshConversations(currentUser = user) {
    if (!currentUser) return
    const { conversations } = await api.conversations()
    const mapped = await Promise.all(conversations.map(async conversation => {
      const { messages } = await api.messages(conversation.id)
      return fromApiConversation(conversation, messages, currentUser)
    }))
    setChats(mapped)
    setActiveId(current => mapped.some(chat => chat.id === current) ? current : mapped[0]?.id ?? '')
  }

  useEffect(() => {
    let mounted = true
    if (!api.hasSession()) return () => { mounted = false }
    api.me().then(async ({ user: currentUser }) => {
      if (!mounted) return
      setUser(currentUser)
      const { conversations } = await api.conversations()
      const mapped = await Promise.all(conversations.map(async conversation => {
        const { messages } = await api.messages(conversation.id)
        return fromApiConversation(conversation, messages, currentUser)
      }))
      if (mounted) { setChats(mapped); setActiveId(mapped[0]?.id ?? '') }
    }).catch(() => { void api.logout() }).finally(() => { if (mounted) setLoading(false) })
    return () => { mounted = false }
  }, [])

  async function submitAuth(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setNotice('')
    try {
      const nextUser = authMode === 'register'
        ? await api.register(authUsername, authName, authPassword)
        : await api.login(authUsername, authPassword)
      setUser(nextUser)
      setChats([])
      await refreshConversations(nextUser)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Não foi possível entrar.') }
    finally { setBusy(false) }
  }

  async function signOut() {
    await api.logout().catch(() => undefined)
    setUser(null); setChats([]); setActiveId(''); setNotice('')
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text || !active) return
    try {
      const { message } = await api.sendMessage(active.id, text)
      if (user) {
        const mapped = fromApiMessage(message, user)
        setChats(current => current.map(chat => chat.id === active.id ? { ...chat, preview: text, time: mapped.time, messages: [...chat.messages, mapped] } : chat))
      }
      setDraft('')
    } catch (error) { setNotice(error instanceof Error ? error.message : 'A mensagem não foi enviada.') }
  }

  if (loading) return <main className="auth-screen"><div className="auth-card"><span className="auth-brand">p</span><p>Conectando ao Prosa…</p></div></main>

  if (!user) return <main className="auth-screen"><form className="auth-card" onSubmit={submitAuth}><span className="auth-brand">p</span><p className="eyebrow">CONVERSAS QUE APROXIMAM</p><h1>{authMode === 'register' ? 'Seu espaço começa aqui.' : 'Que bom ter você de volta.'}</h1><p className="auth-description">{authMode === 'register' ? 'Crie sua conta para começar a conversar.' : 'Entre para continuar suas conversas.'}</p>{authMode === 'register' && <label>Como podemos te chamar?<input autoComplete="name" required maxLength={48} value={authName} onChange={event => setAuthName(event.target.value)} placeholder="Nome de exibição" /></label>}<label>Nome de usuário<input autoComplete="username" required minLength={3} maxLength={24} value={authUsername} onChange={event => setAuthUsername(event.target.value)} placeholder="ex.: ana_silva" /></label><label>Senha<input autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} required minLength={authMode === 'register' ? 12 : 1} maxLength={128} type="password" value={authPassword} onChange={event => setAuthPassword(event.target.value)} placeholder={authMode === 'register' ? 'Pelo menos 12 caracteres' : 'Sua senha'} /></label>{notice && <p className="auth-error" role="alert">{notice}</p>}<button className="auth-submit" disabled={busy}>{busy ? 'Aguarde…' : authMode === 'register' ? 'Criar conta' : 'Entrar'}</button><p className="auth-switch">{authMode === 'register' ? 'Já tem uma conta?' : 'Primeira vez por aqui?'} <button type="button" onClick={() => { setAuthMode(authMode === 'register' ? 'login' : 'register'); setNotice('') }}>{authMode === 'register' ? 'Entrar' : 'Criar conta'}</button></p><p className="auth-local-note">Conta de desenvolvimento: o serviço local guarda os dados neste dispositivo.</p></form></main>

  if (!active) return <main className="auth-screen"><section className="auth-card"><span className="auth-brand">p</span><p className="eyebrow">OLÁ, {user.displayName.toLocaleUpperCase('pt-BR')}</p><h1>Seu Prosa está pronto.</h1><p className="auth-description">Sua conta e seu espaço pessoal foram criados. A criação de conversas com outras pessoas virá na próxima etapa.</p><button className="auth-submit" onClick={() => void signOut()}>Sair da conta</button></section></main>

  return <main className="app-shell">
    <aside className="rail">
      <a className="brand-mark" href="#inicio" aria-label="Prosa início"><span>p</span></a>
      <div className="rail-divider" />
      <button className="rail-button selected" aria-label="Mensagens"><Icon name="message" /></button>
      <button className="rail-button" aria-label="Adicionar conversa" onClick={() => setNotice('Em breve: iniciar uma nova conversa.')}><Icon name="plus" /></button>
      <div className="rail-spacer" />
      <button className="rail-button" aria-label="Configurações" onClick={() => setNotice('As configurações de conta chegam na próxima etapa.')}><Icon name="settings" /></button>
      <button className="profile-orb" aria-label="Sair da conta" onClick={() => void signOut()} title={`${user.displayName} · sair`}>{user.displayName.slice(0, 1).toUpperCase()}<span className="presence-dot" /></button>
    </aside>

    <aside className="sidebar">
      <header className="sidebar-heading"><div><p className="eyebrow">{user.displayName.toLocaleUpperCase('pt-BR')}</p><h1>Mensagens</h1></div><button className="icon-button new-chat" aria-label="Nova conversa" onClick={() => setNotice('Nesta etapa, sua conta possui uma conversa pessoal.')}><Icon name="plus" size={18} /></button></header>
      <label className="search-box"><Icon name="search" size={17} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar conversas" /><kbd>⌘ K</kbd></label>
      <nav className="tabs" aria-label="Filtrar conversas">{['Todas', 'Não lidas'].map(item => <button key={item} className={tab === item ? 'tab active' : 'tab'} onClick={() => setTab(item)}>{item}{item === 'Não lidas' && <span className="tab-count">3</span>}</button>)}</nav>
      <div className="section-label"><span>RECENTES</span><button aria-label="Opções das conversas"><Icon name="more" size={17} /></button></div>
      <div className="conversation-list">{filtered.filter(chat => tab === 'Todas' || chat.unread).map(chat => <button key={chat.id} className={`conversation ${activeId === chat.id ? 'active' : ''}`} onClick={() => { setActiveId(chat.id); setNotice('') }}>
        <span className={`avatar ${chat.color}`}>{chat.initials}{chat.online && <i />}</span><span className="conversation-copy"><span className="conversation-top"><strong>{chat.name}</strong><time>{chat.time}</time></span><span className="conversation-bottom"><span>{chat.preview}</span>{chat.unread && <i className="unread-dot" />}</span></span>
      </button>)}</div>
      <div className="sidebar-bottom"><div className="sync-mark"><span /> Mensagens protegidas por conexão segura</div></div>
    </aside>

    <section className="chat-panel">
      <header className="chat-header"><div className="chat-person"><span className={`avatar small ${active.color}`}>{active.initials}{active.online && <i />}</span><div><h2>{active.name}</h2><p>{active.online ? <><span className="online-label">●</span> Ativa agora</> : active.handle}</p></div></div><div className="header-actions"><button className="icon-button" aria-label="Chamada de voz" onClick={() => setNotice('Chamadas estarão disponíveis quando a conexão em tempo real for configurada.')}><Icon name="phone" /></button><button className="icon-button" aria-label="Chamada de vídeo" onClick={() => setNotice('Chamadas estarão disponíveis quando a conexão em tempo real for configurada.')}><Icon name="video" /></button><span className="action-divider" /><button className="icon-button" aria-label="Mais opções" onClick={() => setNotice('Mais opções de conversa em breve.')}><Icon name="more" /></button></div></header>
      <div className="message-scroll"><div className="day-divider"><span>HOJE</span></div><div className="messages">{active.messages.map((message, index) => {
        const previous = active.messages[index - 1]
        const grouped = previous?.author === message.author
        return <article key={message.id} className={`message ${message.mine ? 'mine' : ''} ${grouped ? 'grouped' : ''}`}><div className="message-avatar-slot">{!grouped && <span className={`avatar tiny ${message.mine ? 'self' : active.color}`}>{message.mine ? 'V' : message.author.split(' ').map(part => part[0]).join('').slice(0, 2)}</span>}</div><div className="message-body">{!grouped && <div className="message-meta"><strong>{message.mine ? 'Você' : message.author}</strong><time>{message.time}</time></div>}<p>{message.text}</p></div></article>
      })}</div><div className="typing-line"><span className="typing-dots"><i /><i /><i /></span><span>{active.name.split(' ')[0]} está por aqui</span></div></div>
      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Fechar aviso">×</button></div>}
      <form className="composer" onSubmit={sendMessage}><button type="button" className="composer-tool attach" aria-label="Anexar arquivo" onClick={() => setNotice('O envio de arquivos será ativado com o armazenamento do Prosa.')}><Icon name="paperclip" size={19} /></button><input aria-label="Escrever mensagem" value={draft} onChange={event => setDraft(event.target.value)} placeholder={`Escreva para ${active.name.split(' ')[0]}...`} /><button type="button" className="composer-tool" aria-label="Emoji" onClick={() => setDraft(value => `${value} ✨`)}><Icon name="smile" size={19} /></button><button type="submit" className="send-button" aria-label="Enviar mensagem" disabled={!draft.trim()}><Icon name="send" size={17} /></button></form>
      <footer className="chat-footnote">Mensagens salvas no banco local do Prosa.</footer>
    </section>
  </main>
}

export default App
