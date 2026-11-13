import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'

import { decryptImage, encryptImage, isValidPin, KDF_ITERATIONS, WrongPinError } from '../signature-crypto'

const png = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 1, 2, 3, 4, 5, 6, 7, 8])
/** Fewer rounds keep the tests quick; the default is checked separately */
const FAST = 1000

describe('isValidPin', () => {
  it('accepts 6 or more digits and letters only (PRD FR-08)', () => {
    expect(isValidPin('123456')).toBe(true)
    expect(isValidPin('abc123XYZ')).toBe(true)
    expect(isValidPin('12345')).toBe(false)
    expect(isValidPin('123 456')).toBe(false)
    expect(isValidPin('密码123456')).toBe(false)
    expect(isValidPin('1'.repeat(33))).toBe(false)
  })
})

describe('encryptImage / decryptImage', () => {
  it('round-trips with the default 600,000 PBKDF2 iterations', async () => {
    const encrypted = await encryptImage(png, '246810')

    expect(encrypted.kdfIterations).toBe(KDF_ITERATIONS)
    expect(KDF_ITERATIONS).toBeGreaterThanOrEqual(600_000)
    expect(encrypted.salt).toHaveLength(16)
    expect(encrypted.iv).toHaveLength(12)
    expect(await decryptImage(encrypted, '246810')).toEqual(png)
  })

  it('stores only ciphertext', async () => {
    const encrypted = await encryptImage(png, 'abc123', FAST)
    const cipher = new Uint8Array(encrypted.cipher)

    // AES-GCM appends a 16-byte tag
    expect(cipher).toHaveLength(png.length + 16)
    expect(Buffer.from(cipher).includes(Buffer.from(png.subarray(0, 8)))).toBe(false)
  })

  it('uses a fresh salt and IV every time', async () => {
    const a = await encryptImage(png, 'abc123', FAST)
    const b = await encryptImage(png, 'abc123', FAST)

    expect(a.salt).not.toEqual(b.salt)
    expect(a.iv).not.toEqual(b.iv)
    expect(new Uint8Array(a.cipher)).not.toEqual(new Uint8Array(b.cipher))
  })

  it('rejects a wrong PIN', async () => {
    const encrypted = await encryptImage(png, 'abc123', FAST)

    await expect(decryptImage(encrypted, 'abc124')).rejects.toBeInstanceOf(WrongPinError)
    await expect(decryptImage(encrypted, '')).rejects.toBeInstanceOf(WrongPinError)
  })

  it('rejects altered ciphertext, IV, salt and iteration count', async () => {
    const encrypted = await encryptImage(png, 'abc123', FAST)
    const flipped = (bytes: Uint8Array, index = 0) => {
      const copy = bytes.slice()
      copy[index]! ^= 1
      return copy
    }

    await expect(decryptImage({ ...encrypted, cipher: flipped(new Uint8Array(encrypted.cipher), 3).buffer }, 'abc123')).rejects.toBeInstanceOf(WrongPinError)
    await expect(decryptImage({ ...encrypted, iv: flipped(encrypted.iv) }, 'abc123')).rejects.toBeInstanceOf(WrongPinError)
    await expect(decryptImage({ ...encrypted, salt: flipped(encrypted.salt) }, 'abc123')).rejects.toBeInstanceOf(WrongPinError)
    await expect(decryptImage({ ...encrypted, kdfIterations: FAST + 1 }, 'abc123')).rejects.toBeInstanceOf(WrongPinError)
    await expect(decryptImage({ ...encrypted, kdfIterations: 0 }, 'abc123')).rejects.toBeInstanceOf(WrongPinError)
    await expect(decryptImage({ ...encrypted, iv: encrypted.iv.subarray(1) }, 'abc123')).rejects.toBeInstanceOf(WrongPinError)
  })

  it('refuses to encrypt with an invalid PIN', async () => {
    await expect(encryptImage(png, '123')).rejects.toBeInstanceOf(RangeError)
  })
})
