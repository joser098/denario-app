import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { formatRange, formatShort } from '@/lib/dates';

type Client = SupabaseClient<Database>;

/** Códigos de los conceptos de egreso que crean los flujos de Gastos. */
export const EXPENSE_CONCEPTS = {
  purchase: 'compras',
  payment: 'pagos',
  cash: 'pagos-efectivo',
} as const;

export const PURCHASE_STATUS_LABELS = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  delivered: 'Entregada',
} as const;

export const PAYMENT_STATUS_LABELS = {
  pending: 'Pendiente',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  paid: 'Pagado',
} as const;

/** De dónde sale cada movimiento automático del libro. */
export const SOURCES = {
  purchase: 'purchase_request',
  payment: 'payment_request',
  cash: 'cash_payment',
} as const;

/**
 * Los pagos en efectivo que nunca llegaron al libro.
 *
 * De los tres flujos de Gastos, este es el único que puede dejar un hueco.
 * La compra entregada y el pago aprobado registran el egreso ANTES de
 * cambiar de estado: si no hay período, no pasa nada y se reintenta. El pago
 * en efectivo va al revés a propósito —el recibo lleva número correlativo y
 * ya se le dio a alguien, así que se emite igual— y el asiento queda
 * pendiente hasta que exista el período que lo contenga.
 *
 * Esto los busca: los del campus, con fecha adentro del período, que todavía
 * no tienen su movimiento.
 */
export async function pendingCashPayments(
  supabase: Client,
  where: { organizationId: string; campusId: string; from: string; to: string },
) {
  const { data: payments } = await supabase
    .from('cash_payments')
    .select('id, receipt_number, payee_name, concept, amount, currency_code, paid_on')
    .eq('organization_id', where.organizationId)
    .eq('campus_id', where.campusId)
    .gte('paid_on', where.from)
    .lte('paid_on', where.to)
    .order('paid_on');

  if (!payments || payments.length === 0) return [];

  const { data: already } = await supabase
    .from('week_entries')
    .select('source_id')
    .eq('source_type', SOURCES.cash)
    .in(
      'source_id',
      payments.map((payment) => payment.id),
    );

  const recorded = new Set((already ?? []).map((row) => row.source_id));
  return payments.filter((payment) => !recorded.has(payment.id));
}

/**
 * Deja el gasto en el libro semanal, en el período que contiene la fecha.
 *
 * El período no se abre solo: lo abre una persona, eligiendo desde y hasta.
 * Si la fecha del gasto no cae en ninguno, la operación se corta y avisa —
 * antes se abría una semana martes a lunes al vuelo, y eso terminaba
 * creando períodos que nadie había decidido abrir.
 *
 * Si existe pero está cerrado, también se corta: meter el gasto en otro
 * período para no molestar sería mentir sobre cuándo pasó.
 *
 * `maybeSingle` alcanza porque la base no deja que dos períodos del mismo
 * campus se pisen (`weeks_no_overlap`): a lo sumo hay uno que lo contenga.
 *
 * El movimiento queda marcado con su origen, así que en el Semanal se ve
 * como automático y no se puede borrar suelto.
 */
export async function recordWeeklyExpense(
  supabase: Client,
  input: {
    organizationId: string;
    campusId: string;
    conceptCode: string;
    amount: number;
    currency: string;
    date: string;
    sourceType: string;
    sourceId: string;
    description: string;
  },
): Promise<{ error?: string }> {
  // El gasto es del campus que lo pidió, así que cae en el período de ese
  // campus — no en el de toda la organización.
  const { data: week } = await supabase
    .from('weeks')
    .select('id, status, start_date, end_date')
    .eq('organization_id', input.organizationId)
    .eq('campus_id', input.campusId)
    .lte('start_date', input.date)
    .gte('end_date', input.date)
    .maybeSingle();

  if (!week) {
    return {
      error: `No hay ningún período del Semanal que contenga el ${formatShort(input.date)}. Abrilo en Semanal y volvé a intentar.`,
    };
  }

  if (week.status === 'closed') {
    const range = { start: week.start_date, end: week.end_date };
    return {
      error: `El período ${formatRange(range)} está cerrado. Reabrilo para poder registrar el gasto.`,
    };
  }

  const weekId = week.id;

  const { data: concept } = await supabase
    .from('week_concepts')
    .select('id')
    .eq('organization_id', input.organizationId)
    .eq('code', input.conceptCode)
    .maybeSingle();

  if (!concept) {
    return {
      error: `Falta el concepto "${input.conceptCode}" en el libro semanal. Creálo en Configuración → Conceptos.`,
    };
  }

  const { error } = await supabase.from('week_entries').insert({
    week_id: weekId,
    concept_id: concept.id,
    currency_code: input.currency,
    amount: input.amount,
    entry_date: input.date,
    description: input.description,
    source_type: input.sourceType,
    source_id: input.sourceId,
  });

  return error ? { error: error.message } : {};
}
