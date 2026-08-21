import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { formatRange, weekOf } from '@/lib/dates';

type Client = SupabaseClient<Database>;

/** Códigos de los conceptos de egreso que crean los flujos de Gastos. */
export const EXPENSE_CONCEPTS = {
  purchase: 'compras',
  budget: 'presupuestos',
} as const;

export const PURCHASE_STATUS_LABELS = {
  pending: 'Pendiente',
  approved: 'Aprobada',
  rejected: 'Rechazada',
  delivered: 'Entregada',
} as const;

export const BUDGET_STATUS_LABELS = {
  pending: 'Pendiente',
  rejected: 'Rechazado',
  paid: 'Pagado',
} as const;

/**
 * Deja el gasto en el libro semanal, en la semana que contiene la fecha.
 *
 * Si esa semana todavía no existe se abre sola — obligar a abrirla a mano
 * antes de poder entregar una compra sería una traba sin sentido. Si existe
 * pero está cerrada, la operación se corta: meter el gasto en otra semana
 * para no molestar sería mentir sobre cuándo pasó.
 *
 * El movimiento queda marcado con su origen, así que en el Semanal se ve
 * como automático y no se puede borrar suelto.
 */
export async function recordWeeklyExpense(
  supabase: Client,
  input: {
    organizationId: string;
    conceptCode: string;
    amount: number;
    currency: string;
    date: string;
    sourceType: string;
    sourceId: string;
    description: string;
  },
): Promise<{ error?: string }> {
  const range = weekOf(input.date);

  // El gasto es de la organización, no de un campus: va a la semana sin campus.
  const { data: existing } = await supabase
    .from('weeks')
    .select('id, status')
    .eq('organization_id', input.organizationId)
    .is('campus_id', null)
    .eq('start_date', range.start)
    .maybeSingle();

  if (existing?.status === 'closed') {
    return {
      error: `La semana ${formatRange(range)} está cerrada. Reabrila para poder registrar el gasto.`,
    };
  }

  let weekId = existing?.id;

  if (!weekId) {
    const { data: created, error } = await supabase
      .from('weeks')
      .insert({
        organization_id: input.organizationId,
        campus_id: null,
        start_date: range.start,
        end_date: range.end,
      })
      .select('id')
      .single();

    if (error || !created) {
      return { error: 'No se pudo abrir la semana para registrar el gasto.' };
    }
    weekId = created.id;
  }

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
