class CatalogProduct {
  const CatalogProduct({
    required this.id,
    required this.title,
    required this.handle,
    required this.status,
    this.origin,
    this.currency,
    this.priceMin,
    this.priceMax,
    this.variantCount,
    this.imageUrl,
  });

  final String id;
  final String title;
  final String handle;
  final String status;
  final String? origin;
  final String? currency;
  final num? priceMin;
  final num? priceMax;
  final int? variantCount;
  final String? imageUrl;

  String get priceLabel {
    if (priceMin == null && priceMax == null) return handle;
    final prefix = currency == null ? '' : '$currency ';
    if (priceMin != null && priceMax != null && priceMin != priceMax) {
      return '$prefix$priceMin – $priceMax';
    }
    return '$prefix${priceMin ?? priceMax}';
  }

  factory CatalogProduct.fromJson(Map<String, dynamic> json) {
    return CatalogProduct(
      id: json['id'] as String,
      title: json['title'] as String? ?? '',
      handle: json['handle'] as String? ?? '',
      status: json['status'] as String? ?? '',
      origin: json['origin'] as String?,
      currency: json['currency'] as String?,
      priceMin: json['priceMin'] as num?,
      priceMax: json['priceMax'] as num?,
      variantCount: (json['variantCount'] as num?)?.toInt(),
      imageUrl: json['imageUrl'] as String?,
    );
  }
}
