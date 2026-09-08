'use client';

import { use } from 'react';
import { CollectionEditor } from '@/components/catalog/collection-editor';

export default function CatalogCollectionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return <CollectionEditor collectionId={id} />;
}
