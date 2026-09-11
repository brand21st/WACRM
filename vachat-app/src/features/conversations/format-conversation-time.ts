/** Present a backend ISO timestamp in the device timezone. Does not mutate the source. */
export function formatConversationTime(iso: string | null, now = new Date()): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday';
  }

  const weekAgo = new Date(now);
  weekAgo.setHours(0, 0, 0, 0);
  weekAgo.setDate(now.getDate() - 6);
  if (date >= weekAgo) {
    return date.toLocaleDateString(undefined, { weekday: 'long' });
  }

  return date.toLocaleDateString(undefined, {
    month: 'numeric',
    day: 'numeric',
    year: '2-digit',
  });
}
