export type CatalogListItem = {
  id: string;
  title: string;
  handle: string;
  status: string;
  origin?: string;
  currency?: string;
  priceMin?: number | null;
  priceMax?: number | null;
  variantCount?: number;
  imageUrl?: string | null;
};

export type CatalogListResponse = {
  products: CatalogListItem[];
  total: number;
};
