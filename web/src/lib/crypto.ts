// AES-256-GCM encryption for user-supplied API keys at rest.
// Key material: APP_ENCRYPTION_KEY env var, 64 hex chars (32 bytes).
// Output format: base64(iv || authTag || ciphertext)
//   iv      = 12 bytes (GCM standard)
//   authTag = 16 bytes
//   rest    = ciphertext

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

function getKey(): Buffer {
  const hex = process.env.APP_ENCRYPTION_KEY
  if (!hex) throw new Error('APP_ENCRYPTION_KEY is not set')
  if (hex.length !== 64) throw new Error('APP_ENCRYPTION_KEY must be 64 hex chars (32 bytes)')
  return Buffer.from(hex, 'hex')
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, getKey(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, 'base64')
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN)
  const ct = buf.subarray(IV_LEN + TAG_LEN)
  const decipher = createDecipheriv(ALGO, getKey(), iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString('utf8')
}

// Helper for UI: show a key as "sk-...xxxx" without ever leaking the full value.
export function maskKey(key: string | null | undefined): string {
  if (!key) return ''
  if (key.length <= 8) return '••••'
  return `${key.slice(0, 4)}…${key.slice(-4)}`
}
