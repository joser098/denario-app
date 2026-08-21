import { requireOrg } from '@/lib/auth';
import { createCampus, toggleCampus, updateCampus } from '@/lib/actions/settings';
import { createClient } from '@/lib/supabase/server';
import { TIMEZONES, timezoneLabel } from '@/lib/timezones';
import { ActionForm, SubmitButton } from '@/components/form';
import { ModalButton } from '@/components/modal';
import { Badge, Card, Field, Input, Select } from '@/components/ui';

export default async function CampusSettingsPage(
  props: PageProps<'/[slug]/configuracion/campus'>,
) {
  const { slug } = await props.params;
  const { organization } = await requireOrg(slug);

  // Aca listamos tambien los inactivos: desactivar un campus es reversible y
  // el admin tiene que poder volver a prenderlo.
  const supabase = await createClient();
  const { data: campuses } = await supabase
    .from('campuses')
    .select('*')
    .eq('organization_id', organization.id)
    .order('name');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <ModalButton label="Agregar campus" title="Agregar campus">
          <ActionForm action={createCampus} submitLabel="Agregar campus" resetOnSuccess>
            <input type="hidden" name="slug" value={slug} />
            <Field label="Nombre">
              <Input name="name" required placeholder="Campus Norte" />
            </Field>
            <Field label="Moneda">
              <Select name="default_currency" defaultValue={organization.default_currency}>
                <option value="ARS">Peso argentino (ARS)</option>
                <option value="USD">Dólar estadounidense (USD)</option>
              </Select>
            </Field>
            <Field label="Zona horaria" hint="Dejala vacía para usar la de la organización.">
              <Select name="timezone" defaultValue="">
                <option value="">Igual que la organización</option>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {timezoneLabel(tz)}
                  </option>
                ))}
              </Select>
            </Field>
          </ActionForm>
        </ModalButton>
      </div>

      <Card className="divide-y divide-zinc-100">
        {(campuses ?? []).map((campus) => (
          <div key={campus.id} className="flex flex-wrap items-end justify-between gap-4 p-4">
            <ActionForm
              action={updateCampus}
              submitLabel="Guardar"
              submitVariant="secondary"
              fieldsClassName="flex flex-wrap items-end gap-3"
            >
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="id" value={campus.id} />
              <Field label="Nombre">
                <Input name="name" defaultValue={campus.name} className="w-56" required />
              </Field>
              <Field label="Moneda">
                <Select
                  name="default_currency"
                  defaultValue={campus.default_currency}
                  className="w-28"
                >
                  <option value="ARS">ARS</option>
                  <option value="USD">USD</option>
                </Select>
              </Field>
            </ActionForm>

            <div className="flex items-center gap-3">
              {campus.is_active ? null : <Badge tone="neutral">Inactivo</Badge>}
              <form action={toggleCampus}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="id" value={campus.id} />
                <input type="hidden" name="active" value={campus.is_active ? '0' : '1'} />
                <SubmitButton variant="ghost">
                  {campus.is_active ? 'Desactivar' : 'Activar'}
                </SubmitButton>
              </form>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
