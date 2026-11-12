/**
 * Why a PDF could not be opened (PRD FR-01, §9). Kept free of PDF libraries so the home view can
 * show these messages without loading them.
 */
export type ImportErrorCode
  = | 'empty'
    | 'not-pdf'
    | 'too-large'
    | 'too-many-pages'
    | 'password'
    | 'restricted'
    | 'broken'
    /** The lazily loaded PDF code itself failed to download */
    | 'app-load'

export const importErrorMessages: Record<ImportErrorCode, string> = {
  'empty': '文件是空的，请重新选择。',
  'not-pdf': '请选择 PDF 格式文件。',
  'too-large': '文件较大，当前版本建议使用 50 MB 以内的 PDF。',
  'too-many-pages': '页数较多，当前版本建议使用 200 页以内的 PDF。',
  'password': '暂不支持受密码保护的 PDF。',
  'restricted': '该 PDF 设置了编辑限制，暂不支持签名。',
  'broken': '文件无法解析，请确认 PDF 是否完整。',
  'app-load': '页面资源加载失败，请检查网络后刷新重试。',
}

export class PdfImportError extends Error {
  constructor(readonly code: ImportErrorCode, options?: ErrorOptions) {
    // The message never contains the file name or content (PRD §8)
    super(`PDF import failed: ${code}`, options)
    this.name = 'PdfImportError'
  }
}
