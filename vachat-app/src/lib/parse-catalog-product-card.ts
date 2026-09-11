export type CatalogProductCardData = {
  title: string;
  priceLine?: string;
  stockLine?: string;
  variantsLine?: string;
  colorLine?: string;
  viewUrl: string;
  handle: string;
};

const PRODUCT_CARD_HINT =
  /(?:^|\n)\s*View:\s*\S+|https?:\/\/[^\s]+\/products\/|(?:^|\n)\s*Stock\s+(?:in|out)\b/i;
const VIEW_URL = /(?:^|\n)\s*View:\s*(https?:\/\/\S+)/i;
const PRODUCT_URL = /https?:\/\/[^\s]+\/products\/\S+/i;
const PRICE_LINE =
  /^~?\d[\d.,]*~?(?:\s+\d[\d.,]*)?(?:\s*[–-]\s*\d[\d.,]*)?\s+[A-Z]{3}$/i;

function trimDecorations(value: string): string {
  return value.replace(/[)\],.!?]+$/, '').replace(/[^\p{L}\p{N}/?&=._:#%-]+$/gu, '');
}

export function normalizeCatalogHandle(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

export function catalogHandleCandidates(viewUrl: string): string[] {
  const match = viewUrl.match(/\/products\/([^/?#\s]+)/i);
  if (!match?.[1]) return [];

  let decoded = match[1];
  try {
    decoded = decodeURIComponent(decoded);
  } catch {
    // Keep the original path segment when it is not valid URI encoding.
  }

  const beforeDecoration = (decoded.split(/[^\p{L}\p{N}_-]/u)[0] ?? '').replace(/-+$/, '');
  return [
    ...new Set(
      [decoded, beforeDecoration, normalizeCatalogHandle(decoded)].filter(Boolean),
    ),
  ];
}

export function catalogSkuCandidates(...sources: string[]): string[] {
  const skus = new Set<string>();
  for (const source of sources) {
    for (const match of source.matchAll(/\b([A-Za-z]{1,4}\d{3,6})\b/g)) {
      skus.add(match[1].toLowerCase());
    }
  }
  return [...skus];
}

export function isCatalogProductCardText(text: string | null | undefined): boolean {
  return PRODUCT_CARD_HINT.test(text ?? '');
}

export function parseCatalogProductCard(
  text: string | null | undefined,
): CatalogProductCardData | null {
  const raw = text?.trim() ?? '';
  if (!raw || !isCatalogProductCardText(raw)) return null;

  const rawUrl = raw.match(VIEW_URL)?.[1] ?? raw.match(PRODUCT_URL)?.[0];
  if (!rawUrl) return null;
  const viewUrl = trimDecorations(rawUrl);
  const handles = catalogHandleCandidates(viewUrl);
  if (handles.length === 0) return null;

  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const priceLine = lines.find((line) => PRICE_LINE.test(line));
  const title = lines.find(
    (line) =>
      !/^view:/i.test(line) &&
      !/^stock\s+(?:in|out)\b/i.test(line) &&
      !/^variants?:/i.test(line) &&
      !/^colou?r:/i.test(line) &&
      !PRICE_LINE.test(line) &&
      !/^https?:\/\//i.test(line),
  );
  if (!title) return null;

  const stockIndex = lines.findIndex((line) => /^stock\s+(?:in|out)\b/i.test(line));
  const stockRaw = stockIndex >= 0 ? lines[stockIndex] : undefined;
  const inlineVariants = stockRaw?.match(/^(stock\s+(?:in|out))\s+(variants?:\s*.+)$/i);

  return {
    title,
    priceLine,
    stockLine: inlineVariants?.[1] ?? stockRaw,
    variantsLine:
      inlineVariants?.[2] ?? lines.find((line) => /^variants?:/i.test(line)),
    colorLine: lines.find((line) => /^colou?r:/i.test(line)),
    viewUrl,
    handle: handles[0],
  };
}
