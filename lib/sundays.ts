import type { MeetingAmount } from '@/lib/database.types';

/** Montos por moneda. Nunca se suman entre si. */
export type Totals = Record<string, number>;

/** Total del grupo, mas el desglose por medio de pago. */
export type Breakdown = {
  total: Totals;
  byMethod: Record<string, Totals>;
};

export type AmountSummary = {
  /** Efectivo contado en las actas finalizadas. Solo ofrenda. */
  offering: Totals;
  /** Ventas de productos, con su desglose por medio de pago. */
  sales: Breakdown;
  /** Ingresos digitales cargados aparte. */
  incomes: Breakdown;
  /**
   * Todo lo que entro: ofrenda + ventas + ingresos.
   *
   * La ofrenda y las ventas son plata distinta y se cuentan por separado.
   * Lo cobrado por ventas en efectivo NO esta dentro del acta de conteo:
   * el acta cuenta la ofrenda y nada mas.
   */
  total: Totals;
};

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  mercadopago: 'MercadoPago',
};

export function methodLabel(method: string | null): string {
  return method ? (PAYMENT_METHOD_LABELS[method] ?? method) : '';
}

function add(totals: Totals, currency: string, amount: number) {
  totals[currency] = (totals[currency] ?? 0) + Number(amount);
}

function addTo(group: Breakdown, method: string | null, currency: string, amount: number) {
  add(group.total, currency, amount);
  const key = method ?? 'otro';
  group.byMethod[key] = group.byMethod[key] ?? {};
  add(group.byMethod[key], currency, amount);
}

export function summarize(rows: MeetingAmount[] | null | undefined): AmountSummary {
  const summary: AmountSummary = {
    offering: {},
    sales: { total: {}, byMethod: {} },
    incomes: { total: {}, byMethod: {} },
    total: {},
  };

  for (const row of rows ?? []) {
    const amount = Number(row.amount);
    add(summary.total, row.currency_code, amount);

    switch (row.kind) {
      case 'offering':
        add(summary.offering, row.currency_code, amount);
        break;
      case 'sale':
        addTo(summary.sales, row.method, row.currency_code, amount);
        break;
      case 'income':
        addTo(summary.incomes, row.method, row.currency_code, amount);
        break;
    }
  }

  return summary;
}

export function isEmpty(totals: Totals): boolean {
  return Object.values(totals).every((amount) => !amount);
}

/** Los medios usados, en orden estable, para pintar el desglose. */
export function methodsOf(group: Breakdown): string[] {
  return Object.keys(group.byMethod)
    .filter((method) => !isEmpty(group.byMethod[method]))
    .sort();
}

export const COUNT_STATUS_LABELS = {
  draft: 'Borrador',
  finalized: 'Finalizada',
  voided: 'Anulada',
} as const;
