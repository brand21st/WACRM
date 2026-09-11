export function productCardImageUrl(message: {
  content_type?: string;
  media_url?: string | null;
  interactive_payload?: unknown;
}): string | undefined {
  if (message.content_type === 'image' && message.media_url?.trim()) {
    return message.media_url.trim();
  }

  const payload = message.interactive_payload;
  if (payload && typeof payload === 'object' && 'header_image' in payload) {
    const headerImage = (payload as { header_image?: unknown }).header_image;
    if (typeof headerImage === 'string' && headerImage.trim()) {
      return headerImage.trim();
    }
  }

  return undefined;
}
