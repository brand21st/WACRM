enum WindowBand { normal, warning, critical, expired }

WindowBand windowBand(String? expiresAt, [DateTime? now]) {
  if (expiresAt == null) return WindowBand.expired;
  final end = DateTime.tryParse(expiresAt);
  if (end == null) return WindowBand.expired;
  final remaining = end.difference(now ?? DateTime.now());
  if (remaining.isNegative || remaining == Duration.zero) return WindowBand.expired;
  if (remaining < const Duration(hours: 1)) return WindowBand.critical;
  if (remaining < const Duration(hours: 6)) return WindowBand.warning;
  return WindowBand.normal;
}

bool isWindowExpired(String? expiresAt, [DateTime? now]) =>
    windowBand(expiresAt, now) == WindowBand.expired;

String formatWindowRemaining(String? expiresAt, [DateTime? now]) {
  if (isWindowExpired(expiresAt, now)) return '24h window expired';
  final end = DateTime.parse(expiresAt!);
  final remaining = end.difference(now ?? DateTime.now());
  final hours = remaining.inHours;
  final minutes = remaining.inMinutes.remainder(60);
  if (hours <= 0) return '${minutes}m left';
  return '${hours}h ${minutes}m left';
}
