import { requireAdminOrg } from '@/lib/auth';
import {
  createMeetingTemplate,
  moveMeetingTemplate,
  toggleMeetingTemplate,
  updateMeetingTemplate,
} from '@/lib/actions/settings';
import { createClient } from '@/lib/supabase/server';
import { formatTime } from '@/lib/dates';
import { ActionForm, SubmitButton } from '@/components/form';
import { ModalButton } from '@/components/modal';
import { MoveButtons } from '@/components/reorder';
import { Badge, Card, EmptyState, Field, Input, Select } from '@/components/ui';

export const metadata = { title: 'Reuniones' };

export default async function MeetingsSettingsPage(
  props: PageProps<'/[slug]/configuracion/reuniones'>,
) {
  const { slug } = await props.params;
  const { organization, campuses } = await requireAdminOrg(slug);

  const supabase = await createClient();
  const { data: templates } = await supabase
    .from('meeting_templates')
    .select('*')
    .eq('organization_id', organization.id)
    .order('sort_order');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-zinc-500">
          Las reuniones que se crean por defecto al abrir un domingo. Cambian con el tiempo:
          editalas cuando cambie el horario o la cantidad.
        </p>
        <ModalButton label="Agregar reunión" title="Agregar reunión">
          <ActionForm action={createMeetingTemplate} submitLabel="Agregar reunión" resetOnSuccess>
            <input type="hidden" name="slug" value={slug} />
            <Field label="Campus">
              <Select name="campus_id" defaultValue={campuses[0]?.id ?? ''} required>
                {campuses.map((campus) => (
                  <option key={campus.id} value={campus.id}>
                    {campus.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Nombre">
              <Input name="label" required placeholder="Reunión 5" />
            </Field>
            <Field label="Horario">
              <Input name="start_time" type="time" required />
            </Field>
          </ActionForm>
        </ModalButton>
      </div>

      {campuses.map((campus) => {
        const rows = (templates ?? []).filter((t) => t.campus_id === campus.id);

        return (
          <section key={campus.id} className="flex flex-col gap-3">
            <h2 className="text-sm font-medium text-zinc-900">{campus.name}</h2>

            {rows.length === 0 ? (
              <EmptyState title="Este campus todavía no tiene reuniones." />
            ) : (
              <Card className="divide-y divide-zinc-100">
                {rows.map((template, index) => (
                  <div
                    key={template.id}
                    className="flex flex-wrap items-end justify-between gap-4 p-4"
                  >
                    <ActionForm
                      action={updateMeetingTemplate}
                      submitLabel="Guardar"
                      submitVariant="secondary"
                      fieldsClassName="flex flex-wrap items-end gap-3"
                    >
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="id" value={template.id} />
                      <Field label="Nombre">
                        <Input
                          name="label"
                          defaultValue={template.label}
                          className="w-48"
                          required
                        />
                      </Field>
                      <Field label="Horario">
                        <Input
                          name="start_time"
                          type="time"
                          defaultValue={formatTime(template.start_time)}
                          className="w-32"
                          required
                        />
                      </Field>
                    </ActionForm>

                    <div className="flex items-center gap-3">
                      <MoveButtons
                        action={moveMeetingTemplate}
                        fields={{ slug, id: template.id, campus_id: campus.id }}
                        first={index === 0}
                        last={index === rows.length - 1}
                      />
                      {template.is_active ? null : <Badge tone="neutral">Inactiva</Badge>}
                      <form action={toggleMeetingTemplate}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="id" value={template.id} />
                        <input
                          type="hidden"
                          name="active"
                          value={template.is_active ? '0' : '1'}
                        />
                        <SubmitButton variant="ghost">
                          {template.is_active ? 'Desactivar' : 'Activar'}
                        </SubmitButton>
                      </form>
                    </div>
                  </div>
                ))}
              </Card>
            )}
          </section>
        );
      })}
    </div>
  );
}
