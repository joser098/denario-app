import { requireOrg } from '@/lib/auth';
import {
  createWeekConcept,
  moveWeekConcept,
  toggleWeekConcept,
  updateWeekConcept,
} from '@/lib/actions/settings';
import { createClient } from '@/lib/supabase/server';
import { listCurrencyCodes } from '@/lib/currencies';
import { ActionForm, SubmitButton } from '@/components/form';
import { ModalButton } from '@/components/modal';
import { MoveButtons } from '@/components/reorder';
import { Badge, Card, Field, Input, Select } from '@/components/ui';
import { CONCEPT_KIND_LABELS } from '@/lib/weeks';

function CurrencyChecks({ selected, codes }: { selected: string[]; codes: string[] }) {
  return (
    <fieldset className="flex flex-col gap-1.5 border-0 p-0">
      <legend className="text-sm font-medium text-zinc-700">Monedas</legend>
      <div className="flex h-10 items-center gap-4">
        {codes.map((code) => (
          <label key={code} className="flex items-center gap-1.5 text-sm text-zinc-700">
            <input
              type="checkbox"
              name="currencies"
              value={code}
              defaultChecked={selected.includes(code)}
              className="size-4 rounded border-zinc-300"
            />
            {code}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default async function ConceptsSettingsPage(
  props: PageProps<'/[slug]/configuracion/conceptos'>,
) {
  const { slug } = await props.params;
  const { organization } = await requireOrg(slug);

  const supabase = await createClient();
  const codes = await listCurrencyCodes(supabase);
  const { data: concepts } = await supabase
    .from('week_concepts')
    .select('*')
    .eq('organization_id', organization.id)
    .order('sort_order');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-zinc-500">
          Las categorías del módulo Semanal. El código y el tipo no se pueden cambiar: el código
          identifica al concepto en los registros ya cargados, y cambiar el tipo daría vuelta el
          signo de todo lo cargado con él.
        </p>
        <ModalButton label="Agregar concepto" title="Agregar concepto">
          <ActionForm action={createWeekConcept} submitLabel="Agregar concepto" resetOnSuccess>
            <input type="hidden" name="slug" value={slug} />
            <Field label="Concepto">
              <Input name="name" required placeholder="Donaciones especiales" autoFocus />
            </Field>
            <Field label="Tipo" hint="No se puede cambiar después.">
              <Select name="kind" defaultValue="income">
                <option value="income">Ingreso — suma al saldo</option>
                <option value="expense">Egreso — resta del saldo</option>
              </Select>
            </Field>
            <CurrencyChecks codes={codes} selected={['ARS']} />
            <label className="flex items-center gap-2 text-sm text-zinc-700">
              <input
                type="checkbox"
                name="has_movement_count"
                className="size-4 rounded border-zinc-300"
              />
              Registrar también cuántos movimientos componen el monto
            </label>
          </ActionForm>
        </ModalButton>
      </div>

      <Card className="divide-y divide-zinc-100">
        {(concepts ?? []).map((concept, index) => (
          <div key={concept.id} className="flex flex-wrap items-end justify-between gap-4 p-4">
            <ActionForm
              action={updateWeekConcept}
              submitLabel="Guardar"
              submitVariant="secondary"
              fieldsClassName="flex flex-wrap items-end gap-4"
            >
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="id" value={concept.id} />
              <Field label="Concepto" hint={concept.code}>
                <Input name="name" defaultValue={concept.name} className="w-52" required />
              </Field>
              <CurrencyChecks codes={codes} selected={concept.allowed_currencies} />
              <label className="flex h-10 items-center gap-2 text-sm text-zinc-700">
                <input
                  type="checkbox"
                  name="has_movement_count"
                  defaultChecked={concept.has_movement_count}
                  className="size-4 rounded border-zinc-300"
                />
                Cuenta movimientos
              </label>
            </ActionForm>

            <div className="flex items-center gap-3">
              <Badge tone={concept.kind === 'expense' ? 'red' : 'blue'}>
                {CONCEPT_KIND_LABELS[concept.kind]}
              </Badge>
              <MoveButtons
                action={moveWeekConcept}
                fields={{ slug, id: concept.id }}
                first={index === 0}
                last={index === (concepts ?? []).length - 1}
              />
              {concept.is_active ? null : <Badge tone="neutral">Inactivo</Badge>}
              <form action={toggleWeekConcept}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="id" value={concept.id} />
                <input type="hidden" name="active" value={concept.is_active ? '0' : '1'} />
                <SubmitButton variant="ghost">
                  {concept.is_active ? 'Desactivar' : 'Activar'}
                </SubmitButton>
              </form>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
