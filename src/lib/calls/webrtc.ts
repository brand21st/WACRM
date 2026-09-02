import { normalizeOfferSdp } from './sdp'

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
]

export async function createInboundPeerConnection(
  offerSdp: string,
  /**
   * Must be registered *before* setRemoteDescription — Chromium fires
   * `track` during that call, and a handler attached afterwards never
   * sees the remote audio.
   */
  wireRemote?: (pc: RTCPeerConnection) => void,
  options?: { localStream?: MediaStream },
): Promise<{
  pc: RTCPeerConnection
  localStream: MediaStream
}> {
  const localStream =
    options?.localStream ??
    (await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: false,
    }))
  // Keep muted until Meta's accept returns 200 — sending RTP early
  // makes WhatsApp treat the call as already answered.
  for (const track of localStream.getAudioTracks()) {
    track.enabled = false
  }

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  wireRemote?.(pc)
  for (const track of localStream.getTracks()) {
    pc.addTrack(track, localStream)
  }

  await pc.setRemoteDescription({
    type: 'offer',
    sdp: normalizeOfferSdp(offerSdp),
  })
  const answer = await pc.createAnswer()
  await pc.setLocalDescription(answer)
  await waitForIceGathering(pc)
  return { pc, localStream }
}

export function bindRemoteStream(
  audioEl: HTMLAudioElement,
  stream: MediaStream,
  onAttached?: (el: HTMLAudioElement) => void,
): void {
  for (const track of stream.getAudioTracks()) {
    track.enabled = true
  }
  audioEl.srcObject = stream
  audioEl.autoplay = true
  void audioEl.play().catch(() => {
    // Autoplay may still block; speaker toggle / Answer retries play().
  })
  onAttached?.(audioEl)
}

export function attachRemoteAudio(
  pc: RTCPeerConnection,
  audioEl: HTMLAudioElement,
  onAttached?: (el: HTMLAudioElement) => void,
): void {
  const onTrack = (event: RTCTrackEvent) => {
    if (event.track.kind !== 'audio') return
    event.track.enabled = true
    const stream = event.streams[0] ?? new MediaStream([event.track])
    bindRemoteStream(audioEl, stream, onAttached)
  }
  pc.addEventListener('track', onTrack)
  for (const receiver of pc.getReceivers()) {
    const track = receiver.track
    if (!track || track.kind !== 'audio' || track.readyState === 'ended') continue
    bindRemoteStream(audioEl, new MediaStream([track]), onAttached)
  }
}

function waitForIceGathering(pc: RTCPeerConnection, timeoutMs = 5000): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') done()
    }
    pc.addEventListener('icegatheringstatechange', onChange)
    setTimeout(done, timeoutMs)
  })
}

export function waitForIceConnected(
  pc: RTCPeerConnection,
  timeoutMs = 15000,
): Promise<void> {
  const iceOk = (s: RTCIceConnectionState) => s === 'connected' || s === 'completed'
  const connOk = (s: RTCPeerConnectionState) => s === 'connected'
  if (iceOk(pc.iceConnectionState) || connOk(pc.connectionState)) {
    return Promise.resolve()
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      pc.removeEventListener('iceconnectionstatechange', onChange)
      pc.removeEventListener('connectionstatechange', onChange)
    }
    const succeed = () => {
      cleanup()
      resolve()
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('ICE timeout'))
    }, timeoutMs)
    const onChange = () => {
      if (iceOk(pc.iceConnectionState) || connOk(pc.connectionState)) {
        succeed()
      } else if (
        pc.iceConnectionState === 'failed' ||
        pc.iceConnectionState === 'closed' ||
        pc.connectionState === 'failed' ||
        pc.connectionState === 'closed'
      ) {
        cleanup()
        reject(new Error('ICE failed'))
      }
    }
    pc.addEventListener('iceconnectionstatechange', onChange)
    pc.addEventListener('connectionstatechange', onChange)
  })
}

export function setLocalAudioEnabled(stream: MediaStream | null, enabled: boolean) {
  if (!stream) return
  for (const track of stream.getAudioTracks()) {
    track.enabled = enabled
  }
}

export async function replaceSenderAudio(
  pc: RTCPeerConnection | null,
  nextStream: MediaStream,
): Promise<void> {
  if (!pc) return
  const track = nextStream.getAudioTracks()[0]
  if (!track) return
  const sender = pc.getSenders().find((s) => s.track?.kind === 'audio')
  if (sender) {
    await sender.replaceTrack(track)
    return
  }
  pc.addTrack(track, nextStream)
}

export function closePeer(
  pc: RTCPeerConnection | null,
  localStream: MediaStream | null,
): void {
  try {
    localStream?.getTracks().forEach((t) => t.stop())
  } catch {
    // already stopped
  }
  try {
    pc?.close()
  } catch {
    // already closed
  }
}
