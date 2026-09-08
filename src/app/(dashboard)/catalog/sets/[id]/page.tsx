import { redirect } from 'next/navigation';

export default async function LegacyCatalogSetPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/catalog/collections/${id}`);
}
