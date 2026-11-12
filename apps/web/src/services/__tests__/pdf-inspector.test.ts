import { describe, expect, it } from 'vitest'

import { hasPdfHeader } from '../pdf-inspector'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('hasPdfHeader', () => {
  it('accepts %PDF- at the start or anywhere in the first 1024 bytes', () => {
    expect(hasPdfHeader(bytes('%PDF-1.7\n'))).toBe(true)
    expect(hasPdfHeader(bytes(`${' '.repeat(1000)}%PDF-2.0`))).toBe(true)
    expect(hasPdfHeader(bytes(`${' '.repeat(1023)}%PDF-`))).toBe(true)
  })

  it('rejects other files whatever their name or type claims', () => {
    expect(hasPdfHeader(bytes(''))).toBe(false)
    expect(hasPdfHeader(bytes('%PDF'))).toBe(false)
    expect(hasPdfHeader(bytes('PK\u0003\u0004 not a pdf'))).toBe(false)
    expect(hasPdfHeader(bytes(`${' '.repeat(1024)}%PDF-1.7`))).toBe(false)
  })
})
