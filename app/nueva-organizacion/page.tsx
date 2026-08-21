import Link from 'next/link';
import { createOrganization } from '@/lib/actions/organizations';
import { listOrganizations, requireUser } from '@/lib/auth';
import { ActionForm } from '@/components/form';
import { Field, Input, Select } from '@/components/ui';
import { TIMEZONES, timezoneLabel } from '@/lib/timezones';

export const metadata = { title: 'Nueva organización · Denario' };

export default async function NewOrganizationPage() {
  await requireUser();
  const existing = await listOrganizations();

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
                <option value="ARS">Peso argentino (ARS)</option>
                <option value="USD">Dólar estadounidense (USD)</option>
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
