import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  PageSizes,
  PDFDocument,
  PDFHexString,
  PDFInvalidObject,
  PDFName,
  PDFNumber,
  PDFString,
  rgb,
  StandardFonts,
} from '@cantoo/pdf-lib'

// Real signatures need a CMS implementation; Node has none, so these helpers shell out to OpenSSL
// (present on CI runners and in Git for Windows).

const PLACEHOLDER_NAME = '**********'
const CONTENTS_BYTES = 8192
const latin1 = new TextDecoder('latin1')

export function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' })
    return true
  }
  catch {
    return false
  }
}

function withTempDir<T>(run: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), 'inksign-sig-'))
  try {
    return run(dir)
  }
  finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function concat(...parts: Uint8Array[]) {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

export interface SignedPdfOptions {
  /**
   * Makes it a certification signature (DocMDP) with these permissions: 1 no changes, 2 form filling
   * and signing, 3 also annotations. Omitted: an ordinary approval signature.
   */
  certify?: 1 | 2 | 3
}

/**
 * Builds a one-page PDF carrying an invisible `adbe.pkcs7.detached` signature made with a fresh
 * self-signed certificate, the way signing tools do: placeholder, ByteRange, CMS over the ranges.
 */
export async function createSignedPdf({ certify }: SignedPdfOptions = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const page = doc.addPage(PageSizes.A4)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText(certify ? `Certified (DocMDP P=${certify}) test document` : 'Digitally signed test document', { x: 60, y: 760, size: 18, font, color: rgb(0.2, 0.2, 0.2) })

  const byteRange = doc.context.obj([0, PDFName.of(PLACEHOLDER_NAME), PDFName.of(PLACEHOLDER_NAME), PDFName.of(PLACEHOLDER_NAME)])
  const signature = doc.context.obj({
    Type: 'Sig',
    Filter: 'Adobe.PPKLite',
    SubFilter: 'adbe.pkcs7.detached',
    ByteRange: byteRange,
    Contents: PDFHexString.of('00'.repeat(CONTENTS_BYTES)),
    Name: PDFString.of('InkSign Test Signer'),
    M: PDFString.fromDate(new Date()),
    ...(certify && {
      Reference: [{
        Type: 'SigRef',
        TransformMethod: 'DocMDP',
        TransformParams: { Type: 'TransformParams', P: certify, V: '1.2' },
      }],
    }),
  })
  // Written as raw bytes so it never ends up compressed in an object stream
  const signatureBytes = new Uint8Array(signature.sizeInBytes())
  signature.copyBytesInto(signatureBytes, 0)
  const signatureRef = doc.context.register(PDFInvalidObject.of(signatureBytes))

  const widgetRef = doc.context.register(doc.context.obj({
    Type: 'Annot',
    Subtype: 'Widget',
    FT: 'Sig',
    Rect: [0, 0, 0, 0],
    V: signatureRef,
    T: PDFString.of('Signature1'),
    F: 132, // Print + Locked
    P: page.ref,
  }))
  page.node.set(PDFName.of('Annots'), doc.context.obj([widgetRef]))
  const acroForm = doc.catalog.getOrCreateAcroForm()
  acroForm.dict.set(PDFName.of('SigFlags'), PDFNumber.of(3))
  acroForm.dict.set(PDFName.of('Fields'), doc.context.obj([widgetRef]))
  if (certify)
    doc.catalog.set(PDFName.of('Perms'), doc.context.obj({ DocMDP: signatureRef }))

  const bytes = await doc.save({ useObjectStreams: false })
  const text = latin1.decode(bytes)

  const contents = /\/Contents\s*<(0+)>/.exec(text)
  const range = /\/ByteRange\s*\[\s*0\s+\/\*{10}\s+\/\*{10}\s+\/\*{10}\s*\]/.exec(text)
  if (!contents || !range)
    throw new Error('Signature placeholders not found')
  const start = contents.index + contents[0].indexOf('<')
  const end = start + contents[1]!.length + 2
  const ranges = `/ByteRange [0 ${start} ${end} ${bytes.length - end}]`.padEnd(range[0].length, ' ')
  bytes.set(new TextEncoder().encode(ranges), range.index)

  const der = withTempDir((dir) => {
    const [key, cert, data, sig] = ['key.pem', 'cert.pem', 'data.bin', 'sig.der'].map(name => join(dir, name)) as [string, string, string, string]
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', cert, '-days', '2', '-subj', '/CN=InkSign Test Signer'], { stdio: 'ignore' })
    writeFileSync(data, concat(bytes.subarray(0, start), bytes.subarray(end)))
    execFileSync('openssl', ['cms', '-sign', '-binary', '-md', 'sha256', '-nosmimecap', '-outform', 'DER', '-signer', cert, '-inkey', key, '-in', data, '-out', sig], { stdio: 'ignore' })
    return readFileSync(sig)
  })
  const hex = der.toString('hex').padEnd(CONTENTS_BYTES * 2, '0')
  bytes.set(new TextEncoder().encode(hex), start + 1)
  return bytes
}

/** Length of a DER value including its header (the Contents hex is zero-padded after it). */
function derLength(der: Uint8Array): number {
  const first = der[1]!
  if (first < 0x80)
    return 2 + first
  const count = first & 0x7F
  let length = 0
  for (let i = 0; i < count; i++)
    length = length * 256 + der[2 + i]!
  return 2 + count + length
}

export interface SignatureCheck {
  byteRange: [number, number, number, number]
  /** The CMS signature still matches the bytes it covers */
  valid: boolean
  /** Nothing was appended after signing (false once a later revision exists) */
  coversWholeFile: boolean
}

/** Finds every signature in the file and verifies its CMS over the ByteRange (certificate trust is not checked). */
export function checkSignatures(pdfBytes: Uint8Array): SignatureCheck[] {
  const text = latin1.decode(pdfBytes)
  return [...text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)].map((match) => {
    const byteRange = match.slice(1, 5).map(Number) as [number, number, number, number]
    const [a, b, c, d] = byteRange
    const hex = latin1.decode(pdfBytes.subarray(a + b + 1, c - 1))
    const der = Uint8Array.from(hex.match(/../g)!, byte => Number.parseInt(byte, 16))
    const valid = withTempDir((dir) => {
      const [data, sig, out] = ['data.bin', 'sig.der', 'out.bin'].map(name => join(dir, name)) as [string, string, string]
      writeFileSync(data, concat(pdfBytes.subarray(a, a + b), pdfBytes.subarray(c, c + d)))
      writeFileSync(sig, der.subarray(0, derLength(der)))
      try {
        execFileSync('openssl', ['cms', '-verify', '-binary', '-inform', 'DER', '-in', sig, '-content', data, '-noverify', '-out', out], { stdio: 'ignore' })
        return true
      }
      catch {
        return false
      }
    })
    return { byteRange, valid, coversWholeFile: c + d === pdfBytes.length }
  })
}
