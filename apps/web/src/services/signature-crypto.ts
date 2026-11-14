/**
 * Optional PIN protection of saved signatures (PRD FR-08): PBKDF2-SHA256 derives an AES-GCM-256 key
 * from the PIN and a random salt. It wraps the shared library key; legacy signatures use their own
 * salt. The PIN is never stored. Remembered keys require explicit consent. This protection does
 * not withstand an offline brute force on the stored data, and the UI must not claim otherwise.
 */

/** PRD FR-08: at least 600,000 iterations */
export const KDF_ITERATIONS = 600_000
export const PIN_MIN_LENGTH = 6
export const PIN_MAX_LENGTH = 32
const SALT_BYTES = 16
const IV_BYTES = 12

/** Digits and letters, 6–32 of them (PRD FR-08) */
const PIN_PATTERN = new RegExp(`^[0-9a-z]{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`, 'i')

export function isValidPin(pin: string) {
  return PIN_PATTERN.test(pin)
}

/** What is stored instead of the PNG bytes of a protected signature */
export interface EncryptedImage {
  /** AES-GCM ciphertext followed by its tag */
  cipher: ArrayBuffer
  iv: Uint8Array
  salt: Uint8Array
  kdfIterations: number
}

/** The PIN does not match, or the stored data was altered: AES-GCM cannot tell the two apart. */
export class WrongPinError extends Error {
  constructor(options?: ErrorOptions) {
    super('Wrong PIN or damaged signature data', options)
    this.name = 'WrongPinError'
  }
}

async function deriveKey(pin: string, salt: Uint8Array, iterations: number, usage: KeyUsage) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    [usage],
  )
}

export async function deriveDecryptionKey(pin: string, salt: Uint8Array, iterations: number) {
  return deriveKey(pin, salt, iterations, 'decrypt')
}

export function decryptImageWithKey(encrypted: Pick<EncryptedImage, 'cipher' | 'iv'>, key: CryptoKey) {
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv: encrypted.iv as BufferSource }, key, encrypted.cipher)
    .then(bytes => new Uint8Array(bytes))
    .catch((error) => { throw new WrongPinError({ cause: error }) })
}

export async function encryptImageWithKey(bytes: Uint8Array, key: CryptoKey) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes as BufferSource)
  return { cipher, iv }
}

export function importLibraryKey(bytes: Uint8Array) {
  return crypto.subtle.importKey('raw', bytes as BufferSource, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptImage(pngBytes: Uint8Array, pin: string, iterations = KDF_ITERATIONS): Promise<EncryptedImage> {
  if (!isValidPin(pin))
    throw new RangeError('PIN must be 6–32 digits or letters')
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES))
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES))
  const key = await deriveKey(pin, salt, iterations, 'encrypt')
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pngBytes as BufferSource)
  return { cipher, iv, salt, kdfIterations: iterations }
}

/** The PNG bytes of a protected signature; throws `WrongPinError` for a wrong PIN or altered data. */
export async function decryptImage(encrypted: EncryptedImage, pin: string): Promise<Uint8Array> {
  const { cipher, iv, salt, kdfIterations } = encrypted
  if (!Number.isSafeInteger(kdfIterations) || kdfIterations < 1 || iv.length !== IV_BYTES || salt.length !== SALT_BYTES)
    throw new WrongPinError()
  try {
    const key = await deriveDecryptionKey(pin, salt, kdfIterations)
    return decryptImageWithKey({ cipher, iv }, key)
  }
  catch (error) {
    throw new WrongPinError({ cause: error })
  }
}
