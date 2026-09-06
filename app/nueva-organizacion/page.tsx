import Link from 'next/link';
import { createOrganization } from '@/lib/actions/organizations';
import { listOrganizations, requireUser, ROLE_LABELS } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { listCurrencies } from '@/lib/currencies';
import { ActionForm } from '@/components/form';
import { Alert, CurrencyOptions, Field, Input, Select } from '@/components/ui';
import { TIMEZONES, timezoneLabel } from '@/lib/timezones';

export const metadata = { title: 'Nueva organización' };

export default async function NewOrganizationPage() {
  await requireUser();
  const supabase = await createClient();
  const [existing, currencies, { data: pending }] = await Promise.all([
    listOrganizations(),
    listCurrencies(supabase),
    supabase.rpc('my_pending_invitations'),
  ]);
  const invitations = pending ?? [];

  return (
    <div className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">
            Crear la organización
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Es la iglesia. Después podés agregar campus, reuniones y personas.
          </p>
        </div>

        {/* A quien lo invitaron y todavia no acepto, esta pantalla lo dejaba
            sin salida: le ofrecia crear una iglesia cuando lo esperan en una. */}
        {invitations.length > 0 ? (
          <div className="mb-6 flex flex-col gap-3">
            <Alert tone="info">
              {invitations.length === 1
                ? 'Tenés una invitación sin aceptar.'
                : `Tenés ${invitations.length} invitaciones sin aceptar.`}
            </Alert>
            <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 bg-white shadow-sm">
              {invitations.map((invitation) => (
                <Link
                  key={invitation.token}
                  href={`/invitacion/${invitation.token}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-zinc-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-zinc-900">
                      {invitation.organization_name}
                    </span>
                    <span className="block text-sm text-zinc-500">
                      {ROLE_LABELS[invitation.role]}
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-zinc-500">
                    →
                  </span>
                </Link>
              ))}
            </div>
            <p className="text-center text-sm text-zinc-500">
              O creá una organización nueva acá abajo.
            </p>
          </div>
        ) : null}

        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <ActionForm action={createOrganization} submitLabel="Crear organización">
            <Field label="Nombre">
              <Input name="name" required autoFocus placeholder="Iglesia Central" />
            </Field>
            <Field
              label="Identificador"
              hint="Se usa en la dirección de la app. Si lo dejás vacío lo armamos con el nombre."
            >
              <Input name="slug" placeholder="iglesia-central" />
            </Field>
            <Field label="Zona horaria">
              <Select name="timezone" defaultValue={TIMEZONES[0]}>
                {TIMEZONES.map((tz) => (
                  <option key={tz} value={tz}>
                    {timezoneLabel(tz)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Moneda principal">
              <Select name="currency" defaultValue="ARS">
                <CurrencyOptions currencies={currencies} long />
              </Select>
            </Field>
          </ActionForm>
        </div>

        {existing.length > 0 ? (
          <p className="mt-6 text-center text-sm">
            <Link href="/" className="text-zinc-500 hover:text-zinc-900">
              Volver a mis organizaciones
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
