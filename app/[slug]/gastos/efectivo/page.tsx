import { canWrite, requireOrg } from '@/lib/auth';
import { registerCashPayment } from '@/lib/actions/expenses';
import { createClient } from '@/lib/supabase/server';
import { campusCurrencies, listCurrencies } from '@/lib/currencies';
import { formatShort, todayIn } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { ActionForm } from '@/components/form';
import { MoneyInput } from '@/components/money-input';
import { Card, CurrencyOptions, EmptyState, Field, Input, PageHeader, Select, Textarea } from '@/components/ui';

export const metadata = { title: 'Pagos en efectivo' };

/**
 * Pagos en efectivo de la caja del campus.
 *
 * No hay solicitud ni aprobación: la plata ya se entregó y lo que falta es
 * documentarla. Se registra el pago y sale el recibo con su número, que el
 * acreedor firma en papel.
 */
export default async function CashPaymentsPage(props: PageProps<'/[slug]/gastos/efectivo'>) {
  const { slug } = await props.params;
  const { organization, campuses, campusId, role } = await requireOrg(slug);
  const writes = canWrite(role);

  const supabase = await createClient();
  const [currencies, { data: payments }, { data: teams }] = await Promise.all([
    listCurrencies(supabase),
    supabase
      .from('cash_payments')
      .select('*')
      .eq('organization_id', organization.id)
      .order('created_at', { ascending: false })
      .limit(60),
    supabase
      .from('teams')
      .select('id, name')
      .eq('organization_id', organization.id)
      .eq('is_active', true)
      .order('sort_order'),
  ]);

  const teamName = (id: string | null) =>
    id ? ((teams ?? []).find((t) => t.id === id)?.name ?? 'Equipo') : null;
  const campusName = (id: string) =>
    campuses.length > 1 ? (campuses.find((c) => c.id === id)?.name ?? 'Campus') : null;

  // Las monedas de los campus que este miembro ve, no el catalogo entero: el
  // campus se elige en el mismo formulario, asi que la lista tiene que servir
  // para cualquiera de ellos. Arranca en la del campus preseleccionado.
  const defaultCampus = campuses.find((c) => c.id === campusId) ?? campuses[0];
  const codes = [
    ...new Set(campuses.flatMap((c) => campusCurrencies(c.default_currency))),
  ];
  const options = currencies.filter((c) => codes.includes(c.code));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Pagos en efectivo"
        subtitle="Registro interno de la caja. Cada pago genera un recibo numerado para imprimir y firmar."
      />

      {writes ? (
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-medium text-zinc-900">Registrar un pago</h2>
          <ActionForm action={registerCashPayment} submitLabel="Registrar y generar recibo" resetOnSuccess>
            <input type="hidden" name="slug" value={slug} />

            {campuses.length > 1 ? (
              <Field label="Campus">
                <Select name="campus_id" defaultValue={campusId ?? campuses[0]?.id ?? ''} required>
                  {campuses.map((campus) => (
                    <option key={campus.id} value={campus.id}>
                      {campus.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : (
              <input type="hidden" name="campus_id" value={campusId ?? campuses[0]?.id ?? ''} />
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="A nombre de" hint="Quien recibe el efectivo y firma el recibo.">
                <Input name="payee_name" required />
              </Field>
              <Field label="Documento" hint="Opcional.">
                <Input name="payee_document" />
              </Field>
            </div>

            <Field label="En concepto de">
              <Input name="concept" required placeholder="Arreglo del aire del salón." />
            </Field>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Monto">
                <MoneyInput name="amount" required />
              </Field>
              <Field label="Moneda">
                <Select
                  name="currency_code"
                  defaultValue={defaultCampus?.default_currency ?? organization.default_currency}
                >
                  <CurrencyOptions currencies={options} />
                </Select>
              </Field>
              <Field label="Fecha del pago">
                <Input
                  name="paid_on"
                  type="date"
                  defaultValue={todayIn(organization.timezone)}
                  required
                />
              </Field>
            </div>

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

            <Field label="Observaciones" hint="Opcional. Salen impresas en el recibo.">
              <Textarea name="notes" rows={2} />
            </Field>

            <p className="text-xs text-zinc-500">
              El gasto se carga en el libro semanal del campus, en la semana de la fecha del pago.
            </p>
          </ActionForm>
        </Card>
      ) : null}

      {(payments ?? []).length === 0 ? (
        <EmptyState
          title="Todavía no registraste ningún pago en efectivo."
          description="Cargá el pago de acá arriba y bajás el recibo para que lo firmen."
        />
      ) : (
        <Card className="divide-y divide-zinc-100">
          {(payments ?? []).map((payment) => (
            <div
              key={payment.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-navy-900">
                  N° {String(payment.receipt_number).padStart(6, '0')} · {payment.payee_name}
                </p>
                <p className="text-xs text-zinc-500">
                  {formatShort(payment.paid_on)}
                  {campusName(payment.campus_id) ? ` · ${campusName(payment.campus_id)}` : ''}
                  {teamName(payment.team_id) ? ` · ${teamName(payment.team_id)}` : ''} ·{' '}
                  {payment.concept}
                </p>
              </div>

              <div className="flex items-center gap-4">
                <span className="text-sm font-medium tabular-nums text-zinc-900">
                  {formatMoney(Number(payment.amount), payment.currency_code)}
                </span>
                <a
                  href={`/${slug}/recibo?id=${payment.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-brand-600 hover:underline"
                >
                  Recibo
                </a>
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
