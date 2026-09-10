/**
 * El slug de la organizacion es un segmento de primer nivel (`/mi-iglesia`),
 * asi que no puede pisar una ruta de la app.
 */
export const RESERVED_SLUGS = new Set([
  'api',
  'auth',
  'changelog',
  'invitacion',
  'login',
  'nueva-organizacion',
  'p',
  'r',
  'recuperar',
  's',
  'signup',
  'v',
]);

export function slugify(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}
