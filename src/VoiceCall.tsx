import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { api } from './api'

type Signal = { conversationId: string; callId: string; type: string; payload?: RTCSessionDescriptionInit | RTCIceCandidateInit; fromUserId?: string; fromDisplayName?: string }
type Props = { conversationId: string; peerName: string; enabled: boolean; open: boolean; startSignal: number; onIncoming: () => void; onClose: () => void; onNotice: (message: string) => void }

function makeCallId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('')
}

export function VoiceCall({ conversationId, peerName, enabled, open, startSignal, onIncoming, onClose, onNotice }: Props) {
  const [status, setStatus] = useState<'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active'>('idle')
  const [callerName, setCallerName] = useState(peerName)
  const [muted, setMuted] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const callIdRef = useRef('')
  const statusRef = useRef(status)
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([])

  function updateStatus(next: typeof status) { statusRef.current = next; setStatus(next) }

  const send = useCallback((type: string, payload?: RTCSessionDescriptionInit | RTCIceCandidateInit) => {
    const socket = socketRef.current
    if (!socket || !callIdRef.current) return
    socket.emit('call:signal', { conversationId, callId: callIdRef.current, type, payload }, (result: { ok: boolean; error?: string }) => {
      if (!result?.ok && result?.error) onNotice(result.error)
    })
  }, [conversationId, onNotice])

  const closeMedia = useCallback(() => {
    peerRef.current?.close()
    peerRef.current = null
    streamRef.current?.getTracks().forEach(track => track.stop())
    streamRef.current = null
    pendingCandidatesRef.current = []
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null
    setMuted(false)
  }, [])

  const makePeer = useCallback(() => {
    if (peerRef.current) return peerRef.current
    const peer = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] })
    peer.onicecandidate = event => { if (event.candidate) send('candidate', event.candidate.toJSON()) }
    peer.ontrack = event => {
      if (remoteAudioRef.current && event.streams[0]) {
        remoteAudioRef.current.srcObject = event.streams[0]
        void remoteAudioRef.current.play().catch(() => onNotice('Toque no áudio recebido para iniciar a reprodução.'))
      }
    }
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') updateStatus('active')
      if (peer.connectionState === 'failed') { closeMedia(); updateStatus('idle'); onNotice('Não foi possível estabelecer a chamada. Verifique a conexão e tente novamente.') }
    }
    peerRef.current = peer
    return peer
  }, [closeMedia, onNotice, send])

  const openMicrophone = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este dispositivo não permite acessar o microfone nesta conexão.')
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false })
    streamRef.current = stream
    return stream
  }, [])

  const beginOffer = useCallback(async () => {
    const stream = await openMicrophone()
    const peer = makePeer()
    for (const track of stream.getTracks()) peer.addTrack(track, stream)
    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    send('offer', peer.localDescription?.toJSON())
    updateStatus('connecting')
  }, [makePeer, openMicrophone, send])

  const acceptIncoming = useCallback(async () => {
    try {
      const stream = await openMicrophone()
      const peer = makePeer()
      for (const track of stream.getTracks()) peer.addTrack(track, stream)
      updateStatus('connecting')
      send('accept')
    } catch (error) {
      send('decline')
      closeMedia(); updateStatus('idle')
      onNotice(error instanceof Error ? error.message : 'Não foi possível acessar o microfone.')
    }
  }, [closeMedia, makePeer, onNotice, openMicrophone, send])

  const endCall = useCallback((type: 'hangup' | 'decline' = 'hangup') => {
    if (callIdRef.current) send(type)
    callIdRef.current = ''
    closeMedia()
    updateStatus('idle')
  }, [closeMedia, send])

  const startCall = useCallback(async () => {
    if (!enabled || statusRef.current !== 'idle') return
    callIdRef.current = makeCallId()
    setCallerName(peerName)
    updateStatus('outgoing')
    send('invite')
  }, [enabled, peerName, send])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    if (!enabled) return
    const socket = io(api.socketOrigin(), { auth: { token: api.sessionToken() }, reconnection: true, reconnectionDelayMax: 5000 })
    socketRef.current = socket
    socket.on('call:signal', (event: Signal) => {
      if (event.conversationId !== conversationId) return
      if (event.type === 'invite') {
        if (statusRef.current !== 'idle') {
          socket.emit('call:signal', { conversationId, callId: event.callId, type: 'busy' })
          return
        }
        callIdRef.current = event.callId
        setCallerName(event.fromDisplayName ?? peerName)
        updateStatus('incoming')
        onIncoming()
      } else if (event.callId !== callIdRef.current || !callIdRef.current) return
      if (event.type === 'accept' && statusRef.current === 'outgoing') {
        void beginOffer().catch(error => { endCall(); onNotice(error instanceof Error ? error.message : 'Não foi possível iniciar a chamada.') })
      } else if (event.type === 'offer' && event.payload && peerRef.current) {
        void (async () => {
          const peer = peerRef.current!
          await peer.setRemoteDescription(event.payload as RTCSessionDescriptionInit)
          for (const candidate of pendingCandidatesRef.current.splice(0)) await peer.addIceCandidate(candidate)
          const answer = await peer.createAnswer()
          await peer.setLocalDescription(answer)
          send('answer', peer.localDescription?.toJSON())
        })().catch(error => { endCall(); onNotice(error instanceof Error ? error.message : 'Não foi possível responder à chamada.') })
      } else if (event.type === 'answer' && event.payload && peerRef.current) {
        void (async () => {
          const peer = peerRef.current!
          await peer.setRemoteDescription(event.payload as RTCSessionDescriptionInit)
          for (const candidate of pendingCandidatesRef.current.splice(0)) await peer.addIceCandidate(candidate)
        })().catch(error => { endCall(); onNotice(error instanceof Error ? error.message : 'Não foi possível conectar a chamada.') })
      } else if (event.type === 'candidate' && event.payload) {
        const candidate = event.payload as RTCIceCandidateInit
        if (peerRef.current?.remoteDescription) void peerRef.current.addIceCandidate(candidate).catch(() => undefined)
        else pendingCandidatesRef.current.push(candidate)
      } else if (event.type === 'decline' || event.type === 'busy' || event.type === 'hangup') {
        closeMedia(); callIdRef.current = ''; updateStatus('idle')
        onClose()
        onNotice(event.type === 'busy' ? 'A outra pessoa já está em uma chamada.' : event.type === 'decline' ? 'A chamada foi recusada.' : 'A chamada foi encerrada.')
      }
    })
    socket.on('call:ended', (event: { conversationId: string }) => {
      if (event.conversationId !== conversationId) return
      closeMedia(); callIdRef.current = ''; updateStatus('idle')
      onNotice('A conexão foi encerrada porque o acesso à conversa mudou.')
    })
    socket.on('disconnect', () => {
      if (statusRef.current !== 'idle') { closeMedia(); callIdRef.current = ''; updateStatus('idle') }
    })
    return () => {
      if (callIdRef.current) socket.emit('call:signal', { conversationId, callId: callIdRef.current, type: 'hangup' })
      callIdRef.current = ''
      socket.disconnect()
      socketRef.current = null
      closeMedia()
    }
  }, [acceptIncoming, beginOffer, closeMedia, conversationId, enabled, endCall, makePeer, onClose, onIncoming, onNotice, peerName, send])

  useEffect(() => {
    if (startSignal > 0) void startCall()
  }, [startCall, startSignal])

  function toggleMute() {
    const next = !muted
    streamRef.current?.getAudioTracks().forEach(track => { track.enabled = !next })
    setMuted(next)
  }

  return <>
    <audio ref={remoteAudioRef} autoPlay />
    {!open && status === 'idle' ? null :
    <section className="voice-call-panel" aria-label="Chamada de voz" role="dialog" aria-modal="false">
      <header><strong>{status === 'incoming' ? `${callerName} está ligando` : status === 'outgoing' ? `Chamando ${peerName}…` : status === 'connecting' ? 'Conectando chamada…' : status === 'active' ? `Em chamada com ${peerName}` : 'Chamada de voz'}</strong><button className="voice-call-close" aria-label="Fechar painel de chamada" onClick={onClose}>×</button></header>
      <p role="status">{status === 'incoming' ? 'Chamada de voz recebida' : status === 'active' ? 'Microfone ativo' : status === 'connecting' ? 'Aguarde a conexão' : status === 'outgoing' ? 'Aguardando resposta' : 'Chamada encerrada'}</p>
      <div className="voice-call-controls">
        {status === 'idle' && <button className="person-action primary" onClick={() => void startCall()}>Ligar</button>}
        {status === 'incoming' && <><button className="person-action primary" onClick={() => void acceptIncoming()}>Atender</button><button className="person-action danger" onClick={() => endCall('decline')}>Recusar</button></>}
        {(status === 'connecting' || status === 'active' || status === 'outgoing') && <><button className="person-action" aria-pressed={muted} disabled={status !== 'active'} onClick={toggleMute}>{muted ? 'Ativar microfone' : 'Silenciar'}</button><button className="person-action danger" onClick={() => endCall()}>Encerrar</button></>}
      </div>
    </section>}
  </>
}
