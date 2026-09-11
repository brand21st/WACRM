export type IncomingPreviewKind =
  | 'text'
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'location'
  | 'interactive'
  | 'default';

export function incomingPreviewKind(
  contentType: string | undefined,
  contentText: string | undefined | null,
): IncomingPreviewKind {
  const text = contentText?.trim() ?? '';
  if (text) return 'text';
  switch (contentType) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
    case 'document':
      return 'document';
    case 'location':
      return 'location';
    case 'interactive':
      return 'interactive';
    default:
      return 'default';
  }
}

export function incomingPreviewText(
  kind: IncomingPreviewKind,
  contentText: string | undefined | null,
  labels: Record<Exclude<IncomingPreviewKind, 'text'>, string>,
): string {
  if (kind === 'text') {
    const text = contentText?.trim() ?? '';
    return text.length > 140 ? `${text.slice(0, 137)}…` : text;
  }
  return labels[kind];
}

export function contactDisplayName(
  name: string | null | undefined,
  phone: string | null | undefined,
): string | null {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  const phoneTrimmed = phone?.trim();
  if (phoneTrimmed) return phoneTrimmed;
  return null;
}

export const INCOMING_PREVIEW_LABELS = {
  image: 'Photo',
  video: 'Video',
  audio: 'Voice message',
  document: 'Document',
  location: 'Location',
  interactive: 'Reply',
  default: 'New message',
} as const;
