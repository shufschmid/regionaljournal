import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { TextItem } from 'pdfjs-dist/types/src/display/api'

// The extension bundler (directus-extension build) inlines this module into a
// single dist/api.js, which breaks pdfjs-dist's own worker path guess - it looks
// for "pdf.worker.mjs" next to the bundle, which does not exist there (only in
// node_modules). Resolve the real file explicitly via Node's module resolution
// (works because node_modules/pdfjs-dist itself is not bundled away) rather than
// letting pdfjs-dist guess a path relative to the bundled file's location.
GlobalWorkerOptions.workerSrc = pathToFileURL(
  createRequire(import.meta.url).resolve('pdfjs-dist/legacy/build/pdf.worker.mjs')
).href

// Parses an SMD "Dossier" PDF (SRF Regionaljournal Basel Baselland transcripts).
//
// Ported from the Python PoC's pdf_parser.py, which used PyMuPDF's block/bbox API.
// pdfjs-dist's getTextContent() gives a flatter primitive: one positioned text item
// per visual LINE (verified against the real sample PDFs - a wrapped paragraph
// arrives as several same-x-column items at decreasing y, not pre-grouped into
// paragraphs the way PyMuPDF grouped them). Two things PyMuPDF gave for free had to
// be rebuilt here:
//
//   1. Column order: split lines by x0 < pageWidth/2, read all of the left column
//      top-to-bottom then all of the right column top-to-bottom (same as before).
//   2. Paragraph/block grouping: for the timestamped transcript body, the
//      `HH:MM:SS` prefix itself unambiguously marks a new paragraph, so no gap
//      heuristic is needed there. For the preamble (headline + teaser blocks,
//      which have no such per-line marker), a paragraph boundary was found to
//      reliably correlate with a larger-than-normal line gap: measured against the
//      real sample PDFs, a within-paragraph line gap is ~1.2x the font size and a
//      between-paragraph gap is ~1.7x - PARAGRAPH_GAP_RATIO sits in between.

export interface Paragraph {
  timestamp: string // "HH:MM:SS"
  seconds: number
  text: string
}

export interface Segment {
  broadcastDate: string // ISO "YYYY-MM-DD", from the PDF's own date header
  headline: string
  teaserBlocks: string[]
  paragraphs: Paragraph[]
}

const MARKER_TEXT = '[Automatische Transkription]'
const SUBTITLE_TEXT = 'Regionaljournal Basel Baselland'
const DATE_HEADER_RE = /srf Audio (\d{2})-(\d{2})-(\d{4})\s*$/
const FOOTER_RE = /^Dossier - Bello Bajour -/
// The footer's page number sits far enough right to land in the *right* text
// column on its own (confirmed against the real sample PDFs: same y as the
// "Dossier - Bello Bajour -" text, but a separate item at high x) - a lone
// digit line is never real transcript content, so it's safe to drop outright.
const PAGE_NUMBER_RE = /^\d+$/
const TIMESTAMP_RE = /^(\d{2}):(\d{2}):(\d{2})\s+(.*)$/s

// Calibrated against the real sample PDFs (see module comment above): a gap
// bigger than this multiple of the preceding line's font size starts a new block.
const PARAGRAPH_GAP_RATIO = 1.4

interface Line {
  y: number
  x0: number
  fontSize: number
  text: string
}

function isTextItem(item: unknown): item is TextItem {
  return typeof item === 'object' && item !== null && 'str' in item
}

interface RawItem {
  x: number
  y: number
  fontSize: number
  str: string
}

/**
 * Groups same-column items into lines by rounding y with a small tolerance.
 *
 * Must run PER COLUMN, never across the whole page: the left and right columns
 * routinely have text at the same height (confirmed against the real sample
 * PDFs), so grouping by y alone - before splitting into columns - merges a
 * left-column line and an unrelated right-column line into one garbled row,
 * silently swallowing whichever one didn't win the resulting text. That bug
 * dropped two real paragraphs' timestamps in early testing.
 */
function groupIntoLines(items: RawItem[]): Line[] {
  const rows = new Map<number, RawItem[]>()
  for (const item of items) {
    const key = Math.round(item.y * 2) / 2 // half-point tolerance for same-line items
    const row = rows.get(key)
    if (row) row.push(item)
    else rows.set(key, [item])
  }

  return [...rows.entries()]
    .map(([y, rowItems]) => {
      const sorted = [...rowItems].sort((a, b) => a.x - b.x)
      const first = sorted[0]
      const text = sorted
        .map((i) => i.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
        .normalize('NFKC')
      return { y, x0: first ? first.x : 0, fontSize: first ? first.fontSize : 10, text }
    })
    .filter((l) => l.text !== '')
}

async function extractOrderedLines(
  page: Awaited<ReturnType<Awaited<ReturnType<typeof getDocument>['promise']>['getPage']>>
): Promise<Line[]> {
  const viewport = page.view // [x0, y0, x1, y1] - always exactly 4 elements
  const pageWidth = viewport[2]! - viewport[0]!
  const mid = pageWidth / 2

  const content = await page.getTextContent()
  const leftItems: RawItem[] = []
  const rightItems: RawItem[] = []

  for (const raw of content.items) {
    if (!isTextItem(raw)) continue
    const str = raw.str
    if (str.trim() === '') continue

    const x = raw.transform[4] as number
    const y = raw.transform[5] as number
    const fontSize = Math.hypot(raw.transform[0] as number, raw.transform[1] as number)
    const item = { x, y, fontSize, str }
    ;(x < mid ? leftItems : rightItems).push(item)
  }

  const left = groupIntoLines(leftItems).sort((a, b) => b.y - a.y)
  const right = groupIntoLines(rightItems).sort((a, b) => b.y - a.y)
  return [...left, ...right]
}

function clusterIntoBlocks(lines: Line[]): Line[][] {
  const blocks: Line[][] = []
  let current: Line[] = []

  for (const line of lines) {
    const prev = current.at(-1)
    if (prev && (prev.y - line.y) / prev.fontSize > PARAGRAPH_GAP_RATIO) {
      blocks.push(current)
      current = []
    }
    current.push(line)
  }
  if (current.length > 0) blocks.push(current)
  return blocks
}

function joinWithHyphenAwareness(pieces: string[]): string {
  let text = ''
  for (const piece of pieces) {
    if (text === '') text = piece
    else if (text.endsWith('-')) text += piece
    else text += ' ' + piece
  }
  return text
}

function joinBlockLines(lines: Line[]): string {
  return joinWithHyphenAwareness(lines.map((l) => l.text))
}

interface SegmentAccumulator {
  broadcastDate: string
  headline: string
  teaserBlocks: string[]
  bodyLines: Line[]
}

function reflowParagraphs(lines: Line[]): Paragraph[] {
  const paragraphs: Paragraph[] = []

  for (const line of lines) {
    const match = TIMESTAMP_RE.exec(line.text)
    if (match) {
      const [, h, m, s, rest] = match as unknown as [string, string, string, string, string]
      paragraphs.push({
        timestamp: `${h}:${m}:${s}`,
        seconds: Number(h) * 3600 + Number(m) * 60 + Number(s),
        text: rest.trim()
      })
    } else {
      const last = paragraphs.at(-1)
      if (last) last.text = joinWithHyphenAwareness([last.text, line.text])
      // else: stray text before any timestamped paragraph started - dropped, as in the Python version
    }
  }

  return paragraphs
}

export async function parseDossier(buffer: Buffer): Promise<Segment[]> {
  const data = new Uint8Array(buffer)
  const doc = await getDocument({
    data,
    useWorkerFetch: false,
    disableFontFace: true,
    verbosity: 0
  }).promise

  const accumulators: SegmentAccumulator[] = []

  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum)
    const lines = (await extractOrderedLines(page)).filter(
      (l) => !FOOTER_RE.test(l.text) && !PAGE_NUMBER_RE.test(l.text)
    )

    const markerIndex = lines.findIndex((l) => l.text === MARKER_TEXT)

    let bodyLines: Line[]

    if (markerIndex !== -1) {
      const preambleLines = lines.slice(0, markerIndex)
      const dateLine = preambleLines.find((l) => DATE_HEADER_RE.test(l.text))
      if (!dateLine) {
        throw new Error(`Segment starting on PDF page ${pageNum} has no "srf Audio DD-MM-YYYY" date header`)
      }
      const dateMatch = DATE_HEADER_RE.exec(dateLine.text) as unknown as [string, string, string, string]
      const [, dd, mm, yyyy] = dateMatch
      const broadcastDate = `${yyyy}-${mm}-${dd}`

      const rest = preambleLines.filter((l) => l !== dateLine && l.text !== SUBTITLE_TEXT)
      const blocks = clusterIntoBlocks(rest)
      const [headlineBlock, ...teaserBlockLines] = blocks
      const headline = headlineBlock ? joinBlockLines(headlineBlock) : ''
      const teaserBlocks = teaserBlockLines.map(joinBlockLines)

      accumulators.push({ broadcastDate, headline, teaserBlocks, bodyLines: [] })
      bodyLines = lines.slice(markerIndex + 1)
    } else {
      const current = accumulators.at(-1)
      if (!current) continue // front matter (e.g. table of contents) before the first segment
      bodyLines = lines.filter((l) => !DATE_HEADER_RE.test(l.text)) // strip the repeated per-page date header
    }

    accumulators.at(-1)?.bodyLines.push(...bodyLines)
  }

  return accumulators.map((acc) => ({
    broadcastDate: acc.broadcastDate,
    headline: acc.headline,
    teaserBlocks: acc.teaserBlocks,
    paragraphs: reflowParagraphs(acc.bodyLines)
  }))
}
