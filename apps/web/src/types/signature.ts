import type { DateField } from '@/services/date-renderer'

/** Position and size of a placed item, as ratios of the visible page (top-left origin, PRD §6). */
export interface PlacementRect {
  xRatio: number
  yRatio: number
  widthRatio: number
  heightRatio: number
}

export interface Placement extends PlacementRect {
  id: string
  /** `SignatureSource.id` of the image drawn here */
  sourceId: string
  /** Zero-based */
  pageIndex: number
  /** Shared by the instances created together by batch signing (FR-10) */
  groupId?: string
}

/** A signature usable in this session: drawn, uploaded or taken from the library (PRD §6). */
export interface SignatureSource {
  id: string
  kind: 'draw' | 'image' | 'date'
  /** Kept in memory only and embedded as is on export */
  pngBytes: Uint8Array
  /** Object URL of `pngBytes`; revoked when the source is removed */
  previewUrl: string
  naturalWidth: number
  naturalHeight: number
  /** For `kind: 'date'`: what the image shows; editing it re-renders the image (FR-09) */
  date?: DateField
  /** `StoredSignature.id` when the signature comes from the library (FR-08) */
  libraryId?: string
}

/**
 * A signature the user saved to this device (PRD FR-08, §6), kept in IndexedDB. Plain entries hold
 * `pngBytes`; PIN-protected ones hold `cipher`, `iv`, `salt` and `kdfIterations` instead.
 */
export interface StoredSignature {
  id: string
  /** e.g. 全名 */
  name: string
  /** Milliseconds since the epoch */
  createdAt: number
  naturalWidth: number
  naturalHeight: number
  pngBytes?: Uint8Array
  encrypted: boolean
  /** AES-GCM ciphertext and tag */
  cipher?: ArrayBuffer
  /** 12 bytes */
  iv?: Uint8Array
  /** 16 bytes */
  salt?: Uint8Array
  kdfIterations?: number
}
