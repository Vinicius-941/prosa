import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import { api } from './api'

type CallMedia = 'audio' | 'video'
type CallPayload = RTCSessionDescriptionInit | RTCIceCandidateInit | { media: CallMedia }
type Signal = { conversationId: string; callId: string; type: string; payload?: CallPayload; fromUserId?: string; fromDisplayName?: string }
type Props = { conversationId: string; peerName: string; enabled: boolean; open: boolean; startSignal: number; startMode: CallMedia; onIncoming: () => void; onClose: () => void; onNotice: (message: string) => void }

function makeCallId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), value => value.toString(16).padStart(2, '0')).join('')
}

function supportsScreenShare() {
  const mediaDevices = navigator.mediaDevices as (MediaDevices & { getDisplayMedia?: unknown }) | undefined
  return typeof mediaDevices?.getDisplayMedia === 'function'
}

export function VoiceCall({ conversationId, peerName, enabled, open, startSignal, startMode, onIncoming, onClose, onNotice }: Props) {
  const [status, setStatus] = useState<'idle' | 'outgoing' | 'incoming' | 'connecting' | 'active'>('idle')
  const [callerName, setCallerName] = useState(peerName)
  const [videoCall, setVideoCall] = useState(false)
  const videoCallRef = useRef(false)
  const [muted, setMuted] = useState(false)
  const [cameraEnabled, setCameraEnabled] = useState(false)
  const [sharingScreen, setSharingScreen] = useState(false)
  const [remoteVideoEnabled, setRemoteVideoEnabled] = useState(false)
  const socketRef = useRef<Socket | null>(null)
  const peerRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const remoteStreamRef = useRef<MediaStream | null>(null)
  const screenStreamRef = useRef<MediaStream | null>(null)
  const videoSenderRef = useRef<RTCRtpSender | null>(null)
  const remoteAudioRef = useRef<HTMLAudioElement>(null)
  const remoteVideoRef = useRef<HTMLVideoElement>(null)
  const localVideoRef = useRef<HTMLVideoElement>(null)
  const callIdRef = useRef('')
  const statusRef = useRef(status)
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([])

  function updateStatus(next: typeof status) { statusRef.current = next; setStatus(next) }

  const send = useCallback((type: string, payload?: CallPayload) => {
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
    screenStreamRef.current?.getTracks().forEach(track => { track.onended = null; track.stop() })
    screenStreamRef.current = null
    remoteStreamRef.current = null
    videoSenderRef.current = null
    pendingCandidatesRef.current = []
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null
    if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null
    if (localVideoRef.current) localVideoRef.current.srcObject = null
    setMuted(false)
    videoCallRef.current = false
    setVideoCall(false)
    setCameraEnabled(false)
    setSharingScreen(false)
    setRemoteVideoEnabled(false)
  }, [])

  const makePeer = useCallback(async () => {
    if (peerRef.current) return peerRef.current
    const { iceServers } = await api.iceServers()
    const peer = new RTCPeerConnection({ iceServers })
    peer.onicecandidate = event => { if (event.candidate) send('candidate', event.candidate.toJSON()) }
    peer.ontrack = event => {
      const remote = remoteStreamRef.current ?? new MediaStream()
      remoteStreamRef.current = remote
      if (!remote.getTracks().some(track => track.id === event.track.id)) remote.addTrack(event.track)
      if (remoteAudioRef.current) remoteAudioRef.current.srcObject = remote
      if (event.track.kind === 'video') {
        event.track.onunmute = () => setRemoteVideoEnabled(true)
        event.track.onmute = () => setRemoteVideoEnabled(false)
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remote
          void remoteVideoRef.current.play().catch(() => undefined)
        }
      } else if (remoteAudioRef.current) {
        void remoteAudioRef.current.play().catch(() => onNotice('Toque no áudio recebido para iniciar a reprodução.'))
      }
    }
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === 'connected') updateStatus('active')
      if (peer.connectionState === 'failed') { closeMedia(); updateStatus('idle'); onNotice('Não foi possível estabelecer a chamada. Verifique a conexão e tente novamente.') }
    }
    peerRef.current = peer
    videoSenderRef.current = peer.addTransceiver('video', { direction: 'sendrecv' }).sender
    return peer
  }, [closeMedia, onNotice, send])

  const openMicrophone = useCallback(async (withVideo: boolean) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este dispositivo não permite acessar o microfone nesta conexão.')
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: withVideo ? { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } : false })
    streamRef.current = stream
    setCameraEnabled(stream.getVideoTracks().length > 0)
    if (localVideoRef.current) localVideoRef.current.srcObject = stream
    return stream
  }, [])

  const attachLocalTracks = useCallback(async (stream: MediaStream, peer: RTCPeerConnection) => {
    for (const track of stream.getAudioTracks()) peer.addTrack(track, stream)
    const camera = stream.getVideoTracks()[0]
    if (camera) await videoSenderRef.current?.replaceTrack(camera)
  }, [])

  const beginOffer = useCallback(async () => {
    const stream = await openMicrophone(videoCallRef.current)
    const peer = await makePeer()
    await attachLocalTracks(stream, peer)
    const offer = await peer.createOffer()
    await peer.setLocalDescription(offer)
    send('offer', peer.localDescription?.toJSON())
    updateStatus('connecting')
  }, [attachLocalTracks, makePeer, openMicrophone, send])

  const acceptIncoming = useCallback(async () => {
    try {
      const stream = await openMicrophone(videoCallRef.current)
      const peer = await makePeer()
      await attachLocalTracks(stream, peer)
      updateStatus('connecting')
      send('accept')
    } catch (error) {
      send('decline')
      closeMedia(); updateStatus('idle')
      onNotice(error instanceof Error ? error.message : 'Não foi possível acessar a mídia da chamada.')
    }
  }, [attachLocalTracks, closeMedia, makePeer, onNotice, openMicrophone, send])

  const endCall = useCallback((type: 'hangup' | 'decline' = 'hangup') => {
    if (callIdRef.current) send(type)
    callIdRef.current = ''
    closeMedia()
    updateStatus('idle')
  }, [closeMedia, send])

  const startCall = useCallback((withVideo: boolean) => {
    if (!enabled || statusRef.current !== 'idle') return
    callIdRef.current = makeCallId()
    setCallerName(peerName)
    videoCallRef.current = withVideo
    setVideoCall(withVideo)
    updateStatus('outgoing')
    send('invite', { media: withVideo ? 'video' : 'audio' })
  }, [enabled, peerName, send])

  useEffect(() => {
    statusRef.current = status
  }, [status])

  useEffect(() => {
    if (localVideoRef.current) localVideoRef.current.srcObject = screenStreamRef.current ?? streamRef.current
    if (remoteVideoRef.current && remoteStreamRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current
      void remoteVideoRef.current.play().catch(() => undefined)
    }
  }, [cameraEnabled, remoteVideoEnabled, sharingScreen])

  useEffect(() => {
    if (!enabled) return
    const socket = io(api.socketOrigin(), { auth: callback => { void api.sessionToken().then(token => callback(token ? { token } : {})) }, withCredentials: api.desktopPlatform() === 'web', reconnection: true, reconnectionDelayMax: 5000 })
    socketRef.current = socket
    socket.on('call:signal', (event: Signal) => {
      if (event.conversationId !== conversationId) return
      if (event.type === 'invite') {
        if (statusRef.current !== 'idle') {
          socket.emit('call:signal', { conversationId, callId: event.callId, type: 'busy' })
          return
        }
        callIdRef.current = event.callId
        const media = event.payload && 'media' in event.payload ? event.payload.media : 'audio'
        videoCallRef.current = media === 'video'
        setVideoCall(media === 'video')
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
  }, [acceptIncoming, beginOffer, closeMedia, conversationId, enabled, endCall, onClose, onIncoming, onNotice, peerName, send])

  useEffect(() => {
    if (startSignal > 0) startCall(startMode === 'video')
  }, [startCall, startMode, startSignal])

  function toggleMute() {
    const next = !muted
    streamRef.current?.getAudioTracks().forEach(track => { track.enabled = !next })
    setMuted(next)
  }

  async function toggleCamera() {
    const stream = streamRef.current
    if (!stream) return
    if (cameraEnabled) {
      const camera = stream.getVideoTracks()[0]
      if (camera) { stream.removeTrack(camera); camera.stop() }
      if (!sharingScreen) await videoSenderRef.current?.replaceTrack(null)
      setCameraEnabled(false)
    } else {
      try {
        const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
        const track = camera.getVideoTracks()[0]
        if (!track) return
        stream.addTrack(track)
        if (!sharingScreen) await videoSenderRef.current?.replaceTrack(track)
        setCameraEnabled(true)
      } catch (error) { onNotice(error instanceof Error ? error.message : 'Não foi possível acessar a câmera.') }
    }
  }

  async function stopScreenShare() {
    const screen = screenStreamRef.current
    screenStreamRef.current = null
    screen?.getTracks().forEach(track => { track.onended = null; track.stop() })
    await videoSenderRef.current?.replaceTrack(streamRef.current?.getVideoTracks()[0] ?? null)
    if (localVideoRef.current) localVideoRef.current.srcObject = streamRef.current
    setSharingScreen(false)
  }

  async function toggleScreenShare() {
    if (sharingScreen) return stopScreenShare()
    if (!supportsScreenShare()) return onNotice('O compartilhamento de tela não está disponível neste dispositivo.')
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false })
      const screen = stream.getVideoTracks()[0]
      if (!screen || !videoSenderRef.current) { stream.getTracks().forEach(track => track.stop()); return }
      screenStreamRef.current = stream
      await videoSenderRef.current.replaceTrack(screen)
      if (localVideoRef.current) localVideoRef.current.srcObject = stream
      screen.onended = () => { void stopScreenShare() }
      setSharingScreen(true)
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') return
      screenStreamRef.current?.getTracks().forEach(track => { track.onended = null; track.stop() })
      screenStreamRef.current = null
      if (localVideoRef.current) localVideoRef.current.srcObject = streamRef.current
      setSharingScreen(false)
      onNotice(error instanceof Error ? error.message : 'Não foi possível compartilhar a tela.')
    }
  }

  return <>
    <audio ref={remoteAudioRef} autoPlay />
    {!open && status === 'idle' ? null :
    <section className="voice-call-panel" aria-label={videoCall ? 'Chamada de vídeo' : 'Chamada de voz'} role="dialog" aria-modal="false">
      <header><strong>{status === 'incoming' ? `${callerName} está ligando` : status === 'outgoing' ? `Chamando ${peerName}…` : status === 'connecting' ? 'Conectando chamada…' : status === 'active' ? `Em chamada com ${peerName}` : 'Nova chamada'}</strong><button className="voice-call-close" aria-label="Fechar painel de chamada" onClick={onClose}>×</button></header>
      {remoteVideoEnabled || cameraEnabled || sharingScreen ? <div className="call-video-stage"><video ref={remoteVideoRef} autoPlay playsInline muted aria-label={`Vídeo de ${peerName}`} /><video ref={localVideoRef} autoPlay playsInline muted className="call-local-video" aria-label="Prévia da sua câmera" /></div> : <video ref={localVideoRef} className="sr-only" autoPlay playsInline muted />}
      <p role="status">{status === 'incoming' ? `Chamada de ${videoCall ? 'vídeo' : 'voz'} recebida` : status === 'active' ? (sharingScreen ? 'Compartilhando sua tela' : cameraEnabled || remoteVideoEnabled ? 'Vídeo conectado' : 'Microfone ativo') : status === 'connecting' ? 'Aguarde a conexão' : status === 'outgoing' ? 'Aguardando resposta' : 'Chamada encerrada'}</p>
      <div className="voice-call-controls">
        {status === 'idle' && <><button className="person-action primary" onClick={() => startCall(false)}>Ligar por voz</button><button className="person-action primary" onClick={() => startCall(true)}>Ligar com vídeo</button></>}
        {status === 'incoming' && <><button className="person-action primary" onClick={() => void acceptIncoming()}>Atender</button><button className="person-action danger" onClick={() => endCall('decline')}>Recusar</button></>}
        {(status === 'connecting' || status === 'active' || status === 'outgoing') && <><button className="person-action" aria-pressed={muted} disabled={status !== 'active'} onClick={toggleMute}>{muted ? 'Ativar microfone' : 'Silenciar'}</button>{status === 'active' && <><button className="person-action" aria-pressed={cameraEnabled} onClick={() => void toggleCamera()}>{cameraEnabled ? 'Desligar câmera' : 'Ligar câmera'}</button>{supportsScreenShare() && <button className="person-action" aria-pressed={sharingScreen} onClick={() => void toggleScreenShare()}>{sharingScreen ? 'Parar compartilhamento' : 'Compartilhar tela'}</button>}</>}<button className="person-action danger" onClick={() => endCall()}>Encerrar</button></>}
      </div>
    </section>}
  </>
}
