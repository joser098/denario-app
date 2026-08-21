import { redirect } from 'next/navigation';
import { canAdmin, requireOrg, ROLE_LABELS } from '@/lib/auth';
import { inviteMember, removeMember, revokeInvitation, updateMember } from '@/lib/actions/settings';
import { createClient } from '@/lib/supabase/server';
import { formatShort } from '@/lib/dates';
import { siteOrigin } from '@/lib/site';
import { ActionForm, SubmitButton } from '@/components/form';
import { CopyField } from '@/components/copy-field';
import { Badge, Card, EmptyState, Field, Input, PageHeader, Select } from '@/components/ui';

const ASSIGNABLE = ['admin', 'treasurer', 'viewer'] as const;

export default async function UsersPage(props: PageProps<'/[slug]/usuarios'>) {
  const { slug } = await props.params;
  const { organization, campuses, userId, role } = await requireOrg(slug);

  // Quien no administra no gestiona accesos.
  if (!canAdmin(role)) redirect(`/${slug}`);

  const supabase = await createClient();
  const origin = await siteOrigin();

  const [{ data: members }, { data: invitations }] = await Promise.all([
    // El email vive en auth.users: solo se llega por este RPC.
    supabase.rpc('org_members_with_email', { p_org: organization.id }),
    supabase
      .from('invitations')
      .select('*')
      .eq('organization_id', organization.id)
      .is('accepted_at', null)
      .order('created_at', { ascending: false }),
  ]);

  const campusName = (id: string | null) =>
    id ? (campuses.find((c) => c.id === id)?.name ?? 'Campus') : 'Todos los campus';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Usuarios"
        subtitle="Invitá gente a la tesorería y controlá qué puede hacer cada uno."
      />

      {/* ---------- Invitar ---------- */}
      <Card className="p-6">
        <h2 className="mb-1 text-base font-semibold text-navy-900">Invitar usuario</h2>
        <p className="mb-5 text-xs text-zinc-500">
          Se genera un link que vence en 7 días. Copialo y mandáselo vos: la app no manda mails.
        </p>
        <ActionForm
          action={inviteMember}
          submitLabel="Crear invitación"
          resetOnSuccess
          fieldsClassName="grid gap-4 sm:grid-cols-3"
        >
          <input type="hidden" name="slug" value={slug} />
          <Field label="Email">
            <Input name="email" type="email" required placeholder="persona@iglesia.org" />
          </Field>
          <Field label="Rol">
            <Select name="role" defaultValue="treasurer">
              {ASSIGNABLE.map((option) => (
                <option key={option} value={option}>
                  {ROLE_LABELS[option]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Campus">
            <Select name="campus_id" defaultValue="">
              <option value="">Todos los campus</option>
              {campuses.map((campus) => (
                <option key={campus.id} value={campus.id}>
                  {campus.name}
                </option>
              ))}
            </Select>
          </Field>
        </ActionForm>
        <p className="mt-4 text-xs text-zinc-500">
          Tesorero carga plata. Administrador además configura y gestiona usuarios. Solo lectura
          mira.
        </p>
      </Card>

      {/* ---------- Con acceso ---------- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-navy-900">
          Con acceso ({(members ?? []).length})
        </h2>

        <Card className="divide-y divide-zinc-100">
          {(members ?? []).map((member) => {
            const locked = member.role === 'owner' || member.user_id === userId;

            return (
              <div key={member.id} className="flex flex-wrap items-end justify-between gap-4 p-5">
                {locked ? (
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-medium text-navy-900">{member.email}</span>
                    <span className="text-xs text-zinc-500">
                      {ROLE_LABELS[member.role]} · {campusName(member.campus_id)} · desde el{' '}
                      {formatShort(member.created_at.slice(0, 10))}
                    </span>
                  </div>
                ) : (
                  <ActionForm
                    action={updateMember}
                    submitLabel="Guardar"
                    submitVariant="secondary"
                    fieldsClassName="flex flex-wrap items-end gap-3"
                  >
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="id" value={member.id} />
                    <Field
                      label={member.email}
                      hint={`Desde el ${formatShort(member.created_at.slice(0, 10))}`}
                    >
                      <Select name="role" defaultValue={member.role} className="w-44">
                        {ASSIGNABLE.map((option) => (
                          <option key={option} value={option}>
                            {ROLE_LABELS[option]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Campus">
                      <Select
                        name="campus_id"
                        defaultValue={member.campus_id ?? ''}
                        className="w-52"
                      >
                        <option value="">Todos los campus</option>
                        {campuses.map((campus) => (
                          <option key={campus.id} value={campus.id}>
                            {campus.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </ActionForm>
                )}

                <div className="flex items-center gap-3">
                  {member.role === 'owner' ? <Badge tone="blue">Dueño</Badge> : null}
                  {member.user_id === userId ? <Badge tone="neutral">Vos</Badge> : null}
                  {locked ? null : (
                    <form action={removeMember}>
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="id" value={member.id} />
                      <SubmitButton
                        variant="ghost"
                        confirm={`¿Quitarle el acceso a ${member.email}?`}
                      >
                        Quitar acceso
                      </SubmitButton>
                    </form>
                  )}
                </div>
              </div>
            );
          })}
        </Card>
      </section>

      {/* ---------- Invitaciones ---------- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-navy-900">Invitaciones pendientes</h2>
        {(invitations ?? []).length === 0 ? (
          <EmptyState title="No hay invitaciones pendientes." />
        ) : (
          <Card className="divide-y divide-zinc-100">
            {(invitations ?? []).map((invitation) => (
              <div key={invitation.id} className="flex flex-col gap-2 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-navy-900">{invitation.email}</p>
                    <p className="text-xs text-zinc-500">
                      {ROLE_LABELS[invitation.role]} · {campusName(invitation.campus_id)} · vence
                      el {formatShort(invitation.expires_at.slice(0, 10))}
                    </p>
                  </div>
                  <form action={revokeInvitation}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="id" value={invitation.id} />
                    <SubmitButton variant="ghost">Anular</SubmitButton>
                  </form>
                </div>
                <CopyField value={`${origin}/invitacion/${invitation.token}`} />
              </div>
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}
