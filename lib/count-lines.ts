import type { Totals } from '@/lib/sundays';

/**
 * Las cantidades del acta viajan como campos sueltos del formulario, uno por
 * denominacion: `qty:ARS:1000`. Asi el conteo funciona como un form HTML de
 * toda la vida, sin JSON escondido en un input.
 */
export type CountLineInput = {
  currency_code: string;
  denomination_value: number;
  quantity: number;
};

export type Denomination = { currency_code: string; value: number };

const PREFIX = 'qty';

export function quantityField(currency: string, value: number | string): string {
  return `${PREFIX}:${currency}:${value}`;
}

/**
 * Lee las cantidades del formulario y descarta lo que no corresponde:
 * ceros, texto y denominaciones que no existen en el catalogo (nadie deberia
 * poder inventar un billete de $ 12.345 mandando un POST a mano).
 */
export function parseCountLines(
  formData: FormData,
  allowed: Denomination[],
): CountLineInput[] {
  const valid = new Set(allowed.map((d) => `${d.currency_code}:${Number(d.value)}`));
  const lines: CountLineInput[] = [];

  for (const [key, raw] of formData.entries()) {
    const [prefix, currency, denomination] = key.split(':');
    if (prefix !== PREFIX || !currency || !denomination) continue;

    const value = Number(denomination);
    if (!valid.has(`${currency}:${value}`)) continue;

    const quantity = Math.trunc(Number(String(raw).trim() || 0));
    if (!Number.isFinite(quantity) || quantity <= 0) continue;

    lines.push({ currency_code: currency, denomination_value: value, quantity });
  }

  return lines;
}

export function linesTotal(lines: CountLineInput[]): Totals {
  const totals: Totals = {};
  for (const line of lines) {
    totals[line.currency_code] =
      (totals[line.currency_code] ?? 0) + line.denomination_value * line.quantity;
  }
  return totals;
}
