import type { Totals } from '@/lib/sundays';
import type { WeekConceptKind } from '@/lib/database.types';

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
