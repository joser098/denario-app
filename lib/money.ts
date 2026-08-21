const SYMBOLS: Record<string, string> = {
  ARS: '$',
  USD: 'US$',
};

const NUMBER = new Intl.NumberFormat('es-AR', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

/**
 * Formato canonico de todo monto de la app: `$ 426.820 ARS`.
 * El codigo de moneda va siempre, porque ARS y USD conviven en la misma
 * pantalla y el simbolo solo no alcanza para distinguirlos.
 */
export function formatMoney(amount: number, currency: string): string {
  const symbol = SYMBOLS[currency];
  const value = NUMBER.format(amount);
  return symbol ? `${symbol} ${value} ${currency}` : `${value} ${currency}`;
}

/**
 * Numero pelado, sin simbolo ni codigo. Para totales que mezclan monedas:
 * un total en ARS + USD no es un monto en ninguna de las dos, asi que
 * ponerle simbolo mentiria.
 */
export function formatAmount(amount: number): string {
  return NUMBER.format(amount);
}

export function currencySymbol(currency: string): string {
  return SYMBOLS[currency] ?? '';
}

/** Agrupa montos por moneda. Nunca se suman entre si. */
export function sumByCurrency(
  rows: Array<{ currency_code: string; amount?: number; subtotal?: number }>,
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const value = row.amount ?? row.subtotal ?? 0;
    totals[row.currency_code] = (totals[row.currency_code] ?? 0) + Number(value);
  }
  return totals;
}

/** `{ ARS: 426820, USD: 120 }` -> `"$ 426.820 ARS · US$ 120 USD"` */
export function formatTotals(totals: Record<string, number>, separator = ' · '): string {
  const parts = Object.entries(totals)
    .filter(([, amount]) => amount !== 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => formatMoney(amount, currency));
  return parts.length ? parts.join(separator) : formatMoney(0, 'ARS');
}
