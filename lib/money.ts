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

/**
 * "US$ 11.021,75" — con simbolo, sin el codigo al final.
 *
 * Solo para documentos donde la moneda esta dicha una vez y no cambia: en un
 * cuadro entero en dolares, repetir "USD" en cada celda es ruido. En la app,
 * donde ARS y USD conviven en la misma pantalla, va `formatMoney`.
 */
export function formatAmountWithSymbol(amount: number, currency: string): string {
  const symbol = SYMBOLS[currency];
  return symbol ? `${symbol} ${NUMBER.format(amount)}` : `${NUMBER.format(amount)} ${currency}`;
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

// ============================================================
// Montos que se tipean
// ============================================================

/**
 * Lo que se va tipeando, agrupado: "1000000" -> "1.000.000".
 *
 * Un monto largo sin separadores hay que contarlo con el dedo para saber si
 * son cien mil o un millon, y en una planilla de tesoreria ese error se paga
 * caro. Se formatea mientras se escribe, no al salir del campo, porque el
 * punto de agruparlo es leerlo mientras se carga.
 *
 * Formato es-AR: el punto agrupa miles y la coma separa decimales. Solo deja
 * pasar digitos y una coma, asi que no hay forma de tipear algo que despues
 * `parseAmount` lea distinto.
 */
export function formatAmountInput(raw: string): string {
  const limpio = raw.replace(/[^\d,]/g, '');
  const [entero = '', ...resto] = limpio.split(',');
  const agrupado = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  if (resto.length === 0) return agrupado;
  // Una sola coma, dos decimales: es plata.
  return `${agrupado},${resto.join('').slice(0, 2)}`;
}

/** Un numero del modelo, listo para editar: 1000.5 -> "1.000,5". */
export function toAmountInput(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const numero = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numero) || numero === 0) return '';
  return formatAmountInput(NUMBER.format(numero));
}

/**
 * "1.234,50" -> 1234.5. La contracara exacta de `formatAmountInput`.
 *
 * Vive aca y no en cada archivo de acciones porque estaba copiada en siete
 * lugares y dos de esas copias no sacaban los puntos: con separadores de
 * miles, "1.000" les daba 1.
 */
export function parseAmount(value: FormDataEntryValue | string | null): number {
  return Number(String(value ?? '').replace(/\./g, '').replace(',', '.'));
}
