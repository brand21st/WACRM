type LogMeta = {
  path?: string;
  status?: number;
  duration?: number;
  message?: string;
};

function formatMeta(meta?: LogMeta): string {
  if (!meta) return '';
  const parts: string[] = [];
  if (meta.path) parts.push(meta.path);
  if (typeof meta.status === 'number') parts.push(`status=${meta.status}`);
  if (typeof meta.duration === 'number') parts.push(`${meta.duration}ms`);
  if (meta.message) parts.push(meta.message);
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

export const logger = {
  info(message: string, meta?: LogMeta) {
    if (!__DEV__) return;
    console.log(`${message}${formatMeta(meta)}`);
  },
  error(message: string, meta?: LogMeta) {
    if (!__DEV__) return;
    console.error(`${message}${formatMeta(meta)}`);
  },
};
