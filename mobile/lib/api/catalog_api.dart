import '../models/catalog.dart';
import 'crm_client.dart';

Future<List<CatalogProduct>> fetchActiveCatalog(CrmClient client) async {
  final data = await client.get<Map<String, dynamic>>(
    '/api/catalog?status=active&limit=50',
  );
  final rows = data['products'] as List? ?? const [];
  return rows.whereType<Map<String, dynamic>>().map(CatalogProduct.fromJson).toList();
}
