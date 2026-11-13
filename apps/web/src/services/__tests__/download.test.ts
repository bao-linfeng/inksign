import { describe, expect, it } from 'vitest'

import { signaturePngName } from '../download'

describe('signature PNG backup filename', () => {
  it('keeps the signature name and replaces characters disallowed by file systems', () => {
    expect(signaturePngName('全名')).toBe('签名_全名.png')
    expect(signaturePngName('全名/备份:*?"<>|\\')).toBe('签名_全名_备份________.png')
    expect(signaturePngName('   ')).toBe('签名_签名.png')
    expect(signaturePngName('a\nb')).toBe('签名_a_b.png')
  })
})
