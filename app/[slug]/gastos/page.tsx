import { canAdmin, requireOrg } from '@/lib/auth';
import { approvePurchase, deliverPurchase, rejectPurchase } from '@/lib/actions/expenses';
import { createClient } from '@/lib/supabase/server';
import { formatShort } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { PURCHASE_STATUS_LABELS } from '@/lib/expenses';
import type { PurchaseStatus } from '@/lib/database.types';
import { ActionForm } from '@/components/form';
import { Alert, Badge, Card, EmptyState, Field, Input, Select } from '@/components/ui';

const TONES: Record<PurchaseStatus, 'amber' | 'blue' | 'red' | 'green'> = {
  pending: 'amber',
  approved: 'blue',
  rejected: 'red',
  delivered: 'green',
};

export default async function PurchasesPage(props: PageProps<'/[slug]/gastos'>) {
  const { slug } = await props.params;
  const { organization, role } = await requireOrg(slug);
  const decides = canAdmin(role);

  const supabase = await createClient();
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

  // Lo que espera decisión va primero: es lo único que pide acción.
  const rows = [...(requests ?? [])].sort((a, b) => {
    const rank = (status: PurchaseStatus) => (status === 'pending' ? 0 : status === 'approved' ? 1 : 2);
    return rank(a.status) - rank(b.status);
  });

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Todavía no llegó ningún pedido de compra."
        description="Los pedidos entran por el link de acá arriba. Pasáselo a los encargados de cada equipo."
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
                      request.estimated_currency ?? organization.default_currency,
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
                      request.actual_currency ?? organization.default_currency,
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
                      defaultValue={organization.default_currency}
                      className="w-28"
                    >
                      <option value="ARS">ARS</option>
                      <option value="USD">USD</option>
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
