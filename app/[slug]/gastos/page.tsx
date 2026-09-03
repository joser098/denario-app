import { canWrite, requireOrg } from '@/lib/auth';
import { approvePurchase, deliverPurchase, rejectPurchase } from '@/lib/actions/expenses';
import { createClient } from '@/lib/supabase/server';
import { listCurrencies } from '@/lib/currencies';
import { formatShort } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { PURCHASE_STATUS_LABELS } from '@/lib/expenses';
import type { PurchaseStatus } from '@/lib/database.types';
import { ActionForm } from '@/components/form';
import { Alert, Badge, Card, CurrencyOptions, EmptyState, Field, Input, Select } from '@/components/ui';

const TONES: Record<PurchaseStatus, 'amber' | 'blue' | 'red' | 'green'> = {
  pending: 'amber',
  approved: 'blue',
  rejected: 'red',
  delivered: 'green',
};

export default async function PurchasesPage(props: PageProps<'/[slug]/gastos'>) {
  const { slug } = await props.params;
  const { organization, campuses, role } = await requireOrg(slug);
  // El tesorero decide sobre los gastos de su campus; RLS ya recorta cuales.
  const decides = canWrite(role);

  const supabase = await createClient();
  const currencies = await listCurrencies(supabase);
  const [{ data: requests }, { data: teams }] = await Promise.all([
    supabase
      .from('purchase_requests')
      .select('*')
      .eq('organization_id', organization.id)
      .order('created_at', { ascending: false })
      .limit(60),
    supabase.from('teams').select('id, name').eq('organization_id', organization.id),
  ]);

  const ids = (requests ?? []).map((r) => r.id);
  const { data: items } = ids.length
    ? await supabase.from('purchase_request_items').select('*').in('purchase_request_id', ids)
    : { data: [] };

  const teamName = (id: string) => (teams ?? []).find((t) => t.id === id)?.name ?? 'Equipo';
  // Solo se nombra el campus si hay mas de uno a la vista: con uno solo el
  // dato no distingue nada y ensucia la fila.
  const campusName = (id: string) =>
    campuses.length > 1 ? (campuses.find((c) => c.id === id)?.name ?? 'Campus') : null;

  // La moneda del campus del pedido, no la de la organizacion: un pedido de un
  // campus de Bogota se lee y se paga en pesos colombianos.
  const currencyOf = (campus: string) =>
    campuses.find((c) => c.id === campus)?.default_currency ?? organization.default_currency;


  // Lo que espera decisión va primero: es lo único que pide acción.
  const rows = [...(requests ?? [])].sort((a, b) => {
    const rank = (status: PurchaseStatus) => (status === 'pending' ? 0 : status === 'approved' ? 1 : 2);
    return rank(a.status) - rank(b.status);
  });

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Todavía no llegó ningún pedido de compra."
        description="Los pedidos entran por el link del campus. Pasáselo a los encargados de cada equipo."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.map((request) => {
        const own = (items ?? []).filter((i) => i.purchase_request_id === request.id);

        return (
          <Card key={request.id} className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-navy-900">
                  {teamName(request.team_id)} · {request.requester_name}
                </p>
                <p className="text-xs text-zinc-500">
                  {formatShort(request.created_at.slice(0, 10))}
                  {campusName(request.campus_id) ? ` · ${campusName(request.campus_id)}` : ''}
                  {request.requester_email ? ` · ${request.requester_email}` : ''}
                  {request.requester_phone ? ` · ${request.requester_phone}` : ''}
                </p>
              </div>
              <Badge tone={TONES[request.status]}>{PURCHASE_STATUS_LABELS[request.status]}</Badge>
            </div>

            <ul className="flex flex-col gap-1 text-sm text-zinc-700">
              {own.map((item) => (
                <li key={item.id}>
                  {Number(item.quantity)} {item.unit ?? ''} — {item.name}
                </li>
              ))}
            </ul>

            <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
              {request.estimated_amount ? (
                <span className="text-zinc-500">
                  Estimado{' '}
                  <span className="tabular-nums text-zinc-900">
                    {formatMoney(
                      Number(request.estimated_amount),
                      request.estimated_currency ?? currencyOf(request.campus_id),
                    )}
                  </span>
                </span>
              ) : null}
              {request.actual_amount ? (
                <span className="text-zinc-500">
                  Real{' '}
                  <span className="font-medium tabular-nums text-zinc-900">
                    {formatMoney(
                      Number(request.actual_amount),
                      request.actual_currency ?? currencyOf(request.campus_id),
                    )}
                  </span>
                </span>
              ) : null}
            </div>

            {request.rejection_reason ? (
              <Alert tone="error">Rechazado: {request.rejection_reason}</Alert>
            ) : null}

            {decides && request.status === 'pending' ? (
              <div className="flex flex-col gap-3 border-t border-zinc-100 pt-4">
                <ActionForm action={approvePurchase} submitLabel="Aprobar">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="id" value={request.id} />
                </ActionForm>
                <ActionForm
                  action={rejectPurchase}
                  submitLabel="Rechazar"
                  submitVariant="danger"
                  fieldsClassName="flex flex-wrap items-end gap-3"
                >
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="id" value={request.id} />
                  <Field label="Motivo">
                    <Input name="rejection_reason" className="w-72" required />
                  </Field>
                </ActionForm>
              </div>
            ) : null}

            {decides && request.status === 'approved' ? (
              <div className="border-t border-zinc-100 pt-4">
                <p className="mb-3 text-xs text-zinc-500">
                  Al marcar entregado se carga el gasto en el libro semanal con el monto real.
                </p>
                <ActionForm
                  action={deliverPurchase}
                  submitLabel="Marcar entregado"
                  fieldsClassName="flex flex-wrap items-end gap-3"
                >
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="id" value={request.id} />
                  <Field label="Cuánto salió">
                    <Input name="actual_amount" inputMode="decimal" className="w-40" required />
                  </Field>
                  <Field label="Moneda">
                    <Select
                      name="actual_currency"
                      defaultValue={request.estimated_currency ?? currencyOf(request.campus_id)}
                      className="w-28"
                    >
                      <CurrencyOptions currencies={currencies} />
                    </Select>
                  </Field>
                </ActionForm>
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
