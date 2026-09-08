import type { CatalogMedia, CatalogProduct, CatalogVariant } from '@/lib/catalog/core/types'
import type { MetaCatalogItem } from '@/lib/shopify/meta-catalog-sync'

/**
 * Map a WACRM catalog product to Meta Commerce items.
 *
 * retailer_id is ALWAYS the persisted catalog_variants.retailer_id.
 * Never recompute from SKU, variant id, or retailer_id_source.
 */
export function catalogItemsFromCatalogProduct(
  product: CatalogProduct,
): MetaCatalogItem[] {
  const currency = (
    product.currency ||
    product.variants.find((variant) => variant.currency)?.currency ||
    'INR'
  ).toUpperCase()
  const imageUrl = heroMediaUrl(product.media)
  const items: MetaCatalogItem[] = []
  const seen = new Set<string>()

  for (const variant of product.variants) {
    const retailerId = variant.retailerId.trim()
    if (!retailerId || seen.has(retailerId)) continue
    seen.add(retailerId)
    const price = Number(variant.price)
    items.push({
      retailer_id: retailerId,
      name: itemName(product.title, variant),
      description: (product.description || product.title).slice(0, 9999),
      availability: variant.available ? 'in stock' : 'out of stock',
      condition: 'new',
      price: Number.isFinite(price) ? price : 0,
      currency: (variant.currency || currency).toUpperCase(),
      url: product.productUrl || '',
      image_url: imageUrl,
      brand: product.brand?.trim() || undefined,
    })
  }

  return items
}

function itemName(productTitle: string, variant: CatalogVariant): string {
  const title = productTitle.slice(0, 200)
  if (variant.title && variant.title !== 'Default') {
    return `${productTitle} — ${variant.title}`.slice(0, 200)
  }
  return title
}

function heroMediaUrl(media: CatalogMedia[]): string | undefined {
  const hero = media.find((item) => item.role === 'hero') ?? media[0]
  const url = hero?.url.trim()
  return url || undefined
}
