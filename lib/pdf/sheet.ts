import 'server-only';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

/**
 * Envoltorio minimo sobre pdf-lib: un cursor que baja por la hoja y unas
 * pocas primitivas (titulo, linea, fila de tabla). No es un motor de layout
 * ni pretende serlo: un acta es una hoja A4 con texto alineado.
 */

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const INK = rgb(0.09, 0.09, 0.11);
const MUTED = rgb(0.45, 0.45, 0.5);
const RULE = rgb(0.85, 0.85, 0.87);

/**
 * Las fuentes estandar de PDF codifican WinAnsi (Latin-1 + tipografia
 * comun). Todo lo que quede afuera revienta al escribir, asi que se traduce
 * antes: los acentos y la ñ pasan derecho, los guiones largos no.
 */
const SUBSTITUTIONS: Record<string, string> = {
  '—': '-',
  '–': '-',
  '−': '-',
  '…': '...',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
  '×': 'x',
  '→': '->',
};

export function safeText(value: string | null | undefined): string {
  return String(value ?? '')
    .replace(/[—–−…“”‘’×→]/g, (char) => SUBSTITUTIONS[char] ?? '')
    .replace(/[^ -ÿ\n]/g, '');
}

export type Align = 'left' | 'right';

export type Cell = {
  text: string;
  /** Ancho de la columna en puntos. */
  width: number;
  align?: Align;
  bold?: boolean;
  muted?: boolean;
};

export class Sheet {
  private page: PDFPage;
  private y: number;

  private constructor(
    private readonly pdf: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
  ) {
    this.page = pdf.addPage(A4);
    this.y = A4[1] - MARGIN;
  }

  static async create(): Promise<Sheet> {
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    return new Sheet(pdf, regular, bold);
  }

  get width() {
    return A4[0] - MARGIN * 2;
  }

  /** Abre hoja nueva si no entran `space` puntos mas. */
  private ensure(space: number) {
    if (this.y - space < MARGIN) {
      this.page = this.pdf.addPage(A4);
      this.y = A4[1] - MARGIN;
    }
  }

  gap(points = 12) {
    this.y -= points;
  }

  /**
   * Logo de la organizacion en la esquina superior derecha de la hoja
   * actual. No mueve el cursor: el encabezado de texto sigue empezando
   * arriba a la izquierda como si el logo no estuviera.
   */
  async stamp(logo: { bytes: Uint8Array; kind: 'png' | 'jpg' }) {
    const image =
      logo.kind === 'png'
        ? await this.pdf.embedPng(logo.bytes)
        : await this.pdf.embedJpg(logo.bytes);

    const box = image.scaleToFit(96, 48);
    this.page.drawImage(image, {
      x: MARGIN + this.width - box.width,
      y: A4[1] - MARGIN - box.height,
      width: box.width,
      height: box.height,
    });
  }

  /** Parte el texto en lineas que entren en el ancho util. */
  private wrap(content: string, font: PDFFont, size: number): string[] {
    const lines: string[] = [];

    for (const paragraph of content.split(/\r?\n/)) {
      let current = '';
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        const candidate = current ? `${current} ${word}` : word;
        if (font.widthOfTextAtSize(candidate, size) <= this.width) {
          current = candidate;
        } else {
          if (current) lines.push(current);
          current = word;
        }
      }
      lines.push(current);
    }

    return lines;
  }

  text(
    value: string,
    { size = 10, bold = false, muted = false, align = 'left' as Align } = {},
  ) {
    const font = bold ? this.bold : this.regular;

    for (const line of this.wrap(safeText(value), font, size)) {
      this.ensure(size + 6);
      const x =
        align === 'right' ? MARGIN + this.width - font.widthOfTextAtSize(line, size) : MARGIN;

      this.page.drawText(line, {
        x,
        y: this.y - size,
        size,
        font,
        color: muted ? MUTED : INK,
      });
      this.y -= size + 6;
    }
  }

  /** Recorta una celda para que no se monte sobre la columna siguiente. */
  private fit(content: string, font: PDFFont, size: number, width: number): string {
    if (font.widthOfTextAtSize(content, size) <= width) return content;

    let text = content;
    while (text.length > 1 && font.widthOfTextAtSize(`${text}...`, size) > width) {
      text = text.slice(0, -1);
    }
    return `${text}...`;
  }

  title(value: string) {
    this.text(value, { size: 16, bold: true });
  }

  rule(strong = false) {
    this.ensure(10);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y },
      end: { x: MARGIN + this.width, y: this.y },
      thickness: strong ? 1 : 0.5,
      color: strong ? INK : RULE,
    });
    this.y -= 10;
  }

  row(cells: Cell[], { size = 10 } = {}) {
    this.ensure(size + 8);
    let x = MARGIN;

    for (const cell of cells) {
      const font = cell.bold ? this.bold : this.regular;
      const content = this.fit(safeText(cell.text), font, size, cell.width - 8);
      const offset =
        cell.align === 'right' ? cell.width - font.widthOfTextAtSize(content, size) : 0;

      this.page.drawText(content, {
        x: x + offset,
        y: this.y - size,
        size,
        font,
        color: cell.muted ? MUTED : INK,
      });
      x += cell.width;
    }

    this.y -= size + 8;
  }

  /** Linea de firma con el nombre debajo. */
  signatures(entries: Array<{ role: string; name: string }>) {
    if (entries.length === 0) return;
    this.gap(28);
    this.ensure(48);

    const slot = this.width / entries.length;
    entries.forEach((entry, index) => {
      const x = MARGIN + slot * index;
      const lineWidth = slot - 24;

      this.page.drawLine({
        start: { x, y: this.y },
        end: { x: x + lineWidth, y: this.y },
        thickness: 0.5,
        color: INK,
      });
      this.page.drawText(safeText(entry.name || '—'), {
        x,
        y: this.y - 14,
        size: 10,
        font: this.regular,
        color: INK,
      });
      this.page.drawText(safeText(entry.role), {
        x,
        y: this.y - 26,
        size: 8,
        font: this.regular,
        color: MUTED,
      });
    });

    this.y -= 40;
  }

  footer(lines: string[]) {
    this.gap(8);
    this.rule();
    for (const line of lines) this.text(line, { size: 8, muted: true });
  }

  save(): Promise<Uint8Array> {
    return this.pdf.save();
  }
}
