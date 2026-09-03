/**
 * Zonas horarias donde puede haber un campus.
 *
 * Una entrada por zona real, no por ciudad: Colombia entera es
 * America/Bogota, asi que Barranquilla entra ahi y no necesita fila propia.
 * Los paises que si tienen varias zonas (Argentina, Brasil, Mexico) llevan
 * una por cada una que haga falta.
 *
 * La ciudad que se muestra es la de la zona, que no siempre es donde esta la
 * iglesia: lo que importa es que el horario sea el mismo.
 */
const ZONES: Array<{ tz: string; country: string; city: string }> = [
  { tz: 'America/Argentina/Buenos_Aires', country: 'Argentina', city: 'Buenos Aires' },
  { tz: 'America/Argentina/Cordoba', country: 'Argentina', city: 'Córdoba' },
  { tz: 'America/Argentina/Mendoza', country: 'Argentina', city: 'Mendoza' },
  { tz: 'America/Argentina/Salta', country: 'Argentina', city: 'Salta' },
  { tz: 'America/Sao_Paulo', country: 'Brasil', city: 'San Pablo' },
  { tz: 'America/Santiago', country: 'Chile', city: 'Santiago' },
  { tz: 'America/Bogota', country: 'Colombia', city: 'Bogotá' },
  { tz: 'America/Monterrey', country: 'México', city: 'Monterrey' },
  { tz: 'America/Montevideo', country: 'Uruguay', city: 'Montevideo' },
];

export const TIMEZONES = ZONES.map((zone) => zone.tz);

const LABELS = new Map(ZONES.map((zone) => [zone.tz, `${zone.country} — ${zone.city}`]));

/**
 * "America/Bogota" -> "Colombia — Bogotá".
 *
 * El fallback arma la etiqueta con el nombre de la zona para que una
 * organizacion que ya tenga guardada una que no esta en la lista siga
 * mostrando algo legible en vez de un hueco.
 */
export function timezoneLabel(tz: string): string {
  return LABELS.get(tz) ?? tz.split('/').slice(1).join(' / ').replace(/_/g, ' ');
}
