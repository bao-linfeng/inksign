/** `合同.pdf` → `合同_signed.pdf` (PRD FR-06) */
export function signedFileName(fileName: string) {
  const base = fileName.replace(/\.pdf$/i, '') || 'document'
  return `${base}_signed.pdf`
}

/** `全名` → `签名_全名.png` (PRD FR-08), without characters file systems refuse */
export function signaturePngName(name: string) {
  const safe = [...name].map(char => (char < ' ' || '\\/:*?"<>|'.includes(char) ? '_' : char)).join('').trim()
  return `签名_${safe || '签名'}.png`
}

/** Saves bytes through the browser's download; nothing leaves the device. */
export function downloadBytes(bytes: Uint8Array, fileName: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  // Revoke later: some browsers start reading the blob only after click() returns
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
