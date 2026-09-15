import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { formatLong, formatRange, formatShort } from '@/lib/dates';

type Client = SupabaseClient<Database>;
type EntryInsert = Database['public']['Tables']['week_entries']['Insert'];

/**
 * El domingo baja al libro semanal cuando se cierra.
 *
 * Antes la misma plata se cargaba dos veces: se contaba en el acta y se
 * volvía a tipear en el Semanal. Dos copias del mismo peso que nadie podía
 * cruzar. Ahora el domingo es el origen y el Semanal lo recibe.
 *
 * Baja al cerrar y no en vivo a propósito: el número que entra al libro sale
 * de actas firmadas. Mientras el domingo está abierto puede cambiar, y un
 * libro que se mueve solo no es un libro.
 *
 * Los movimientos quedan marcados con su origen (`source_type = 'sunday'`),
 * así que en el Semanal se ven como automáticos y no se borran sueltos: se
 * deshacen reabriendo el domingo, que es de donde salieron.
 */

/** A qué concepto del Semanal entra cada cosa que trae el domingo. */
const CONCEPTS = {
  offering: 'efectivo',
  income: 'mercadopago',
  sale: 'actividad_comercial',
  envelopes: 'sobres',
} as const;

const SOURCE = 'sunday';

type Sunday = {
  id: string;
  organization_id: string;
  campus_id: string;
  service_date: string;
};

/**
 * El período del campus que contiene al domingo.
 *
 * No se abre solo: lo abre un administrador para toda la organización. Si el
 * domingo no cae en ninguno, el cierre se corta — meter la ofrenda en otro
 * período sería mentir sobre cuándo entró, y dejarla afuera sería perderla.
 */
export async function weekFor(supabase: Client, sunday: Sunday) {
  const { data } = await supabase
    .from('weeks')
    .select('id, status, start_date, end_date')
    .eq('organization_id', sunday.organization_id)
    .eq('campus_id', sunday.campus_id)
    .lte('start_date', sunday.service_date)
    .gte('end_date', sunday.service_date)
    .maybeSingle();

  return data;
}

async function conceptIds(supabase: Client, organizationId: string) {
  const codes = [...new Set(Object.values(CONCEPTS))];
  const { data } = await supabase
    .from('week_concepts')
    .select('id, code')
    .eq('organization_id', organizationId)
    .in('code', codes);

  return new Map((data ?? []).map((row) => [row.code, row.id]));
}

/**
 * Deja en el período los movimientos del domingo, reemplazando los que ya
 * hubiera de ese mismo domingo.
 *
 * Reemplazar y no acumular: cerrar dos veces el mismo domingo (porque se
 * reabrió y se corrigió un acta) tiene que dejar el libro como si se hubiera
 * cerrado una sola vez, con los números de ahora.
 */
export async function requireOpenWeek(
  supabase: Client,
  sunday: Sunday,
  verb: string,
): Promise<{ error: string } | { week: NonNullable<Awaited<ReturnType<typeof weekFor>>> }> {
  const week = await weekFor(supabase, sunday);

  if (!week) {
    return {
      error: `No hay ningún período del Semanal que contenga el ${formatLong(sunday.service_date)}. Un administrador lo abre en Semanal.`,
    };
  }

  if (week.status === 'closed') {
    const range = { start: week.start_date, end: week.end_date };
    return {
      error: `El período ${formatRange(range)} ya está cerrado. Reabrilo para poder ${verb} este domingo.`,
    };
  }

  return { week };
}

export async function syncSundayIntoWeek(
  supabase: Client,
  sunday: Sunday,
): Promise<{ error?: string }> {
  const found = await requireOpenWeek(supabase, sunday, 'cerrar');
  if ('error' in found) return { error: found.error };
  const { week } = found;

  const [{ data: amounts }, { data: counts }] = await Promise.all([
    supabase.from('meeting_amounts').select('*').eq('sunday_id', sunday.id),
    // Solo las actas firmadas: son las únicas que aportan plata al total, y
    // los sobres se cuentan con el mismo criterio.
    supabase
      .from('offering_counts')
      .select('envelopes_count, status, sunday_meetings!inner(sunday_id)')
      .eq('status', 'finalized')
      .eq('sunday_meetings.sunday_id', sunday.id),
  ]);

  // Una fila por concepto y moneda: al libro entra un renglón por cada cosa,
  // no uno por reunión. El detalle de la reunión ya vive en Domingos.
  const money = new Map<string, { code: string; currency: string; amount: number }>();

  for (const row of amounts ?? []) {
    const code = CONCEPTS[row.kind];
    if (!code) continue;

    const key = `${code}|${row.currency_code}`;
    const line = money.get(key) ?? { code, currency: row.currency_code, amount: 0 };
    line.amount += Number(row.amount);
    money.set(key, line);
  }

  const envelopes = (counts ?? []).reduce((sum, row) => sum + row.envelopes_count, 0);

  const ids = await conceptIds(supabase, sunday.organization_id);
  const missing = [...new Set([...money.values()].map((line) => line.code))].find(
    (code) => !ids.get(code),
  );

  if (missing) {
    return {
      error: `Falta el concepto "${missing}" en el libro semanal. Creálo en Configuración → Conceptos.`,
    };
  }

  const description = `Domingo ${formatShort(sunday.service_date)}`;

  const rows: EntryInsert[] = [...money.values()]
    .filter((line) => line.amount > 0)
    .map((line) => ({
      week_id: week.id,
      concept_id: ids.get(line.code)!,
      currency_code: line.currency,
      amount: line.amount,
      entry_date: sunday.service_date,
      description,
      source_type: SOURCE,
      source_id: sunday.id,
    }));

  // Los sobres no son plata: van con monto cero y lo que importa es cuántos.
  // Suman a la participación del reporte junto con las transacciones.
  const envelopeConcept = ids.get(CONCEPTS.envelopes);
  if (envelopes > 0 && envelopeConcept) {
    rows.push({
      week_id: week.id,
      concept_id: envelopeConcept,
      currency_code: 'ARS',
      amount: 0,
      movement_count: envelopes,
      entry_date: sunday.service_date,
      description,
      source_type: SOURCE,
      source_id: sunday.id,
    });
  }

  await removeSundayFromWeek(supabase, sunday.id);

  if (rows.length === 0) return {};

  const { error } = await supabase.from('week_entries').insert(rows);
  return error ? { error: error.message } : {};
}

/**
 * Saca del libro lo que había bajado de este domingo.
 *
 * Es lo que pasa al reabrirlo: mientras vuelve a estar abierto sus números
 * pueden cambiar, así que no pueden quedar contados en el Semanal. Vuelven
 * solos cuando se cierra de nuevo.
 */
export async function removeSundayFromWeek(supabase: Client, sundayId: string) {
  await supabase
    .from('week_entries')
    .delete()
    .eq('source_type', SOURCE)
    .eq('source_id', sundayId);
}
