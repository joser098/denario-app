import { slugify } from '@/lib/slug';

/**
 * El nombre con el que se baja un PDF.
 *
 * En el bucket los archivos se llaman por id (`acta-<uuid>.pdf`), que es lo
 * que hace falta para que dos actas de la misma reunion no se pisen. Pero en
 * la carpeta de Descargas ese nombre no dice nada: el que los junta para el
 * cierre del mes necesita ver de que campus y de que fecha es cada uno sin
 * abrirlos.
 *
 * Se arma al bajar y no al guardar a proposito: asi los PDF que ya estaban
 * guardados tambien salen con el nombre nuevo, y si el campus se renombra el
 * archivo sale con el nombre de ahora.
 */
export type PdfKind = 'acta' | 'cierre' | 'caja' | 'recibo' | 'pl';

const PREFIX: Record<PdfKind, string> = {
  acta: 'acta',
  cierre: 'cierre',
  caja: 'caja',
  recibo: 'recibo',
  pl: 'profit-loss',
};

export function pdfName({
  kind,
  campus,
  date,
  detail,
}: {
  kind: PdfKind;
  campus: string;
  /** yyyy-mm-dd. Va tal cual para que ordene bien por nombre. */
  date: string;
  /** La reunion, o el numero del recibo. */
  detail?: string;
}): string {
  const parts = [PREFIX[kind], slugify(campus), date, detail ? slugify(detail) : ''];
  return `${parts.filter(Boolean).join('-')}.pdf`;
}
