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
 */
export function MoneyInput({
  defaultValue,
  onValueChange,
  ...props
}: Omit<ComponentProps<'input'>, 'value' | 'onChange' | 'defaultValue'> & {
  defaultValue?: number | string | null;
  onValueChange?: (value: string) => void;
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
        const next = formatAmountInput(event.target.value);
        setValue(next);
        onValueChange?.(next);
      }}
    />
  );
}
