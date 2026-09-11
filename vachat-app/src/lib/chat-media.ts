import { getSupabase } from '@/lib/supabase';

export const CHAT_MEDIA_BUCKET = 'chat-media';
export const MEDIA_CAPTION_MAX = 1024;
export const MEDIA_MAX_BYTES_BY_KIND = {
  image: 5 * 1024 * 1024,
  video: 16 * 1024 * 1024,
  audio: 16 * 1024 * 1024,
  document: 16 * 1024 * 1024,
} as const;

export type MediaKind = keyof typeof MEDIA_MAX_BYTES_BY_KIND;

const ALLOWED_AUDIO_MIME = new Set([
  'audio/ogg',
  'audio/mpeg',
  'audio/aac',
  'audio/mp4',
  'audio/amr',
]);

function normalizeAudioMimeType(mimeType: string): string {
  const base = mimeType.split(';')[0]?.trim().toLowerCase() || '';
  if (ALLOWED_AUDIO_MIME.has(base)) return base;
  throw new Error('Voice notes must be OGG, MP4, AAC, MP3, or AMR. Try again on a supported browser.');
}

export function buildMediaPath(accountId: string, fileName: string, now = Date.now()): string {
  const hasExt = /\.[^.]+$/.test(fileName);
  const ext = hasExt ? fileName.split('.').pop()!.toLowerCase() : 'bin';
  const safeBase =
    fileName
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-zA-Z0-9_-]+/g, '_')
      .slice(0, 40) || 'file';
  return `account-${accountId}/${now}-${safeBase}.${ext}`;
}

async function resolveAccountId(): Promise<string> {
  const supabase = getSupabase();
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (sessionError || !userId) throw new Error('Not signed in.');

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('account_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error || !profile?.account_id) throw new Error('Could not resolve your account.');
  return profile.account_id as string;
}

export async function uploadChatMedia(params: {
  uri: string;
  fileName: string;
  mimeType: string;
  kind: MediaKind;
  sizeBytes?: number;
}): Promise<{ publicUrl: string; path: string }> {
  const max = MEDIA_MAX_BYTES_BY_KIND[params.kind];
  if (typeof params.sizeBytes === 'number' && params.sizeBytes > max) {
    throw new Error(`File is too large (max ${Math.round(max / (1024 * 1024))} MB).`);
  }

  const response = await fetch(params.uri);
  if (!response.ok) throw new Error('Could not read the selected file.');
  const blob = await response.blob();
  if (blob.size > max) {
    throw new Error(`File is too large (max ${Math.round(max / (1024 * 1024))} MB).`);
  }

  const contentType =
    params.kind === 'audio'
      ? normalizeAudioMimeType(params.mimeType || blob.type)
      : params.mimeType || blob.type;

  const accountId = await resolveAccountId();
  const path = buildMediaPath(accountId, params.fileName);
  const supabase = getSupabase();
  const { error } = await supabase.storage.from(CHAT_MEDIA_BUCKET).upload(path, blob, {
    cacheControl: '3600',
    upsert: false,
    contentType,
  });
  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(CHAT_MEDIA_BUCKET).getPublicUrl(path);
  return { publicUrl: data.publicUrl, path };
}
