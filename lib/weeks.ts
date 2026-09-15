import type { Totals } from '@/lib/sundays';
import type {
  ExpenseKey,
  RevenueKey,
  WeekConcept,
  WeekConceptKind,
  WeekEntry,
} from '@/lib/database.types';
import { EXPENSE_FIELDS, REVENUE_FIELDS } from '@/lib/reports';

/**
 * Totales del libro semanal.
 *
 * Los montos se guardan siempre en positivo: el signo lo pone el tipo del
 * concepto. Acá se separan en dos columnas y recién al final se restan.
 */
export type WeekTotals = {
  income: Totals;
  expense: Totals;
  /** Ingresos menos egresos, moneda por moneda. Puede dar negativo. */
  balance: Totals;
};

export const CONCEPT_KIND_LABELS: Record<WeekConceptKind, string> = {
  income: 'Ingreso',
  expense: 'Egreso',
};

type Amount = { kind: WeekConceptKind; currency_code: string; amount: number | string };

export function weekTotals(rows: Amount[] | null | undefined): WeekTotals {
  const totals: WeekTotals = { income: {}, expense: {}, balance: {} };

  for (const row of rows ?? []) {
    const amount = Number(row.amount);
    const bucket = row.kind === 'expense' ? totals.expense : totals.income;
    bucket[row.currency_code] = (bucket[row.currency_code] ?? 0) + amount;

    totals.balance[row.currency_code] =
      (totals.balance[row.currency_code] ?? 0) + (row.kind === 'expense' ? -amount : amount);
  }

  return totals;
}

/** Un saldo en cero no es lo mismo que "sin movimientos": hay que mostrarlo. */
export function hasMovements(totals: WeekTotals): boolean {
  return Object.keys(totals.income).length > 0 || Object.keys(totals.expense).length > 0;
}

// ============================================================
// Moneda local
// ============================================================

/**
 * Las cotizaciones del período: cuántas unidades de cada moneda equivalen a
 * un dólar. El dólar no está en el mapa — vale uno y no se cotiza contra sí
 * mismo.
 */
export type Rates = Record<string, number>;

export function ratesOf(rows: { currency_code: string; units_per_usd: number }[] | null) {
  return Object.fromEntries(
    (rows ?? []).map((row) => [row.currency_code, Number(row.units_per_usd)]),
  ) as Rates;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Pasa un monto de una moneda a otra con las cotizaciones del período.
 *
 * El dólar es el puente: todo se convierte a dólares y de ahí a destino. Así
 * un campus que cobra en pesos puede tener un movimiento en cualquier moneda
 * y sigue habiendo un solo número por cotización — no hay que cargar el par
 * ARS/COP además de los dos contra el dólar.
 *
 * Devuelve null cuando falta la cotización de alguna de las dos puntas. Es
 * deliberado: el que llama tiene que decidir qué hacer con eso, y lo que no
 * se puede convertir no se puede sumar en silencio.
 */
export function convert(
  amount: number,
  from: string,
  to: string,
  rates: Rates,
): number | null {
  if (from === to) return round(amount);

  const usd = from === 'USD' ? amount : rates[from] ? amount / rates[from] : null;
  if (usd === null) return null;

  if (to === 'USD') return round(usd);
  return rates[to] ? round(usd * rates[to]) : null;
}

/**
 * Que cotizacion falta para poder hacer esa conversion.
 *
 * No es la moneda del movimiento: es la del par que no se pudo resolver. Un
 * movimiento en dolares dentro de un campus que lleva pesos no necesita "la
 * cotizacion del dolar" —el dolar vale uno— sino la del peso. Decir la otra
 * manda a cargar el numero equivocado.
 */
export function missingRateFor(from: string, to: string, rates: Rates): string[] {
  if (from === to) return [];
  return [from, to].filter((code) => code !== 'USD' && !rates[code]);
}

// ============================================================
// Lo que el período le pasa al Profit & Loss
// ============================================================

export type ConceptRow = Pick<
  WeekConcept,
  'id' | 'code' | 'name' | 'kind' | 'counts_only' | 'pl_revenue_key' | 'has_movement_count'
>;

export type EntryRow = Pick<
  WeekEntry,
  'id' | 'concept_id' | 'currency_code' | 'amount' | 'movement_count' | 'pl_expense_key'
>;

export type WeekSummary = {
  /** Por moneda, sin convertir. Es lo que se cargó, tal cual. */
  totals: WeekTotals;
  /** Todo en la moneda del campus. Null si falta alguna cotización. */
  local: { income: number; expense: number; balance: number } | null;
  /** Los renglones de ingreso del reporte, en moneda local. */
  revenue: Record<RevenueKey, number>;
  /** Los renglones de egreso del reporte, en moneda local. */
  expenses: Record<ExpenseKey, number>;
  /** Transacciones, sobres: lo que se cuenta y no es plata. */
  counts: { code: string; name: string; movements: number }[];
  /** Transacciones + sobres. Es la participación del reporte. */
  participants: number;
  /** Monedas cuya cotización falta para poder cerrar el total. */
  missingRates: string[];
  /** Egresos sin categoría del P&L: no saben a qué renglón bajar. */
  uncategorized: number;
};

const emptyRevenue = () =>
  Object.fromEntries(REVENUE_FIELDS.map((f) => [f.key, 0])) as Record<RevenueKey, number>;

const emptyExpenses = () =>
  Object.fromEntries(EXPENSE_FIELDS.map((f) => [f.key, 0])) as Record<ExpenseKey, number>;

/**
 * Lee el período entero y arma de una sola pasada lo que necesitan la
 * pantalla, el PDF y el reporte.
 *
 * Se hace acá y no en tres lugares porque los tres tienen que decir lo
 * mismo: el total que se ve en la tabla, el que se imprime y el que baja al
 * Profit & Loss son el mismo número o hay un problema.
 *
 * `currency` es la del campus. Todo lo cargado en otra moneda se convierte
 * con la cotización del período; lo que no se pueda convertir queda contado
 * en `missingRates` y deja `local` en null, porque un total al que le falta
 * una parte no es un total.
 */
export function summarizeWeek({
  entries,
  concepts,
  currency,
  rates,
}: {
  entries: EntryRow[] | null | undefined;
  concepts: ConceptRow[] | null | undefined;
  currency: string;
  rates: Rates;
}): WeekSummary {
  const byId = new Map((concepts ?? []).map((c) => [c.id, c]));

  const totals: WeekTotals = { income: {}, expense: {}, balance: {} };
  const revenue = emptyRevenue();
  const expenses = emptyExpenses();
  const counts = new Map<string, { code: string; name: string; movements: number }>();
  const missing = new Set<string>();

  let localIncome = 0;
  let localExpense = 0;
  let uncategorized = 0;

  for (const entry of entries ?? []) {
    const concept = byId.get(entry.concept_id);
    if (!concept) continue;

    // Lo que cuenta y no es plata sale por otra puerta: ni suma al saldo ni
    // baja a un renglón de dinero del reporte.
    if (concept.counts_only) {
      const row = counts.get(concept.code) ?? {
        code: concept.code,
        name: concept.name,
        movements: 0,
      };
      row.movements += entry.movement_count ?? 0;
      counts.set(concept.code, row);
      continue;
    }

    const amount = Number(entry.amount);
    const expense = concept.kind === 'expense';
    const bucket = expense ? totals.expense : totals.income;

    bucket[entry.currency_code] = (bucket[entry.currency_code] ?? 0) + amount;
    totals.balance[entry.currency_code] =
      (totals.balance[entry.currency_code] ?? 0) + (expense ? -amount : amount);

    const local = convert(amount, entry.currency_code, currency, rates);
    if (local === null) {
      for (const code of missingRateFor(entry.currency_code, currency, rates)) {
        missing.add(code);
      }
      continue;
    }

    if (expense) {
      localExpense += local;
      if (entry.pl_expense_key) expenses[entry.pl_expense_key] += local;
      else uncategorized += 1;
    } else {
      localIncome += local;
      if (concept.pl_revenue_key) revenue[concept.pl_revenue_key] += local;
    }
  }

  for (const key of Object.keys(revenue) as RevenueKey[]) revenue[key] = round(revenue[key]);
  for (const key of Object.keys(expenses) as ExpenseKey[]) expenses[key] = round(expenses[key]);

  const ordered = [...counts.values()].sort((a, b) => a.code.localeCompare(b.code));

  return {
    totals,
    local:
      missing.size > 0
        ? null
        : {
            income: round(localIncome),
            expense: round(localExpense),
            balance: round(localIncome - localExpense),
          },
    revenue,
    expenses,
    counts: ordered,
    participants: ordered.reduce((sum, row) => sum + row.movements, 0),
    missingRates: [...missing].sort(),
    uncategorized,
  };
}
