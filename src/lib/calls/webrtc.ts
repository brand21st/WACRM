import { normalizeOfferSdp } from './sdp'

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
]

export async function createInboundPeerConnection(offerSdp: string): Promise<{
  pc: RTCPeerConnection
  localStream: MediaStream
}> {
  const localStream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: false,
  })
  // Keep muted until Meta's accept returns 200 — sending RTP early
  // makes WhatsApp treat the call as already answered.
  for (const track of localStream.getAudioTracks()) {
    track.enabled = false
  }

  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
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

export function attachRemoteAudio(
  pc: RTCPeerConnection,
  audioEl: HTMLAudioElement,
): void {
  pc.ontrack = (event) => {
    const [stream] = event.streams
    if (stream) audioEl.srcObject = stream
    void audioEl.play().catch(() => {
      // Autoplay may still block; the Answer click usually unlocks it.
    })
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
  const ok = (s: RTCIceConnectionState) => s === 'connected' || s === 'completed'
  if (ok(pc.iceConnectionState)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer)
      pc.removeEventListener('iceconnectionstatechange', onChange)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('ICE timeout'))
    }, timeoutMs)
    const onChange = () => {
      if (ok(pc.iceConnectionState)) {
        cleanup()
        resolve()
      } else if (
        pc.iceConnectionState === 'failed' ||
        pc.iceConnectionState === 'closed'
      ) {
        cleanup()
        reject(new Error('ICE failed'))
      }
    }
    pc.addEventListener('iceconnectionstatechange', onChange)
  })
}

export function setLocalAudioEnabled(stream: MediaStream | null, enabled: boolean) {
  if (!stream) return
  for (const track of stream.getAudioTracks()) {
    track.enabled = enabled
  }
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
