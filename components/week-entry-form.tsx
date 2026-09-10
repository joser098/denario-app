'use client';

import { useActionState, useRef, useState } from 'react';
import { MoneyInput } from '@/components/money-input';
import { Alert, Button, Field, Input, Select } from '@/components/ui';
import { EMPTY_STATE, type FormState } from '@/lib/forms';

export type ConceptOption = {
  id: string;
  name: string;
  kind: 'income' | 'expense';
  allowed_currencies: string[];
  has_movement_count: boolean;
};

/**
 * Alta de un movimiento del periodo. Los campos dependen del concepto
 * elegido: cada uno habilita sus monedas y solo algunos piden ademas cuantos
 * movimientos componen el monto (USD 100 puede ser 4 transacciones de 25).
 */
export function WeekEntryForm({
  action,
  slug,
  weekId,
  concepts,
  range,
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  slug: string;
  weekId: string;
  concepts: ConceptOption[];
  range: { start: string; end: string };
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [conceptId, setConceptId] = useState(concepts[0]?.id ?? '');
  const concept = concepts.find((c) => c.id === conceptId) ?? concepts[0];

  const [state, formAction, pending] = useActionState(
    async (prev: FormState, data: FormData) => {
      const next = await action(prev, data);
      if (!next.error) formRef.current?.reset();
      return next;
    },
    EMPTY_STATE,
  );

  if (!concept) {
    return (
      <Alert tone="info">
        No hay conceptos activos. Definilos en Configuración → Conceptos.
      </Alert>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="flex flex-col gap-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="week_id" value={weekId} />

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}

      <fieldset disabled={pending} className="flex flex-wrap items-end gap-3 border-0 p-0">
        <Field label="Concepto">
          <Select
            name="concept_id"
            value={conceptId}
            onChange={(event) => setConceptId(event.target.value)}
            className="w-56"
          >
            {(['income', 'expense'] as const).map((kind) => {
              const group = concepts.filter((option) => option.kind === kind);
              if (group.length === 0) return null;

              return (
                <optgroup key={kind} label={kind === 'income' ? 'Ingresos' : 'Egresos'}>
                  {group.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </optgroup>
              );
            })}
          </Select>
        </Field>

        <Field label="Moneda">
          {/* key: al cambiar de concepto vuelve a la primera moneda habilitada */}
          <Select key={concept.id} name="currency_code" className="w-28">
            {concept.allowed_currencies.map((currency) => (
              <option key={currency} value={currency}>
                {currency}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Monto"
          hint={concept.kind === 'expense' ? 'Se resta del saldo.' : undefined}
        >
          <MoneyInput name="amount" className="w-36 text-right" required />
        </Field>

        {concept.has_movement_count ? (
          <Field label="Movimientos" hint="Cuántas operaciones componen el monto.">
            <Input name="movement_count" type="number" min={0} className="w-32" />
          </Field>
        ) : null}

        <Field label="Fecha" hint="Opcional, dentro del período.">
          <Input
            name="entry_date"
            type="date"
            min={range.start}
            max={range.end}
            className="w-44"
          />
        </Field>

        <Field label="Detalle">
          <Input name="description" className="w-56" />
        </Field>

        <Button type="submit" disabled={pending}>
          {pending ? 'Guardando…' : 'Cargar'}
        </Button>
      </fieldset>
    </form>
  );
}
