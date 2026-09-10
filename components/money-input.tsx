'use client';

import { useState, type ComponentProps } from 'react';
import { formatAmountInput, toAmountInput } from '@/lib/money';
import { Input } from '@/components/ui';

/**
 * Un campo de plata que se agrupa mientras se escribe.
 *
 * Lo que viaja en el formulario es el texto formateado ("1.000.000"), que es
 * lo que `parseAmount` sabe leer del otro lado. `onValueChange` es para los
 * formularios que ademas calculan totales en vivo.
 *
 * `allowNegative` deja escribir un menos adelante. Va apagado por defecto
 * porque casi toda la plata del sistema es una cantidad y no un saldo: una
 * ofrenda en negativo no significa nada, y la base la rechazaria.
 */
export function MoneyInput({
  defaultValue,
  onValueChange,
  allowNegative = false,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'defaultValue'> & {
  defaultValue?: number | string | null;
  onValueChange?: (value: string) => void;
  allowNegative?: boolean;
  compact?: boolean;
}) {
  const [value, setValue] = useState(() => toAmountInput(defaultValue));

  return (
    <Input
      {...props}
      // decimal y no numeric: en el teléfono tiene que aparecer la coma.
      inputMode="decimal"
      autoComplete="off"
      value={value}
      onChange={(event) => {
        const next = formatAmountInput(event.target.value, { negative: allowNegative });
        setValue(next);
        onValueChange?.(next);
      }}
    />
  );
}
