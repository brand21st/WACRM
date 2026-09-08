import { redirect } from 'next/navigation';

export default function LegacyNewCatalogSetPage() {
  redirect('/catalog/collections/new');
}
