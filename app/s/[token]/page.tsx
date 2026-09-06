import type { ReactNode } from 'react';
import { createAdminClient } from '@/lib/supabase/admin';
import { formatShort } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { PAYMENT_STATUS_LABELS, PURCHASE_STATUS_LABELS } from '@/lib/expenses';
import { Alert, Badge, Card } from '@/components/ui';

export const metadata = { title: 'Seguimiento del pedido' };

/**
 * Seguimiento público de una solicitud. El token es de la solicitud, no del
 * campus: sirve para ver una sola y nada más.
 *
 * Es el único link que le queda a quien pidió, así que tiene que alcanzar
 * para saber en qué anda el pedido sin llamar a la tesorería.
 */
export default async function RequestStatusPage(props: PageProps<'/s/[token]'>) {
  const { token } = await props.params;
  const supabase = createAdminClient();

  const embed = '*, organizations!inner(name), campuses!inner(name)';

  const { data: purchase } = await supabase
    .from('purchase_requests')
    .select(embed)
    .eq('public_token', token)
    .maybeSingle();

  const { data: payment } = purchase
    ? { data: null }
    : await supabase.from('payment_requests').select(embed).eq('public_token', token).maybeSingle();

  const { data: budget } =
    purchase || payment
      ? { data: null }
      : await supabase.from('budgets').select(embed).eq('public_token', token).maybeSingle();

  const request = purchase ?? payment ?? budget;

  if (!request) {
    return (
      <Shell>
        <Alert tone="error">Este link no corresponde a ningún pedido.</Alert>
      </Shell>
    );
  }

  // Si de un presupuesto salió una solicitud de pago, esa solicitud tiene su
  // propio token — y nadie se lo dio a quien presentó el presupuesto. Así que
  // el estado del pago se sigue desde acá: es el único link que tiene, y
  // dejarlo en "recibido" para siempre sería mentirle.
  const { data: fromBudget } = budget?.payment_request_id
    ? await supabase
        .from('payment_requests')
        .select('status, actual_amount, actual_currency, rejection_reason')
        .eq('id', budget.payment_request_id)
        .maybeSingle()
    : { data: null };

  const organization = request.organizations as unknown as { name: string };
  const campus = request.campuses as unknown as { name: string };

  const kind = purchase
    ? 'Pedido de compra'
    : payment
      ? 'Pedido de pago'
      : 'Presupuesto presentado';

  // Lo que se sigue: la compra, el pedido de pago, o el pago que salió del
  // presupuesto. Un presupuesto suelto no tiene estado — solo consta.
  const tracked = payment ?? fromBudget;

  const status = purchase
    ? PURCHASE_STATUS_LABELS[purchase.status]
    : tracked
      ? PAYMENT_STATUS_LABELS[tracked.status]
      : 'Recibido';

  const closed = purchase
    ? purchase.status === 'delivered'
    : tracked
      ? tracked.status === 'paid'
      : true;
  const rejected = purchase?.status === 'rejected' || tracked?.status === 'rejected';

  const finalAmount = purchase?.actual_amount ?? tracked?.actual_amount ?? null;
  const finalCurrency = purchase?.actual_currency ?? tracked?.actual_currency ?? null;
  const reason = purchase?.rejection_reason ?? tracked?.rejection_reason ?? null;

  return (
    <Shell>
      <header className="text-center">
        <h1 className="text-lg font-semibold tracking-tight text-navy-900">
          {organization.name}
        </h1>
        <p className="text-sm text-zinc-500">
          {campus.name} · {kind} · {formatShort(request.created_at.slice(0, 10))}
        </p>
      </header>

      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-zinc-500">Estado</span>
          <Badge tone={rejected ? 'red' : closed ? 'green' : 'amber'}>{status}</Badge>
        </div>

        <p className="text-sm text-zinc-700">
          {purchase ? `A nombre de ${purchase.requester_name}` : (payment ?? budget)!.description}
        </p>

        {finalAmount ? (
          <p className="text-sm text-zinc-500">
            Monto final{' '}
            <span className="font-medium tabular-nums text-zinc-900">
              {formatMoney(Number(finalAmount), finalCurrency ?? 'ARS')}
            </span>
          </p>
        ) : request.estimated_amount ? (
          <p className="text-sm text-zinc-500">
            {budget ? 'Presupuestado' : 'Estimado'}{' '}
            <span className="tabular-nums text-zinc-900">
              {formatMoney(Number(request.estimated_amount), request.estimated_currency ?? 'ARS')}
            </span>
          </p>
        ) : null}

        {reason ? <Alert tone="error">{reason}</Alert> : null}

        {tracked?.status === 'approved' ? (
          <p className="text-xs text-zinc-500">
            Aprobado por la tesorería. Falta que se pague; cuando salga lo vas a ver acá.
          </p>
        ) : fromBudget ? (
          <p className="text-xs text-zinc-500">
            La tesorería generó una solicitud de pago a partir de este presupuesto. Acá vas a ver
            cómo sigue.
          </p>
        ) : budget ? (
          <p className="text-xs text-zinc-500">
            El presupuesto quedó archivado en la tesorería. Guardá este link: si deciden pagarlo,
            lo vas a ver acá.
          </p>
        ) : !closed && !rejected ? (
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
    <main className="flex flex-1 justify-center px-4 py-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        {children}
        <p className="text-center text-xs text-zinc-500">Denario</p>
      </div>
    </main>
  );
}
