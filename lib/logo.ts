/**
 * El logo de la organizacion vive en un bucket publico: asi la barra lateral
 * lo pide con una URL comun, sin firmar nada en cada pantalla. Es la marca de
 * una iglesia, no un dato sensible.
 */
export const LOGO_BUCKET = 'logos';

export function logoUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return null;
  return `${base.replace(/\/$/, '')}/storage/v1/object/public/${LOGO_BUCKET}/${path}`;
}
