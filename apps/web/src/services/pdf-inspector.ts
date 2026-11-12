import type { PDFDocument } from '@cantoo/pdf-lib'
import { PDFAcroSignature, PDFArray, PDFDict, PDFName, PDFNumber } from '@cantoo/pdf-lib'

/** DocMDP permissions of a certification signature: 1 no changes, 2 form filling and signing, 3 also annotations. */
export type CertificationPermission = 1 | 2 | 3

export interface DigitalSignatureInfo {
  /** Signature fields that carry a signature (empty signature fields do not count) */
  signedFields: number
  /**
   * Set when the document is certified (DocMDP). Drawing on a page is not allowed at any level, so
   * viewers will report the certification as broken after signing with InkSign.
   */
  certification?: CertificationPermission
}

function certificationOf(doc: PDFDocument): CertificationPermission | undefined {
  const signature = doc.catalog.lookupMaybe(PDFName.of('Perms'), PDFDict)?.lookupMaybe(PDFName.of('DocMDP'), PDFDict)
  if (!signature)
    return undefined
  const references = signature.lookupMaybe(PDFName.of('Reference'), PDFArray)
  for (let i = 0; i < (references?.size() ?? 0); i++) {
    const reference = references!.lookupMaybe(i, PDFDict)
    if (reference?.get(PDFName.of('TransformMethod')) !== PDFName.of('DocMDP'))
      continue
    const permission = reference.lookupMaybe(PDFName.of('TransformParams'), PDFDict)?.lookupMaybe(PDFName.of('P'), PDFNumber)?.asNumber()
    // The spec's default when P is absent or out of range is 2
    return permission === 1 || permission === 3 ? permission : 2
  }
  return 2
}

/** Finds existing digital signatures (PRD FR-01) without modifying the document. */
export function describeDigitalSignatures(doc: PDFDocument): DigitalSignatureInfo {
  // catalog.getAcroForm() reads only; doc.getForm() would create a form and change the file
  const fields = doc.catalog.getAcroForm()?.getAllFields() ?? []
  const signedFields = fields.filter(([field]) => field instanceof PDFAcroSignature && field.V() !== undefined).length
  return { signedFields, certification: certificationOf(doc) }
}
