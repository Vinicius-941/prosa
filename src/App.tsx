import { useMemo, useState, type FormEvent } from 'react'
import './App.css'

type Message = { id: number; author: string; time: string; text: string; mine?: boolean }
type Conversation = { id: string; name: string; handle: string; initials: string; color: string; online?: boolean; preview: string; time: string; unread?: number; messages: Message[] }

const initial: Conversation[] = [
  { id: 'lia', name: 'Lia Martins', handle: '@liamartins', initials: 'LM', color: 'coral', online: true, preview: 'te mando a referência já já ✨', time: '14:32', unread: 2, messages: [
    { id: 1, author: 'Lia Martins', time: '14:24', text: 'Oi! Você viu o material que mandei sobre o projeto?' },
    { id: 2, author: 'Você', time: '14:27', text: 'Vi sim — gostei muito da direção. A paleta ficou ótima.', mine: true },
    { id: 3, author: 'Lia Martins', time: '14:29', text: 'Também achei! Podemos fechar os últimos detalhes hoje?' },
    { id: 4, author: 'Você', time: '14:30', text: 'Claro. Depois do almoço funciona pra mim.', mine: true },
    { id: 5, author: 'Lia Martins', time: '14:32', text: 'te mando a referência já já ✨' },
  ] },
  { id: 'caio', name: 'Caio Nunes', handle: '@caionunes', initials: 'CN', color: 'blue', preview: 'Perfeito, combinado!', time: '13:08', messages: [
    { id: 1, author: 'Você', time: '13:02', text: 'Consegui reservar a sala para quinta.', mine: true },
    { id: 2, author: 'Caio Nunes', time: '13:08', text: 'Perfeito, combinado!' },
  ] },
  { id: 'equipe', name: 'Equipe de Produto', handle: '3 participantes', initials: 'EP', color: 'violet', preview: 'Marina: deixei os pontos no documento', time: 'Ontem', unread: 1, messages: [
    { id: 1, author: 'Marina', time: '16:41', text: 'deixei os pontos no documento para a gente revisar amanhã' },
  ] },
  { id: 'bia', name: 'Bia Costa', handle: '@biacosta', initials: 'BC', color: 'green', preview: 'Obrigada pela ajuda! 💛', time: 'Seg', messages: [
    { id: 1, author: 'Bia Costa', time: '11:18', text: 'Obrigada pela ajuda! 💛' },
  ] },
]

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
  const [chats, setChats] = useState(initial)
  const [activeId, setActiveId] = useState('lia')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [tab, setTab] = useState('Todas')
  const [notice, setNotice] = useState('')
  const active = chats.find(chat => chat.id === activeId) ?? chats[0]
  const filtered = useMemo(() => chats.filter(chat => `${chat.name} ${chat.handle}`.toLowerCase().includes(query.toLowerCase())), [chats, query])

  function sendMessage(event: FormEvent) {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    const message: Message = { id: Date.now(), author: 'Você', time: new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(new Date()), text, mine: true }
    setChats(current => current.map(chat => chat.id === activeId ? { ...chat, preview: text, time: 'agora', messages: [...chat.messages, message] } : chat))
    setDraft('')
  }

  return <main className="app-shell">
    <aside className="rail">
      <a className="brand-mark" href="#inicio" aria-label="Prosa início"><span>p</span></a>
      <div className="rail-divider" />
      <button className="rail-button selected" aria-label="Mensagens"><Icon name="message" /></button>
      <button className="rail-button" aria-label="Adicionar conversa" onClick={() => setNotice('Em breve: iniciar uma nova conversa.')}><Icon name="plus" /></button>
      <div className="rail-spacer" />
      <button className="rail-button" aria-label="Configurações" onClick={() => setNotice('As configurações de conta chegam na próxima etapa.')}><Icon name="settings" /></button>
      <button className="profile-orb" aria-label="Seu perfil">V<span className="presence-dot" /></button>
    </aside>

    <aside className="sidebar">
      <header className="sidebar-heading"><div><p className="eyebrow">ESPAÇO PESSOAL</p><h1>Mensagens</h1></div><button className="icon-button new-chat" aria-label="Nova conversa" onClick={() => setNotice('Em breve: iniciar uma nova conversa.')}><Icon name="plus" size={18} /></button></header>
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
      <footer className="chat-footnote">Esta conversa está salva neste dispositivo.</footer>
    </section>
  </main>
}

export default App
