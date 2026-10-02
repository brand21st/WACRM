import 'package:flutter_test/flutter_test.dart';
import 'package:vachat_mobile/config/env.dart';

void main() {
  test('production defaults are configured', () {
    final env = Env.read();
    expect(Env.isConfigured(env), isTrue);
    expect(env.apiUrl, 'https://cloud.vachat.in');
    expect(env.oauthRedirectTo, 'vachatapp://auth/callback');
  });
}
