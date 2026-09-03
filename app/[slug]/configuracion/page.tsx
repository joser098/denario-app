import Image from 'next/image';
import { requireOrg } from '@/lib/auth';
import {
  removeOrganizationLogo,
  updateOrganization,
  updateOrganizationLogo,
} from '@/lib/actions/settings';
import { createClient } from '@/lib/supabase/server';
import { listCurrencies } from '@/lib/currencies';
import { logoUrl } from '@/lib/logo';
import { TIMEZONES, timezoneLabel } from '@/lib/timezones';
import { ActionForm, SubmitButton } from '@/components/form';
import { Card, CurrencyOptions, Field, Input, Select } from '@/components/ui';

export const metadata = { title: 'Organización' };

export default async function OrganizationSettingsPage(
  props: PageProps<'/[slug]/configuracion'>,
) {
  const { slug } = await props.params;
  const { organization } = await requireOrg(slug);
  const currencies = await listCurrencies(await createClient());
  const logo = logoUrl(organization.logo_path);

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <Card className="p-6">
        <h2 className="mb-4 text-base font-semibold text-navy-900">Datos de la organización</h2>
        <ActionForm action={updateOrganization} submitLabel="Guardar cambios">
          <input type="hidden" name="slug" value={slug} />

          <Field label="Nombre">
            <Input name="name" defaultValue={organization.name} required />
          </Field>

          <Field
            label="Identificador"
            hint={`La dirección de la app: /${organization.slug}. Si lo cambiás, los links viejos dejan de funcionar.`}
          >
            <Input name="new_slug" defaultValue={organization.slug} required />
          </Field>

          <Field
            label="Zona horaria"
            hint="Define qué día es “hoy” para los domingos y las semanas."
          >
            <Select name="timezone" defaultValue={organization.timezone}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {timezoneLabel(tz)}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Moneda principal">
            <Select name="default_currency" defaultValue={organization.default_currency}>
              <CurrencyOptions currencies={currencies} long />
            </Select>
          </Field>
        </ActionForm>
      </Card>

      <Card className="p-6">
        <h2 className="mb-1 text-base font-semibold text-navy-900">Logo</h2>
        <p className="mb-5 text-xs text-zinc-500">
          Se muestra en la barra lateral y se estampa en las actas y los cierres en PDF. PNG o
          JPG, hasta 2 MB.
        </p>

        <div className="mb-5 flex items-center gap-4">
          <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50">
            {logo ? (
              <Image
                src={logo}
                alt={`Logo de ${organization.name}`}
                width={80}
                height={80}
                className="size-20 object-contain"
              />
            ) : (
              <span className="text-xs text-zinc-500">Sin logo</span>
            )}
          </div>

          {organization.logo_path ? (
            <form action={removeOrganizationLogo}>
              <input type="hidden" name="slug" value={slug} />
              <SubmitButton variant="ghost">Quitar logo</SubmitButton>
            </form>
          ) : null}
        </div>

        <ActionForm action={updateOrganizationLogo} submitLabel="Subir logo">
          <input type="hidden" name="slug" value={slug} />
          <Field label="Archivo">
            <input
              type="file"
              name="logo"
              accept="image/png,image/jpeg"
              required
              className="w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-600 hover:file:bg-brand-100"
            />
          </Field>
        </ActionForm>
      </Card>
    </div>
  );
}
