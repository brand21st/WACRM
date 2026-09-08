import { decrypt, encrypt } from '@/lib/whatsapp/encryption'

export function encryptGoogleToken(plaintext: string): string {
  return encrypt(plaintext)
}

export function decryptGoogleToken(ciphertext: string): string {
  return decrypt(ciphertext)
}
