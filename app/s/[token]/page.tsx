import type { ReactNode } from 'react';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatShort } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { BUDGET_STATUS_LABELS, PURCHASE_STATUS_LABELS } from '@/lib/expenses';
import { Alert, Badge, Card } from '@/components/ui';

export const metadata = { title: 'Seguimiento del pedido · Denario' };

/**
 * Seguimiento público de una solicitud. El token es de la solicitud, no de
 * la organización: sirve para ver una sola y nada más.
 */
export default async function RequestStatusPage(props: PageProps<'/s/[token]'>) {
  const { token } = await props.params;
  const supabase = createAdminClient();

  const { data: purchase } = await supabase
    .from('purchase_requests')
    .select('*, organizations!inner(name)')
    .eq('public_token', token)
    .maybeSingle();

  const { data: budget } = purchase
    ? { data: null }
    : await supabase
        .from('budget_requests')
        .select('*, organizations!inner(name)')
        .eq('public_token', token)
        .maybeSingle();

  const request = purchase ?? budget;

  if (!request) {
    return (
      <Shell>
        <Alert tone="error">Este link no corresponde a ningún pedido.</Alert>
      </Shell>
    );
  }

  const organization = request.organizations as unknown as { name: string };
  const status = purchase
    ? PURCHASE_STATUS_LABELS[purchase.status]
    : BUDGET_STATUS_LABELS[budget!.status];

  const closed = purchase
    ? purchase.status === 'delivered'
    : budget!.status === 'paid';
  const rejected = request.status === 'rejected';

  return (
    <Shell>
      <header className="text-center">
        <p className="text-lg font-semibold tracking-tight text-navy-900">{organization.name}</p>
        <p className="text-sm text-zinc-500">
          {purchase ? 'Pedido de compra' : 'Pedido de presupuesto'} ·{' '}
          {formatShort(request.created_at.slice(0, 10))}
        </p>
      </header>

      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-zinc-500">Estado</span>
          <Badge tone={rejected ? 'red' : closed ? 'green' : 'amber'}>{status}</Badge>
        </div>

        <p className="text-sm text-zinc-700">
          {budget ? budget.description : `A nombre de ${request.requester_name}`}
        </p>

        {request.actual_amount ? (
          <p className="text-sm text-zinc-500">
            Monto final{' '}
            <span className="font-medium tabular-nums text-zinc-900">
              {formatMoney(Number(request.actual_amount), request.actual_currency ?? 'ARS')}
            </span>
          </p>
        ) : request.estimated_amount ? (
          <p className="text-sm text-zinc-500">
            Estimado{' '}
            <span className="tabular-nums text-zinc-900">
              {formatMoney(Number(request.estimated_amount), request.estimated_currency ?? 'ARS')}
            </span>
          </p>
        ) : null}

        {request.rejection_reason ? (
          <Alert tone="error">{request.rejection_reason}</Alert>
        ) : null}

        {!closed && !rejected ? (
          <p className="text-xs text-zinc-500">
            Guardá este link: acá vas a ver cuando la tesorería lo resuelva.
          </p>
        ) : null}
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-1 justify-center px-4 py-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        {children}
        <p className="text-center text-xs text-zinc-400">Denario</p>
      </div>
    </div>
  );
}
