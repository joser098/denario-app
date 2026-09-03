import Link from 'next/link';
import { canWrite, requireOrg } from '@/lib/auth';
import { openReport } from '@/lib/actions/reports';
import { createClient } from '@/lib/supabase/server';
import { formatLong, lastSunday, todayIn } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { REPORT_STATUS_LABELS, reportTotals } from '@/lib/reports';
import { ActionForm } from '@/components/form';

export const metadata = { title: 'Profit & Loss' };
import {
  Badge,
  Card,
  EmptyState,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Select,
} from '@/components/ui';

export default async function ReportsPage(props: PageProps<'/[slug]/reportes'>) {
  const { slug } = await props.params;
  const { organization, campuses, campusId, role } = await requireOrg(slug);
  const writes = canWrite(role);

  const supabase = await createClient();
  // RLS ya recorta por campus; el filtro esta para que la consulta diga lo
  // mismo que la pantalla.
  const query = supabase
    .from('pl_reports')
    .select('*')
    .eq('organization_id', organization.id);

  if (campusId) query.eq('campus_id', campusId);

  const { data: reports } = await query
    .order('service_date', { ascending: false })
    .limit(40);

  const campusName = (id: string) => campuses.find((c) => c.id === id)?.name ?? 'Campus';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Profit & Loss"
        subtitle="Un reporte por domingo y campus. Se manda el miércoles siguiente."
        actions={
          // El que esta acotado a un campus no tiene nada que consolidar.
          campusId ? null : (
            <LinkButton href={`/${slug}/reportes/consolidado`} variant="secondary">
              Consolidado en USD
            </LinkButton>
          )
        }
      />

      {writes ? (
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-medium text-zinc-900">Abrir un reporte</h2>
          <ActionForm
            action={openReport}
            submitLabel="Abrir reporte"
            fieldsClassName="flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="slug" value={slug} />
            <Field label="Domingo">
              <Input
                name="service_date"
                type="date"
                defaultValue={lastSunday(todayIn(organization.timezone))}
                className="w-44"
                required
              />
            </Field>
            <Field label="Campus">
              <Select
                name="campus_id"
                defaultValue={campusId ?? campuses[0]?.id ?? ''}
                className="w-56"
                required
              >
                {campuses.map((campus) => (
                  <option key={campus.id} value={campus.id}>
                    {campus.name}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="w-full text-xs text-zinc-500 sm:w-auto sm:self-center">
              Nace vacío: los números se cargan adentro.
            </p>
          </ActionForm>
        </Card>
      ) : null}

      {(reports ?? []).length === 0 ? (
        <EmptyState
          title="Todavía no hay ningún reporte."
          description="Abrí el domingo que corresponda y cargá los ingresos y egresos de la semana."
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
                    {formatLong(report.service_date)}
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
