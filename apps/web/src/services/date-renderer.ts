import type { SignatureImage } from './signature-image'

import { canvasToPng } from './signature-image'

/** `2026年11月12日`, `2026-11-12`, `2026/11/12` (PRD FR-09) */
export type DateFormat = 'zh' | 'dash' | 'slash'

export const DATE_FORMATS: readonly DateFormat[] = ['zh', 'dash', 'slash']

/** What a placed date shows; the image of its `SignatureSource` is rendered from it */
export interface DateField {
  /** ISO calendar date, e.g. `2026-11-12` */
  value: string
  format: DateFormat
  color: string
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

/** Parses `YYYY-MM-DD` into its numbers, or `null` when it is not a real calendar date. */
function parseIsoDate(value: string) {
  const match = ISO_DATE.exec(value)
  if (!match)
    return null
  const [year, month, day] = match.slice(1).map(Number) as [number, number, number]
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day)
    return null
  return { year, month, day }
}

export function isValidIsoDate(value: string) {
  return parseIsoDate(value) !== null
}

/** Today in the local time zone, as `YYYY-MM-DD`. */
export function todayIso(now = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

/** The text drawn for `value`; Chinese dates are written without leading zeros. */
export function formatDate(value: string, format: DateFormat) {
  const date = parseIsoDate(value)
  if (!date)
    throw new RangeError(`Not a calendar date: ${value}`)
  const { year, month, day } = date
  const pad = (n: number) => String(n).padStart(2, '0')
  switch (format) {
    case 'zh':
      return `${year}年${month}月${day}日`
    case 'dash':
      return `${year}-${pad(month)}-${pad(day)}`
    case 'slash':
      return `${year}/${pad(month)}/${pad(day)}`
  }
}

/** The last chosen format is a preference kept in localStorage (PRD FR-09); nothing else is stored. */
const FORMAT_KEY = 'inksign.dateFormat'

export function loadDateFormat(): DateFormat {
  try {
    const stored = localStorage.getItem(FORMAT_KEY)
    return DATE_FORMATS.includes(stored as DateFormat) ? stored as DateFormat : 'zh'
  }
  catch {
    // Storage disabled (e.g. some private modes): fall back to the default
    return 'zh'
  }
}

export function saveDateFormat(format: DateFormat) {
  try {
    localStorage.setItem(FORMAT_KEY, format)
  }
  catch {}
}

/**
 * Self-hosted fonts are not bundled yet, so the date uses the system CJK fonts. Preview and export
 * show the same PNG, so they always match on one device (PRD FR-09).
 */
export const DATE_FONT_FAMILY = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif'

/** Canvas pixels per em: a date placed 18 points high is still rendered at more than 4× */
const FONT_SIZE = 96
/** Line box and side padding, in ems; fixed so every format and digit gets the same height */
const LINE_HEIGHT = 1.3
const SIDE_PADDING = 0.15

/** Height a date gets when placed (points of the visible page), about a 14-point font */
export const DATE_PLACED_HEIGHT = 18

/** Canvas size for a text `textWidth` pixels wide at `fontSize`. */
export function dateCanvasSize(textWidth: number, fontSize = FONT_SIZE) {
  return {
    width: Math.ceil(textWidth + 2 * SIDE_PADDING * fontSize),
    height: Math.ceil(LINE_HEIGHT * fontSize),
  }
}

/** Renders the date as a transparent PNG that goes through the same pipeline as signatures. */
export async function renderDateImage(field: DateField): Promise<SignatureImage> {
  const text = formatDate(field.value, field.format)
  const font = `500 ${FONT_SIZE}px ${DATE_FONT_FAMILY}`
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')
  if (!context)
    throw new Error('Canvas 2D is not available')
  context.font = font
  const { width, height } = dateCanvasSize(context.measureText(text).width)
  canvas.width = width
  canvas.height = height
  // Resizing the canvas resets its state
  context.font = font
  context.fillStyle = field.color
  context.textBaseline = 'middle'
  context.fillText(text, SIDE_PADDING * FONT_SIZE, height / 2)
  return { pngBytes: await canvasToPng(canvas), width, height }
}
