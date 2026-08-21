import { requireOrg } from '@/lib/auth';
import { createTeam, moveTeam, toggleTeam, updateTeam } from '@/lib/actions/settings';
import { createClient } from '@/lib/supabase/server';
import { ActionForm, SubmitButton } from '@/components/form';
import { ModalButton } from '@/components/modal';
import { MoveButtons } from '@/components/reorder';
import { Badge, Card, EmptyState, Field, Input } from '@/components/ui';

export default async function TeamsSettingsPage(
  props: PageProps<'/[slug]/configuracion/equipos'>,
) {
  const { slug } = await props.params;
  const { organization } = await requireOrg(slug);

  const supabase = await createClient();
  const { data: teams } = await supabase
    .from('teams')
    .select('*')
    .eq('organization_id', organization.id)
    .order('sort_order');

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="max-w-2xl text-sm text-zinc-500">
          Los ministerios o áreas que hacen pedidos de compra. Quien carga una solicitud desde el
          link público elige uno de estos.
        </p>
        <ModalButton label="Agregar equipo" title="Agregar equipo">
          <ActionForm action={createTeam} submitLabel="Agregar equipo" resetOnSuccess>
            <input type="hidden" name="slug" value={slug} />
            <Field label="Equipo">
              <Input name="name" required placeholder="Alabanza" autoFocus />
            </Field>
          </ActionForm>
        </ModalButton>
      </div>

      {(teams ?? []).length === 0 ? (
        <EmptyState title="Todavía no cargaste equipos." />
      ) : (
        <Card className="divide-y divide-zinc-100">
          {(teams ?? []).map((team, index) => (
            <div key={team.id} className="flex flex-wrap items-end justify-between gap-4 p-4">
              <ActionForm
                action={updateTeam}
                submitLabel="Guardar"
                submitVariant="secondary"
                fieldsClassName="flex flex-wrap items-end gap-3"
              >
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="id" value={team.id} />
                <Field label="Equipo">
                  <Input name="name" defaultValue={team.name} className="w-64" required />
                </Field>
              </ActionForm>

              <div className="flex items-center gap-3">
                <MoveButtons
                  action={moveTeam}
                  fields={{ slug, id: team.id }}
                  first={index === 0}
                  last={index === (teams ?? []).length - 1}
                />
                {team.is_active ? null : <Badge tone="neutral">Inactivo</Badge>}
                <form action={toggleTeam}>
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="id" value={team.id} />
                  <input type="hidden" name="active" value={team.is_active ? '0' : '1'} />
                  <SubmitButton variant="ghost">
                    {team.is_active ? 'Desactivar' : 'Activar'}
                  </SubmitButton>
                </form>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
