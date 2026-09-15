import Link from 'next/link';
import { requireOrg } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatRange } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { REPORT_STATUS_LABELS, reportTotals } from '@/lib/reports';

export const metadata = { title: 'Profit & Loss' };
import { Badge, Card, EmptyState, LinkButton, PageHeader } from '@/components/ui';

export default async function ReportsPage(props: PageProps<'/[slug]/reportes'>) {
  const { slug } = await props.params;
  const { organization, campuses, campusId } = await requireOrg(slug);

  const supabase = await createClient();
  // RLS ya recorta por campus; el filtro esta para que la consulta diga lo
  // mismo que la pantalla.
  const query = supabase
    .from('pl_reports')
    .select('*')
    .eq('organization_id', organization.id);

  if (campusId) query.eq('campus_id', campusId);

  const { data: reports } = await query
    .order('start_date', { ascending: false })
    .limit(40);

  const campusName = (id: string) => campuses.find((c) => c.id === id)?.name ?? 'Campus';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Profit & Loss"
        subtitle="Un reporte por período y campus. Se abre y se llena desde el Semanal."
        actions={
          // El que esta acotado a un campus no tiene nada que consolidar.
          campusId ? null : (
            <LinkButton href={`/${slug}/reportes/consolidado`} variant="secondary">
              Consolidado en USD
            </LinkButton>
          )
        }
      />

      {(reports ?? []).length === 0 ? (
        <EmptyState
          title="Todavía no hay ningún reporte."
          description="El reporte nace con el período: cuando un administrador abre uno en Semanal, cada campus tiene el suyo esperando."
        />
      ) : (
        <Card className="divide-y divide-zinc-100">
          {(reports ?? []).map((report) => {
            const totals = reportTotals(report);
            const deficit = totals.surplus < 0;

            return (
              <Link
                key={report.id}
                href={`/${slug}/reportes/${report.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-zinc-50"
              >
                <div>
                  <p className="text-sm font-medium text-zinc-900">
                    {formatRange({ start: report.start_date, end: report.end_date })}
                  </p>
                  <p className="text-xs text-zinc-500">{campusName(report.campus_id)}</p>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <p
                      className={`text-sm font-medium tabular-nums ${
                        deficit ? 'text-red-600' : 'text-zinc-900'
                      }`}
                    >
                      {formatMoney(totals.surplus, report.currency_code)}
                    </p>
                    <p className="text-xs text-zinc-500">
                      Ingresos {formatMoney(totals.revenue, report.currency_code)} · Egresos{' '}
                      {formatMoney(totals.expenses, report.currency_code)}
                    </p>
                  </div>
                  <Badge tone={report.status === 'closed' ? 'green' : 'amber'}>
                    {REPORT_STATUS_LABELS[report.status]}
                  </Badge>
                </div>
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}
