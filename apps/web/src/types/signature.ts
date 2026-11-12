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
