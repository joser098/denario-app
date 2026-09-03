import Link from 'next/link';
import { canWrite, requireOrg } from '@/lib/auth';
import { deleteBudget, requestBudgetPayment } from '@/lib/actions/expenses';
import { createClient } from '@/lib/supabase/server';
import { formatShort } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { PAYMENT_STATUS_LABELS } from '@/lib/expenses';
import { ActionForm, SubmitButton } from '@/components/form';
import { Badge, Card, EmptyState, PageHeader } from '@/components/ui';

export const metadata = { title: 'Presupuestos' };

/**
 * Presupuestos presentados. Archivo, no flujo: acá no se aprueba ni se paga
 * nada, y por eso una fila no tiene estado. Lo único que sale de esta
 * pantalla es la solicitud de pago, que sí es un flujo y vive en su pestaña.
 */
export default async function BudgetsPage(props: PageProps<'/[slug]/gastos/presupuestos'>) {
  const { slug } = await props.params;
  const { organization, campuses, role } = await requireOrg(slug);
  const writes = canWrite(role);

  const supabase = await createClient();
  const [{ data: budgets }, { data: teams }] = await Promise.all([
    supabase
      .from('budgets')
      .select('*')
      .eq('organization_id', organization.id)
      .order('created_at', { ascending: false })
      .limit(60),
    supabase.from('teams').select('id, name').eq('organization_id', organization.id),
  ]);

  const ids = (budgets ?? []).map((b) => b.id);
  const [{ data: files }, { data: payments }] = await Promise.all([
    ids.length
      ? supabase
          .from('attachments')
          .select('*')
          .eq('attachable_type', 'budget')
          .in('attachable_id', ids)
      : Promise.resolve({ data: [] }),
    ids.length
      ? supabase
          .from('payment_requests')
          .select('id, status')
          .in(
            'id',
            (budgets ?? []).map((b) => b.payment_request_id).filter((id) => id !== null),
          )
      : Promise.resolve({ data: [] }),
  ]);

  const teamName = (id: string | null) =>
    id ? ((teams ?? []).find((t) => t.id === id)?.name ?? 'Equipo') : 'Sin equipo';
  const campusName = (id: string) =>
    campuses.length > 1 ? (campuses.find((c) => c.id === id)?.name ?? 'Campus') : null;

  // La moneda del campus del pedido, no la de la organizacion: un pedido de un
  // campus de Bogota se lee y se paga en pesos colombianos.
  const currencyOf = (campus: string) =>
    campuses.find((c) => c.id === campus)?.default_currency ?? organization.default_currency;

  const paymentStatus = (id: string | null) =>
    id ? ((payments ?? []).find((p) => p.id === id)?.status ?? null) : null;

  if ((budgets ?? []).length === 0) {
    return (
      <EmptyState
        title="Todavía no se presentó ningún presupuesto."
        description="Se cargan por el link del campus. Quedan archivados acá; si hay que pagar alguno, desde el presupuesto se genera la solicitud de pago."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Presupuestos presentados"
        subtitle="Documentación. No mueven plata: si hay que pagar uno, generá la solicitud de pago."
      />

      {(budgets ?? []).map((budget) => {
        const own = (files ?? []).filter((f) => f.attachable_id === budget.id);
        const status = paymentStatus(budget.payment_request_id);

        return (
          <Card key={budget.id} className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-navy-900">
                  {teamName(budget.team_id)} · {budget.requester_name}
                </p>
                <p className="text-xs text-zinc-500">
                  {formatShort(budget.created_at.slice(0, 10))}
                  {campusName(budget.campus_id) ? ` · ${campusName(budget.campus_id)}` : ''}
                  {budget.requester_email ? ` · ${budget.requester_email}` : ''}
                  {budget.requester_phone ? ` · ${budget.requester_phone}` : ''}
                </p>
              </div>
              {status ? (
                <Badge tone={status === 'paid' ? 'green' : status === 'rejected' ? 'red' : 'amber'}>
                  Pago {PAYMENT_STATUS_LABELS[status].toLowerCase()}
                </Badge>
              ) : null}
            </div>

            <p className="text-sm text-zinc-700">{budget.description}</p>

            <span className="text-sm text-zinc-500">
              Presupuestado{' '}
              <span className="font-medium tabular-nums text-zinc-900">
                {formatMoney(
                  Number(budget.estimated_amount),
                  budget.estimated_currency ?? currencyOf(budget.campus_id),
                )}
              </span>
            </span>

            {own.length > 0 ? (
              <div className="flex flex-wrap gap-3 text-sm">
                {own.map((file) => (
                  <a
                    key={file.id}
                    href={`/${slug}/adjunto?path=${encodeURIComponent(file.storage_path)}`}
                    className="font-medium text-brand-600 hover:underline"
                  >
                    Presupuesto: {file.original_filename}
                  </a>
                ))}
              </div>
            ) : null}

            {writes ? (
              <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-4">
                {budget.payment_request_id ? (
                  <Link
                    href={`/${slug}/gastos/pagos`}
                    className="text-sm font-medium text-brand-600 hover:underline"
                  >
                    Ver la solicitud de pago →
                  </Link>
                ) : (
                  <>
                    <ActionForm
                      action={requestBudgetPayment}
                      submitLabel="Generar solicitud de pago"
                    >
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="id" value={budget.id} />
                    </ActionForm>
                    <form action={deleteBudget}>
                      <input type="hidden" name="slug" value={slug} />
                      <input type="hidden" name="id" value={budget.id} />
                      <SubmitButton
                        variant="ghost"
                        confirm="Se borra el presupuesto presentado. ¿Seguimos?"
                      >
                        Borrar
                      </SubmitButton>
                    </form>
                  </>
                )}
              </div>
            ) : null}
          </Card>
        );
      })}
    </div>
  );
}
