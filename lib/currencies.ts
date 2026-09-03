import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Currency, Database } from '@/lib/database.types';
import { campusCurrencies } from '@/lib/money';

type Client = SupabaseClient<Database>;

export type CurrencyOption = Pick<Currency, 'code' | 'name' | 'symbol'>;

/**
 * Catalogo de monedas habilitadas.
 *
 * Es del sistema, no de cada iglesia: una moneda existe o no existe, y lo que
 * cada organizacion elige es cual usa. Se lee de la base y no de una lista en
 * el codigo para que agregar una moneda sea una migracion y nada mas — antes
 * habia trece pantallas con ARS y USD escritos a mano y dos validadores que
 * rechazaban cualquier otra cosa.
 *
 * Recibe el cliente porque el formulario publico de pedidos no tiene sesion y
 * entra con service-role: `currencies` solo se lee con usuario autenticado.
 */
export async function listCurrencies(supabase: Client): Promise<CurrencyOption[]> {
  const { data } = await supabase
    .from('currencies')
    .select('code, name, symbol')
    .eq('is_active', true)
    .order('code');

  return data ?? [];
}

/** Los codigos pelados, para validar o para pintar checkboxes. */
export async function listCurrencyCodes(supabase: Client): Promise<string[]> {
  return (await listCurrencies(supabase)).map((c) => c.code);
}

/**
 * Los billetes que se cuentan en ese campus.
 *
 * Traer todas las denominaciones activas serviria mientras el catalogo
 * tuviera dos monedas; con el catalogo completo, la planilla del acta le
 * pediria al voluntario contar reales y pesos mexicanos en Buenos Aires.
 */
export { campusCurrencies };

export async function listDenominations(supabase: Client, currencies: string[]) {
  const { data } = await supabase
    .from('currency_denominations')
    .select('currency_code, value')
    .in('currency_code', currencies)
    .eq('is_active', true);

  return data ?? [];
}
