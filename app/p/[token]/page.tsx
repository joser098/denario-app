import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  submitBudget,
  submitPaymentRequest,
  submitPurchaseRequest,
} from '@/lib/actions/public-requests';
import { createAdminClient } from '@/lib/supabase/admin';
import { campusCurrencies, listCurrencies } from '@/lib/currencies';
import { ActionForm } from '@/components/form';
import { ItemRows } from '@/components/item-rows';
import { MoneyInput } from '@/components/money-input';
import { Alert, Card, CurrencyOptions, Field, Input, Select, Textarea } from '@/components/ui';

export const metadata = { title: 'Pedido a tesorería · Denario' };

const KINDS = ['compra', 'presupuesto', 'pago'] as const;
type Kind = (typeof KINDS)[number];

function kindOf(value: unknown): Kind {
  return KINDS.includes(value as Kind) ? (value as Kind) : 'compra';
}

/**
 * Formulario público de solicitudes. Lo usa el encargado de un ministerio,
 * sin cuenta: tener el link es la autorización.
 *
 * El link es de un campus, no de la iglesia: el campus sale del token y no
 * se pregunta, así que un pedido no puede caer en el campus equivocado.
 */
export default async function PublicRequestPage(props: PageProps<'/p/[token]'>) {
  const { token } = await props.params;
  const { tipo } = await props.searchParams;
  const kind = kindOf(tipo);

  const supabase = createAdminClient();
  const { data: campus } = await supabase
    .from('campuses')
    .select('id, name, organization_id, default_currency, organizations!inner(name, is_active)')
    .eq('public_request_token', token)
    .eq('is_active', true)
    .maybeSingle();

  const organization = campus
    ? (campus.organizations as unknown as { name: string; is_active: boolean })
    : null;

  if (!campus || !organization?.is_active) {
    return (
      <Shell>
        <Alert tone="error">Este link no corresponde a ningún campus.</Alert>
      </Shell>
    );
  }

  // El campus tiene que resolverse primero porque todo lo demas cuelga de el,
  // pero el catalogo y los equipos no dependen entre si: van juntos.
  const [catalog, { data: teams }] = await Promise.all([
    listCurrencies(supabase),
    supabase
      .from('teams')
      .select('id, name')
      .eq('organization_id', campus.organization_id)
      .eq('is_active', true)
      .order('sort_order'),
  ]);

  // Solo lo que maneja este campus: pedir plata en una moneda que la
  // tesoreria de ese campus no usa no le sirve a nadie.
  const codes = campusCurrencies(campus.default_currency);
  const currencies = codes
    .map((code) => catalog.find((c) => c.code === code))
    .filter((c) => c !== undefined);

  const contact = (
    <>
      {/* autoComplete deja que el telefono ofrezca los datos que ya tiene:
          es WCAG 1.3.5 y, en la practica, la diferencia entre tipear tres
          campos en un celular y tocar una sugerencia. */}
      <Field label="Tu nombre">
        <Input name="requester_name" autoComplete="name" required />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Email" hint="Opcional.">
          <Input name="requester_email" type="email" autoComplete="email" />
        </Field>
        <Field label="Teléfono" hint="Opcional.">
          <Input name="requester_phone" type="tel" autoComplete="tel" />
        </Field>
      </div>
    </>
  );

  const currency = (
    <Field label="Moneda">
      <Select name="estimated_currency" defaultValue={codes[0]}>
        <CurrencyOptions currencies={currencies} />
      </Select>
    </Field>
  );

  const optionalTeam = (
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
  );

  const quote = (label: string) => (
    <Field label={label} hint="Opcional. PDF, PNG o JPG.">
      <input
        type="file"
        name="file"
        accept="application/pdf,image/png,image/jpeg"
        className="w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-600 hover:file:bg-brand-100"
      />
    </Field>
  );

  return (
    <Shell>
      <header className="text-center">
        <p className="text-lg font-semibold tracking-tight text-navy-900">{organization.name}</p>
        <p className="text-sm text-zinc-500">{campus.name} · Pedido a tesorería</p>
      </header>

      <div className="flex gap-1 rounded-xl border border-zinc-200 bg-white p-1">
        <Tab href={`/p/${token}`} active={kind === 'compra'}>
          Compra
        </Tab>
        <Tab href={`/p/${token}?tipo=presupuesto`} active={kind === 'presupuesto'}>
          Presupuesto
        </Tab>
        <Tab href={`/p/${token}?tipo=pago`} active={kind === 'pago'}>
          Pago
        </Tab>
      </div>

      {kind === 'compra' && (teams ?? []).length === 0 ? (
        <Alert tone="info">
          La iglesia todavía no cargó equipos. Avisale a la tesorería antes de pedir una compra.
        </Alert>
      ) : (
        <Card className="p-6">
          {kind === 'presupuesto' ? (
            <>
              <h1 className="mb-1 text-base font-semibold text-navy-900">Presentar un presupuesto</h1>
              <p className="mb-5 text-xs text-zinc-500">
                Queda archivado en la tesorería como documentación. No es un pedido de plata: si
                hay que pagarlo, la tesorería lo decide después.
              </p>
              <ActionForm action={submitBudget} submitLabel="Enviar presupuesto">
                <input type="hidden" name="campus_token" value={token} />
                {contact}
                {optionalTeam}
                <Field label="De qué es">
                  <Textarea name="description" required placeholder="Arreglo del aire del salón." />
                </Field>
                <Field label="Monto presupuestado">
                  <MoneyInput name="estimated_amount" required />
                </Field>
                {currency}
                {quote('Presupuesto')}
              </ActionForm>
            </>
          ) : kind === 'pago' ? (
            <>
              <h1 className="mb-1 text-base font-semibold text-navy-900">
                Pedir un pago o transferencia
              </h1>
              <p className="mb-5 text-xs text-zinc-500">
                Para plata que hay que pagar o transferir. La tesorería lo aprueba y lo paga, o lo
                rechaza.
              </p>
              <ActionForm action={submitPaymentRequest} submitLabel="Enviar pedido">
                <input type="hidden" name="campus_token" value={token} />
                {contact}
                {optionalTeam}
                <Field label="Para qué es">
                  <Textarea name="description" required placeholder="Pago del service del aire." />
                </Field>
                <Field label="Monto a pagar">
                  <MoneyInput name="estimated_amount" required />
                </Field>
                {currency}
                {quote('Comprobante o factura')}
              </ActionForm>
            </>
          ) : (
            <>
              <h1 className="mb-1 text-base font-semibold text-navy-900">Pedir una compra</h1>
              <p className="mb-5 text-xs text-zinc-500">
                Lo que necesita tu equipo. La tesorería lo aprueba y después carga cuánto salió.
              </p>
              <ActionForm action={submitPurchaseRequest} submitLabel="Enviar pedido">
                <input type="hidden" name="campus_token" value={token} />
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
                  <MoneyInput name="estimated_amount" />
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
    <main className="flex flex-1 justify-center px-4 py-10">
      <div className="flex w-full max-w-lg flex-col gap-6">
        {children}
        <p className="text-center text-xs text-zinc-500">Denario</p>
      </div>
    </main>
  );
}
