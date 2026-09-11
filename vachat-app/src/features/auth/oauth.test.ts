import { describe, expect, it } from 'vitest';

import {
  authCodeFromCallbackUrl,
  crmPageUrl,
  loginErrorFromCallback,
  oauthRedirectTo,
  passwordResetRedirectTo,
} from './oauth';

describe('oauthRedirectTo', () => {
  it('uses the Expo web origin plus /auth/callback', () => {
    expect(
      oauthRedirectTo({
        os: 'web',
        webOrigin: 'http://localhost:8082',
        nativeRedirectUrl: 'vachatapp://auth/callback',
      }),
    ).toBe('http://localhost:8082/auth/callback');
  });

  it('uses the native deep link off web', () => {
    expect(
      oauthRedirectTo({
        os: 'ios',
        webOrigin: 'http://localhost:8082',
        nativeRedirectUrl: 'vachatapp://auth/callback',
      }),
    ).toBe('vachatapp://auth/callback');
  });
});

describe('authCodeFromCallbackUrl', () => {
  it('reads code from query strings and custom schemes', () => {
    expect(authCodeFromCallbackUrl('https://app.example/auth/callback?code=abc')).toBe('abc');
    expect(authCodeFromCallbackUrl('vachatapp://auth/callback?code=xyz')).toBe('xyz');
    expect(authCodeFromCallbackUrl('exp://192.168.1.5:8081/--/auth/callback?code=pkce')).toBe('pkce');
  });
});

describe('crm helpers', () => {
  it('builds signup and password-reset URLs on the web CRM origin', () => {
    expect(crmPageUrl('http://127.0.0.1:3000/', '/signup')).toBe('http://127.0.0.1:3000/signup');
    expect(passwordResetRedirectTo('http://127.0.0.1:3000')).toBe(
      'http://127.0.0.1:3000/auth/callback?next=%2Freset-password',
    );
  });
});

describe('loginErrorFromCallback', () => {
  it('maps known callback codes', () => {
    expect(loginErrorFromCallback('missing_code')).toMatch(/missing a code/);
    expect(loginErrorFromCallback(undefined)).toBeNull();
  });
});
