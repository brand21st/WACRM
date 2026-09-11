import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio';

const incomingSound = require('../../../assets/sounds/incoming.wav') as number;

let player: AudioPlayer | null = null;
let modeReady = false;

async function ensureMode(): Promise<void> {
  if (modeReady) return;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
    });
    modeReady = true;
  } catch {
    // Keep going — the chime may still play with the default session.
  }
}

function getPlayer(): AudioPlayer | null {
  if (player) return player;
  try {
    player = createAudioPlayer(incomingSound);
    return player;
  } catch {
    return null;
  }
}

/** Same two-tone chime as the web inbox (`incoming-sound.ts`). */
export async function playIncomingMessageSound(): Promise<void> {
  try {
    await ensureMode();
    const next = getPlayer();
    if (!next) return;
    await next.seekTo(0);
    next.play();
  } catch {
    // Never break the inbox for a missing audio session.
  }
}
