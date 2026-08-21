'use client';

import { useState } from 'react';
import { quantityField, type Denomination } from '@/lib/count-lines';
import { formatAmount, formatMoney } from '@/lib/money';

/**
 * La grilla del conteo: una fila por billete. El total se recalcula mientras
 * se tipea porque el voluntario lo canta en voz alta antes de firmar, y una
 * cuenta que aparece recien despues de guardar no sirve para eso.
 */
export function CountSheet({
  denominations,
  initial = {},
  readOnly = false,
}: {
  denominations: Denomination[];
  /** Cantidades ya guardadas, con clave `ARS:1000`. */
  initial?: Record<string, number>;
  readOnly?: boolean;
}) {
  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initial).map(([key, value]) => [key, String(value)])),
  );

  const currencies = [...new Set(denominations.map((d) => d.currency_code))].sort();

  const subtotal = (currency: string, value: number) => {
    const quantity = Number(quantities[`${currency}:${value}`] ?? 0);
    return Number.isFinite(quantity) && quantity > 0 ? quantity * value : 0;
  };

  return (
    <div className="flex flex-col gap-6">
      {currencies.map((currency) => {
        const rows = denominations
          .filter((d) => d.currency_code === currency)
          .sort((a, b) => Number(b.value) - Number(a.value));

        const total = rows.reduce((sum, row) => sum + subtotal(currency, Number(row.value)), 0);

        return (
          <div key={currency} className="flex flex-col gap-2">
            <div className="grid grid-cols-[1fr_5.5rem_8rem] items-center gap-2 px-1 text-xs font-medium text-zinc-500">
              <span>Billete {currency}</span>
              <span className="text-center">Cantidad</span>
              <span className="text-right">Subtotal</span>
            </div>

            {rows.map((row) => {
              const value = Number(row.value);
              const key = `${currency}:${value}`;
              const line = subtotal(currency, value);

              return (
                <div
                  key={key}
                  className="grid grid-cols-[1fr_5.5rem_8rem] items-center gap-2 rounded-lg px-1 py-0.5 odd:bg-zinc-50"
                >
                  <span className="text-sm font-medium text-zinc-900">
                    {formatMoney(value, currency)}
                  </span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    name={quantityField(currency, value)}
                    value={quantities[key] ?? ''}
                    readOnly={readOnly}
                    onChange={(event) =>
                      setQuantities((prev) => ({ ...prev, [key]: event.target.value }))
                    }
                    className="h-9 w-full rounded-lg border border-zinc-300 bg-white px-2 text-center text-sm tabular-nums focus:border-zinc-900 focus:outline-none read-only:bg-zinc-100"
                  />
                  <span
                    className={`text-right text-sm tabular-nums ${
                      line ? 'text-zinc-900' : 'text-zinc-300'
                    }`}
                  >
                    {formatAmount(line)}
                  </span>
                </div>
              );
            })}

            <div className="grid grid-cols-[1fr_5.5rem_8rem] items-center gap-2 border-t border-zinc-200 px-1 pt-2">
              <span className="text-sm font-medium text-zinc-500">Total {currency}</span>
              <span />
              <span className="text-right text-base font-semibold tabular-nums text-zinc-900">
                {formatMoney(total, currency)}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
