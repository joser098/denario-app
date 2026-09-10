/**
 * Fechas de calendario, no instantes.
 *
 * Todo se maneja como string `YYYY-MM-DD` y los Date intermedios son siempre
 * UTC. Un domingo o una semana son dias del calendario de la organizacion: si
 * los pasaramos por la zona horaria del navegador, un domingo a las 20:00 en
 * Buenos Aires podria mostrarse como lunes.
 */

export type DateRange = { start: string; end: string };

/** Dia de la semana ISO: 1 = lunes ... 7 = domingo. */
export const MONDAY = 1;
export const TUESDAY = 2;
export const SUNDAY = 7;

export function parseISODate(date: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function toISODate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(date: string, days: number): string {
  const d = parseISODate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toISODate(d);
}

export function isoDayOfWeek(date: string): number {
  const day = parseISODate(date).getUTCDay();
  return day === 0 ? SUNDAY : day;
}

/**
 * Zona horaria de ultimo recurso: la del campus manda, si no la tiene hereda
 * la de la organizacion, y recien si faltan las dos se cae aca.
 */
export const DEFAULT_TIMEZONE = 'America/Argentina/Buenos_Aires';

/** La del campus si tiene propia; si no, la de la organizacion. */
export function timezoneOf(
  campus: { timezone: string | null } | null | undefined,
  organization: { timezone: string | null } | null | undefined,
): string {
  return campus?.timezone ?? organization?.timezone ?? DEFAULT_TIMEZONE;
}

/** Hoy segun la zona horaria de la organizacion, como `YYYY-MM-DD`. */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** El dia `weekday` (ISO) en o antes de `date`. */
export function onOrBefore(date: string, weekday: number): string {
  const diff = (isoDayOfWeek(date) - weekday + 7) % 7;
  return addDays(date, -diff);
}

// ---------- Semana martes a lunes ----------
//
// Ya no es "el periodo del libro": desde que el Semanal abre por rango
// libre, esto es solo la sugerencia que viene precargada en el formulario y
// la base para comparar semanas en el dashboard.

/** La semana (martes-lunes) que contiene `date`. */
export function weekOf(date: string): DateRange {
  const start = onOrBefore(date, TUESDAY);
  return { start, end: addDays(start, 6) };
}

export function previousWeek(week: DateRange): DateRange {
  const start = addDays(week.start, -7);
  return { start, end: addDays(start, 6) };
}

export function nextWeek(week: DateRange): DateRange {
  const start = addDays(week.start, 7);
  return { start, end: addDays(start, 6) };
}

/**
 * La ultima semana ya terminada — la que el dashboard llama "semana vencida".
 * La semana en curso todavia se esta cargando, asi que no sirve para comparar.
 */
export function lastClosedWeek(today: string): DateRange {
  return previousWeek(weekOf(today));
}

// ---------- Domingos ----------

export function lastSunday(today: string): string {
  return onOrBefore(today, SUNDAY);
}

// ---------- Formato ----------

const LONG = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'UTC',
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

const SHORT = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const DAY_MONTH = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'UTC',
  day: 'numeric',
  month: 'short',
});

/** `"domingo, 16 de agosto de 2026"` */
export function formatLong(date: string): string {
  return LONG.format(parseISODate(date));
}

/** `"16/08/2026"` */
export function formatShort(date: string): string {
  return SHORT.format(parseISODate(date));
}

const MONTH = new Intl.DateTimeFormat('es-AR', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});

/** `"agosto de 2026"` */
export function formatMonth(date: string): string {
  return MONTH.format(parseISODate(date));
}

/** `true` si las dos fechas caen en el mismo mes calendario. */
export function sameMonth(a: string, b: string): boolean {
  return a.slice(0, 7) === b.slice(0, 7);
}

/** `"30 ago"`. Para ejes y etiquetas donde el año ya se sobreentiende. */
export function formatDayMonth(date: string): string {
  return DAY_MONTH.format(parseISODate(date));
}

/** `"12 ago — 18 ago"` */
export function formatRange(range: DateRange): string {
  return `${DAY_MONTH.format(parseISODate(range.start))} — ${DAY_MONTH.format(parseISODate(range.end))}`;
}

/** `"10:30:00"` -> `"10:30"` */
export function formatTime(time: string): string {
  return time.slice(0, 5);
}

/**
 * `"31/08/26 21:15"` — un instante, en la hora del campus.
 *
 * A diferencia del resto de este archivo, aca la hora importa: cuando se
 * firmo un acta, cuando se cerro una caja. Son `timestamptz`, o sea instantes
 * en UTC, y sin `timeZone` explicito se formatean con la del servidor —que en
 * produccion es UTC— asi que un acta firmada el domingo 21:15 en Buenos Aires
 * salia impresa como lunes 00:15.
 */
export function formatStamp(iso: string | null, timezone: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-AR', {
    timeZone: timezone || DEFAULT_TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'short',
  });
}
