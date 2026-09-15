import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { ratesOf, summarizeWeek } from '@/lib/weeks';

type Client = SupabaseClient<Database>;

/**
 * Todo lo que hace falta para leer el periodo completo: los movimientos, los
 * conceptos que dicen que es cada uno y las cotizaciones para pasarlos a la
 * moneda del campus.
 */
export async function loadWeek(supabase: Client, organizationId: string, weekId: string) {
  const { data: week } = await supabase
    .from('weeks')
    .select('*, campuses!inner(default_currency)')
    .eq('id', weekId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (!week) return null;

  const currency = (week.campuses as unknown as { default_currency: string }).default_currency;

  const [{ data: entries }, { data: concepts }, { data: rates }] = await Promise.all([
    supabase.from('week_entries').select('*').eq('week_id', weekId).order('created_at'),
    supabase
      .from('week_concepts')
      .select('*')
      .eq('organization_id', organizationId)
      .order('sort_order'),
    supabase
      .from('exchange_rates')
      .select('currency_code, units_per_usd')
      .eq('organization_id', organizationId)
      .eq('period_start', week.start_date),
  ]);

  const rateMap = ratesOf(rates);
  const summary = summarizeWeek({
    entries: entries ?? [],
    concepts: concepts ?? [],
    currency,
    rates: rateMap,
  });

  return {
    week,
    currency,
    rates: rateMap,
    entries: entries ?? [],
    concepts: concepts ?? [],
    summary,
  };
}
