/** Zonas horarias razonables para las iglesias del Cono Sur. */
export const TIMEZONES = [
  'America/Argentina/Buenos_Aires',
  'America/Argentina/Cordoba',
  'America/Argentina/Mendoza',
  'America/Argentina/Salta',
  'America/Montevideo',
  'America/Santiago',
];

export function timezoneLabel(tz: string): string {
  return tz.split('/').slice(1).join(' / ').replace(/_/g, ' ');
}
