'use client';

import { useActionState } from 'react';
import { CountSheet } from '@/components/count-sheet';
import { Alert, Button, Field, Input, Textarea } from '@/components/ui';
import type { Denomination } from '@/lib/count-lines';
import { EMPTY_STATE, type FormState } from '@/lib/forms';

/**
 * El acta en borrador. Dos botones sobre el mismo formulario: guardar sin
 * cerrar (el conteo se interrumpe todo el tiempo) y finalizar, que la vuelve
 * inmutable. El boton apretado viaja como `intent`.
 */
export function CountForm({
  action,
  slug,
  countId,
  denominations,
  quantities,
  defaults,
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  slug: string;
  countId: string;
  denominations: Denomination[];
  quantities: Record<string, number>;
  defaults: {
    volunteer_name: string;
    witness_1_name: string;
    witness_2_name: string;
    envelopes_count: number;
    notes: string;
  };
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="count_id" value={countId} />

      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}

      <fieldset disabled={pending} className="flex flex-col gap-6 border-0 p-0">
        <CountSheet denominations={denominations} initial={quantities} />

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Contó">
            <Input name="volunteer_name" defaultValue={defaults.volunteer_name} required />
          </Field>
          <Field label="Testigo 1">
            <Input name="witness_1_name" defaultValue={defaults.witness_1_name} required />
          </Field>
          <Field label="Testigo 2">
            <Input name="witness_2_name" defaultValue={defaults.witness_2_name} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="Sobres"
            hint="Cuántos sobres había. No suma: la plata de adentro ya está contada arriba."
          >
            <Input
              name="envelopes_count"
              type="number"
              min={0}
              defaultValue={defaults.envelopes_count}
            />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Observaciones">
              <Textarea name="notes" defaultValue={defaults.notes} />
            </Field>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="intent" value="finalize" disabled={pending}>
            {pending ? 'Guardando…' : 'Finalizar acta'}
          </Button>
          <Button type="submit" name="intent" value="save" variant="secondary" disabled={pending}>
            Guardar borrador
          </Button>
        </div>
        <p className="-mt-4 text-xs text-zinc-500">
          Al finalizar, el acta queda cerrada: para corregirla hay que anularla y hacer una nueva.
        </p>
      </fieldset>
    </form>
  );
}
