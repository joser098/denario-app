import { canAdmin, requireOrg } from '@/lib/auth';
import { attachReceipt, payBudget, rejectBudget } from '@/lib/actions/expenses';
import { createClient } from '@/lib/supabase/server';
import { formatShort } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { BUDGET_STATUS_LABELS } from '@/lib/expenses';
import type { BudgetStatus } from '@/lib/database.types';
import { ActionForm } from '@/components/form';
import { Alert, Badge, Card, EmptyState, Field, Input, Select } from '@/components/ui';

const TONES: Record<BudgetStatus, 'amber' | 'red' | 'green'> = {
  pending: 'amber',
  rejected: 'red',
  paid: 'green',
};

export default async function BudgetsPage(props: PageProps<'/[slug]/gastos/presupuestos'>) {
  const { slug } = await props.params;
  const { organization, role } = await requireOrg(slug);
  const decides = canAdmin(role);

  const supabase = await createClient();
  const [{ data: requests }, { data: teams }, { data: methods }] = await Promise.all([
    supabase
      .from('budget_requests')
      .select('*')
      .eq('organization_id', organization.id)
      .order('created_at', { ascending: false })
      .limit(60),
    supabase.from('teams').select('id, name').eq('organization_id', organization.id),
    supabase
      .from('payment_methods')
      .select('*')
      .eq('organization_id', organization.id)
      .eq('is_active', true)
      .order('sort_order'),
  ]);

  const ids = (requests ?? []).map((r) => r.id);
  const { data: files } = ids.length
    ? await supabase
        .from('attachments')
        .select('*')
        .eq('attachable_type', 'budget_request')
        .in('attachable_id', ids)
    : { data: [] };

  const teamName = (id: string | null) =>
    id ? ((teams ?? []).find((t) => t.id === id)?.name ?? 'Equipo') : 'Sin equipo';
  const methodName = (id: string | null) =>
    id ? ((methods ?? []).find((m) => m.id === id)?.name ?? 'Medio de pago') : null;

  const rows = [...(requests ?? [])].sort(
    (a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1),
  );

  if (rows.length === 0) {
    return (
      <EmptyState
        title="Todavía no llegó ningún presupuesto."
        description="Los pedidos entran por el link de acá arriba. Pasáselo a los encargados de cada equipo."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {rows.map((request) => {
        const own = (files ?? []).filter((f) => f.attachable_id === request.id);

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
              <Badge tone={TONES[request.status]}>{BUDGET_STATUS_LABELS[request.status]}</Badge>
            </div>

            <p className="text-sm text-zinc-700">{request.description}</p>

            <div className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
              <span className="text-zinc-500">
                Estimado{' '}
                <span className="tabular-nums text-zinc-900">
                  {formatMoney(
                    Number(request.estimated_amount),
                    request.estimated_currency ?? organization.default_currency,
                  )}
                </span>
              </span>
              {request.actual_amount ? (
                <span className="text-zinc-500">
                  Pagado{' '}
                  <span className="font-medium tabular-nums text-zinc-900">
                    {formatMoney(
                      Number(request.actual_amount),
                      request.actual_currency ?? organization.default_currency,
                    )}
                  </span>
                  {methodName(request.payment_method_id)
                    ? ` con ${methodName(request.payment_method_id)}`
                    : ''}
                </span>
              ) : null}
            </div>

            {own.length > 0 ? (
              <div className="flex flex-wrap gap-3 text-sm">
                {own.map((file) => (
                  <a
                    key={file.id}
                    href={`/${slug}/adjunto?path=${encodeURIComponent(file.storage_path)}`}
                    className="font-medium text-brand-600 hover:underline"
                  >
                    {file.kind === 'receipt' ? 'Comprobante' : 'Cotización'}:{' '}
                    {file.original_filename}
                  </a>
                ))}
              </div>
            ) : null}

            {request.rejection_reason ? (
              <Alert tone="error">Rechazado: {request.rejection_reason}</Alert>
            ) : null}

            {decides && request.status === 'pending' ? (
              <div className="flex flex-col gap-3 border-t border-zinc-100 pt-4">
                <p className="text-xs text-zinc-500">
                  Aprobar y pagar es un solo paso: al pagarlo, el gasto va al libro semanal.
                </p>
                <ActionForm
                  action={payBudget}
                  submitLabel="Pagar"
                  fieldsClassName="flex flex-wrap items-end gap-3"
                >
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="id" value={request.id} />
                  <Field label="Cuánto se pagó">
                    <Input
                      name="actual_amount"
                      inputMode="decimal"
                      defaultValue={Number(request.estimated_amount)}
                      className="w-40"
                      required
                    />
                  </Field>
                  <Field label="Moneda">
                    <Select
                      name="actual_currency"
                      defaultValue={request.estimated_currency ?? organization.default_currency}
                      className="w-28"
                    >
                      <option value="ARS">ARS</option>
                      <option value="USD">USD</option>
                    </Select>
                  </Field>
                  <Field label="Con qué">
                    <Select name="payment_method_id" className="w-48" required>
                      {(methods ?? []).map((method) => (
                        <option key={method.id} value={method.id}>
                          {method.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </ActionForm>

                <ActionForm
                  action={rejectBudget}
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

            {decides && request.status === 'paid' ? (
              <div className="border-t border-zinc-100 pt-4">
                <ActionForm
                  action={attachReceipt}
                  submitLabel="Adjuntar comprobante"
                  submitVariant="secondary"
                  fieldsClassName="flex flex-wrap items-end gap-3"
                >
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="attachable_type" value="budget_request" />
                  <input type="hidden" name="attachable_id" value={request.id} />
                  <Field label="Comprobante" hint="PDF, PNG o JPG.">
                    <input
                      type="file"
                      name="file"
                      accept="application/pdf,image/png,image/jpeg"
                      required
                      className="w-full text-sm text-zinc-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-4 file:py-2 file:text-sm file:font-medium file:text-brand-600 hover:file:bg-brand-100"
                    />
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
