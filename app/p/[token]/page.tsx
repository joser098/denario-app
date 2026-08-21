import Link from 'next/link';
import type { ReactNode } from 'react';
import { submitBudgetRequest, submitPurchaseRequest } from '@/lib/actions/public-requests';
import { createAdminClient } from '@/lib/supabase/admin';
import { ActionForm } from '@/components/form';
import { ItemRows } from '@/components/item-rows';
import { Alert, Card, Field, Input, Select, Textarea } from '@/components/ui';

export const metadata = { title: 'Pedido a tesorería · Denario' };

/**
 * Formulario público de solicitudes. Lo usa el encargado de un ministerio,
 * sin cuenta: tener el link de la iglesia es la autorización.
 */
export default async function PublicRequestPage(props: PageProps<'/p/[token]'>) {
  const { token } = await props.params;
  const { tipo } = await props.searchParams;
  const budget = tipo === 'presupuesto';

  const supabase = createAdminClient();
  const { data: organization } = await supabase
    .from('organizations')
    .select('id, name, default_currency')
    .eq('public_request_token', token)
    .eq('is_active', true)
    .maybeSingle();

  if (!organization) {
    return (
      <Shell>
        <Alert tone="error">Este link no corresponde a ninguna iglesia.</Alert>
      </Shell>
    );
  }

  const { data: teams } = await supabase
    .from('teams')
    .select('id, name')
    .eq('organization_id', organization.id)
    .eq('is_active', true)
    .order('sort_order');

  const contact = (
    <>
      <Field label="Tu nombre">
        <Input name="requester_name" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" hint="Opcional.">
          <Input name="requester_email" type="email" />
        </Field>
        <Field label="Teléfono" hint="Opcional.">
          <Input name="requester_phone" />
        </Field>
      </div>
    </>
  );

  const currency = (
    <Field label="Moneda">
      <Select name="estimated_currency" defaultValue={organization.default_currency}>
        <option value="ARS">ARS</option>
        <option value="USD">USD</option>
      </Select>
    </Field>
  );

  return (
    <Shell>
      <header className="text-center">
        <p className="text-lg font-semibold tracking-tight text-navy-900">{organization.name}</p>
        <p className="text-sm text-zinc-500">Pedido a tesorería</p>
      </header>

      <div className="flex gap-1 rounded-xl border border-zinc-200 bg-white p-1">
        <Tab href={`/p/${token}`} active={!budget}>
          Compra
        </Tab>
        <Tab href={`/p/${token}?tipo=presupuesto`} active={budget}>
          Presupuesto
        </Tab>
      </div>

      {(teams ?? []).length === 0 && !budget ? (
        <Alert tone="info">
          La iglesia todavía no cargó equipos. Avisale a la tesorería antes de pedir una compra.
        </Alert>
      ) : (
        <Card className="p-6">
          {budget ? (
            <>
              <h1 className="mb-1 text-base font-semibold text-navy-900">Pedir un presupuesto</h1>
              <p className="mb-5 text-xs text-zinc-500">
                Para un gasto puntual que no es una compra de rutina. Si tenés una cotización,
                adjuntala.
              </p>
              <ActionForm action={submitBudgetRequest} submitLabel="Enviar pedido">
                <input type="hidden" name="org_token" value={token} />
                {contact}
                <Field label="Equipo" hint="Opcional.">
                  <Select name="team_id" defaultValue="">
                    <option value="">Sin equipo</option>
                    {(teams ?? []).map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Para qué es">
                  <Textarea name="description" required placeholder="Arreglo del aire del salón." />
                </Field>
                <Field label="Monto estimado">
                  <Input name="estimated_amount" inputMode="decimal" required />
                </Field>
                {currency}
                <Field label="Cotización" hint="Opcional. PDF, PNG o JPG.">
                  <input
                    type="file"
                    name="file"
                    accept="application/pdf,image/png,image/jpeg"
                    className="w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-600 hover:file:bg-brand-100"
                  />
                </Field>
              </ActionForm>
            </>
          ) : (
            <>
              <h1 className="mb-1 text-base font-semibold text-navy-900">Pedir una compra</h1>
              <p className="mb-5 text-xs text-zinc-500">
                Lo que necesita tu equipo. La tesorería lo aprueba y después carga cuánto salió.
              </p>
              <ActionForm action={submitPurchaseRequest} submitLabel="Enviar pedido">
                <input type="hidden" name="org_token" value={token} />
                {contact}
                <Field label="Equipo">
                  <Select name="team_id" required>
                    {(teams ?? []).map((team) => (
                      <option key={team.id} value={team.id}>
                        {team.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <ItemRows />
                <Field label="Monto estimado" hint="Opcional, si tenés una idea.">
                  <Input name="estimated_amount" inputMode="decimal" />
                </Field>
                {currency}
              </ActionForm>
            </>
          )}
        </Card>
      )}
    </Shell>
  );
}

function Tab({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      className={`flex-1 rounded-lg px-4 py-2 text-center text-sm font-medium transition-colors ${
        active ? 'bg-brand-500 text-white' : 'text-zinc-600 hover:bg-zinc-50'
      }`}
    >
      {children}
    </Link>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 justify-center px-4 py-10">
      <div className="flex w-full max-w-lg flex-col gap-6">
        {children}
        <p className="text-center text-xs text-zinc-400">Denario</p>
      </div>
    </div>
  );
}
