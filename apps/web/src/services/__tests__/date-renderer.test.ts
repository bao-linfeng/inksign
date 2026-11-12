// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { dateCanvasSize, formatDate, isValidIsoDate, loadDateFormat, saveDateFormat, todayIso } from '../date-renderer'

describe('formatDate', () => {
  it('writes the three formats of FR-09', () => {
    expect(formatDate('2026-11-12', 'zh')).toBe('2026年11月12日')
    expect(formatDate('2026-11-12', 'dash')).toBe('2026-11-12')
    expect(formatDate('2026-11-12', 'slash')).toBe('2026/11/12')
  })

  it('drops leading zeros in Chinese only', () => {
    expect(formatDate('2027-01-05', 'zh')).toBe('2027年1月5日')
    expect(formatDate('2027-01-05', 'slash')).toBe('2027/01/05')
  })

  it('refuses dates that do not exist', () => {
    expect(() => formatDate('2026-02-30', 'zh')).toThrow(RangeError)
    expect(isValidIsoDate('2028-02-29')).toBe(true)
    expect(isValidIsoDate('2026-02-29')).toBe(false)
    expect(isValidIsoDate('2026-1-5')).toBe(false)
    expect(isValidIsoDate('')).toBe(false)
  })
})

describe('todayIso', () => {
  it('uses the local calendar day', () => {
    expect(todayIso(new Date(2026, 0, 3, 23, 59))).toBe('2026-01-03')
  })
})

describe('date format preference', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  it('remembers the last format and defaults to Chinese', () => {
    expect(loadDateFormat()).toBe('zh')
    saveDateFormat('slash')
    expect(loadDateFormat()).toBe('slash')
    localStorage.setItem('inksign.dateFormat', 'nonsense')
    expect(loadDateFormat()).toBe('zh')
  })

  it('works without storage', () => {
    const blocked = () => {
      throw new Error('SecurityError')
    }
    vi.stubGlobal('localStorage', { getItem: blocked, setItem: blocked })
    expect(() => saveDateFormat('dash')).not.toThrow()
    expect(loadDateFormat()).toBe('zh')
  })
})

describe('dateCanvasSize', () => {
  it('gives every text the same line height so formats can be swapped in place', () => {
    expect(dateCanvasSize(500, 100)).toEqual({ width: 530, height: 130 })
    expect(dateCanvasSize(300, 100).height).toBe(130)
  })
})
