// Espejo de currencies.symbol. Vive aca porque formatMoney es sincrona y se
// usa tambien del lado del cliente; al agregar una moneda, agregar el simbolo.
// Varios pesos comparten "$" a proposito: el codigo va siempre al lado.
const SYMBOLS: Record<string, string> = {
  ARS: '$',
  USD: 'US$',
  COP: '$',
  BRL: 'R$',
  UYU: '$U',
  MXN: '$',
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

/**
 * Las monedas que se manejan en un campus: la suya y el dolar.
 *
 * El dolar va siempre porque la ofrenda en dolares aparece en cualquier lado
 * y no depende del pais. La local va primero: es la que se cuenta de verdad,
 * y el orden de la planilla del acta sale de aca — alfabetico pondria USD
 * antes que UYU y en Uruguay el acta arrancaria por los dolares.
 *
 * Vive aca y no en lib/currencies.ts porque es pura: no consulta nada, y asi
 * tambien la puede usar un componente cliente.
 */
export function campusCurrencies(defaultCurrency: string): string[] {
  return defaultCurrency === 'USD' ? ['USD'] : [defaultCurrency, 'USD'];
}
