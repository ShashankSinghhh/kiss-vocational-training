import { existsSync } from 'node:fs';
import path from 'node:path';
import PDFDocument from 'pdfkit';

/** Fonts ship in apps/api/assets/fonts: next to src/ in dev, next to dist/ when bundled. */
export function fontsDir(): string {
  const candidates = [
    path.resolve(__dirname, '../../../assets/fonts'),
    path.resolve(__dirname, '../assets/fonts'),
    path.resolve(process.cwd(), 'apps/api/assets/fonts'),
    path.resolve(process.cwd(), 'assets/fonts'),
  ];
  const dir = candidates.find((d) => existsSync(path.join(d, 'noto-sans-latin-400-normal.woff')));
  if (!dir) throw new Error('PDF fonts not found');
  return dir;
}

export const INK = '#0f172a';
export const MUTED = '#475569';
export const ACCENT = '#1d4ed8';
export const RULE = '#cbd5e1';

const ODIA = /[଀-୿]/;

/**
 * A PDFKit document with Noto Sans registered as `regular`/`bold` (and the Odia faces), plus a
 * promise of the finished bytes. Text containing Odia picks the Odia face via `face()`.
 */
export function createPdf(options: PDFKit.PDFDocumentOptions) {
  const fonts = fontsDir();
  const doc = new PDFDocument(options);
  doc.registerFont('regular', path.join(fonts, 'noto-sans-latin-400-normal.woff'));
  doc.registerFont('bold', path.join(fonts, 'noto-sans-latin-700-normal.woff'));
  doc.registerFont('odia', path.join(fonts, 'noto-sans-oriya-oriya-400-normal.woff'));
  doc.registerFont('odia-bold', path.join(fonts, 'noto-sans-oriya-oriya-700-normal.woff'));
  doc.font('regular');

  const chunks: Buffer[] = [];
  doc.on('data', (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const face = (text: string, weight: 'regular' | 'bold' = 'regular') =>
    ODIA.test(text) ? (weight === 'bold' ? 'odia-bold' : 'odia') : weight;
  return { doc, done, face };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-23" → "23 Oct 2026" (calendar days, no time zone). */
export function pdfDay(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export interface TableColumn {
  header: string;
  /** Relative width; the table always spans the content width. */
  width: number;
  align?: 'left' | 'right' | 'center';
}

/**
 * Draws a table from the current y, breaking onto new pages (header repeated) as needed.
 * Cells are plain strings; long text wraps inside its column.
 */
export function drawTable(
  doc: PDFKit.PDFDocument,
  columns: TableColumn[],
  rows: string[][],
  face: (text: string, weight?: 'regular' | 'bold') => string,
) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const total = columns.reduce((s, c) => s + c.width, 0);
  const widths = columns.map((c) => (c.width / total) * width);
  const pad = 4;
  const size = 8.5;
  const bottom = () => doc.page.height - doc.page.margins.bottom;

  const rowHeight = (cells: string[], bold: boolean) =>
    Math.max(
      ...cells.map((text, i) =>
        doc
          .font(face(text, bold ? 'bold' : 'regular'))
          .fontSize(size)
          .heightOfString(text || ' ', { width: widths[i]! - pad * 2 }),
      ),
    ) +
    pad * 2;

  const drawRow = (cells: string[], bold: boolean, shade: boolean) => {
    const h = rowHeight(cells, bold);
    const y = doc.y;
    if (shade) doc.rect(left, y, width, h).fill('#f1f5f9');
    let x = left;
    cells.forEach((text, i) => {
      doc
        .font(face(text, bold ? 'bold' : 'regular'))
        .fontSize(size)
        .fillColor(INK)
        .text(text, x + pad, y + pad, {
          width: widths[i]! - pad * 2,
          align: columns[i]!.align ?? 'left',
        });
      x += widths[i]!;
    });
    doc
      .moveTo(left, y + h)
      .lineTo(left + width, y + h)
      .lineWidth(0.5)
      .strokeColor(RULE)
      .stroke();
    doc.x = left;
    doc.y = y + h;
  };

  const header = columns.map((c) => c.header);
  drawRow(header, true, true);
  for (const row of rows) {
    if (doc.y + rowHeight(row, false) > bottom()) {
      doc.addPage();
      drawRow(header, true, true);
    }
    drawRow(row, false, false);
  }
}

/** Title block shared by every report. */
export function reportHeading(
  doc: PDFKit.PDFDocument,
  face: (text: string, weight?: 'regular' | 'bold') => string,
  institution: string,
  title: string,
  subtitle: string,
) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  doc.font('regular').fontSize(9).fillColor(MUTED).text(institution, left, doc.page.margins.top);
  doc.font('bold').fontSize(16).fillColor(ACCENT).text(title, { width });
  doc.font(face(subtitle)).fontSize(10).fillColor(MUTED).text(subtitle, { width });
  doc.moveDown(0.6);
}

/** Page numbers and the generation time on every page. */
export function pageFooters(doc: PDFKit.PDFDocument, generatedAt: Date) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - doc.page.margins.bottom + 12;
    // Writing below the bottom margin would make PDFKit add a page; lift the margin briefly.
    const margin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc
      .font('regular')
      .fontSize(7.5)
      .fillColor(MUTED)
      .text(
        `Generated ${generatedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC · KISS SkillBridge · Page ${i - range.start + 1} of ${range.count}`,
        doc.page.margins.left,
        y,
        { width: doc.page.width - doc.page.margins.left - doc.page.margins.right, align: 'center' },
      );
    doc.page.margins.bottom = margin;
  }
}
