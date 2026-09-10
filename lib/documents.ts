import type { DocumentType } from '@/lib/database.types';

/**
 * Como se llama el documento de identidad en el pais del campus.
 *
 * El acta de conteo no guarda el numero: deja el renglon en blanco al lado
 * de cada firma para escribirlo a mano al firmar. Lo unico que sale de aca
 * es la etiqueta impresa, y por eso la lista es corta y por pais — un campus
 * pide un documento, no siete.
 *
 * Espeja el check de `campuses.document_type`: al agregar un pais hay que
 * tocar tambien la migracion.
 */
const DOCUMENTS: Array<{ code: DocumentType; country: string; name: string }> = [
  { code: 'DNI', country: 'Argentina', name: 'Documento Nacional de Identidad' },
  { code: 'CPF', country: 'Brasil', name: 'Cadastro de Pessoas Físicas' },
  { code: 'CC', country: 'Colombia', name: 'Cédula de Ciudadanía' },
  { code: 'CI', country: 'Uruguay', name: 'Cédula de Identidad' },
  { code: 'CURP', country: 'México', name: 'Clave Única de Registro de Población' },
];

/** Argentina es donde esta hoy la operacion: es el default de la columna. */
export const DEFAULT_DOCUMENT_TYPE: DocumentType = 'DNI';

export const DOCUMENT_TYPES = DOCUMENTS.map((doc) => doc.code);

const LABELS = new Map(DOCUMENTS.map((doc) => [doc.code, `${doc.country} — ${doc.code}`]));

/** "CPF" -> "Brasil — CPF". Para el selector de campus. */
export function documentLabel(code: string): string {
  return LABELS.get(code as DocumentType) ?? code;
}

/**
 * Lo que llega de un formulario. Cae en DNI si no es uno de la lista: el
 * documento es una etiqueta impresa, no vale trabar el alta de un campus por
 * un select manipulado — y el check de la base seria un error feo.
 */
export function toDocumentType(value: FormDataEntryValue | null): DocumentType {
  const code = String(value ?? '').trim().toUpperCase();
  return (DOCUMENT_TYPES as string[]).includes(code)
    ? (code as DocumentType)
    : DEFAULT_DOCUMENT_TYPE;
}
