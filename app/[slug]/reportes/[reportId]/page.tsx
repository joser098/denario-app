import Link from 'next/link';
import { notFound } from 'next/navigation';
import { canAdmin, canWrite, requireOrg } from '@/lib/auth';
import { closeReport, reopenReport, saveReport } from '@/lib/actions/reports';
import { createClient } from '@/lib/supabase/server';
import { formatRange } from '@/lib/dates';
import { REPORT_STATUS_LABELS } from '@/lib/reports';
import { loadWeek } from '@/lib/week-data';
import { ActionForm } from '@/components/form';
import { ReportForm, type WeekNumbers } from '@/components/report-form';
import { Badge, LinkButton, PageHeader } from '@/components/ui';

export const metadata = { title: 'Reporte' };

export default async function ReportPage(props: PageProps<'/[slug]/reportes/[reportId]'>) {
  const { slug, reportId } = await props.params;
  const { organization, campuses, role } = await requireOrg(slug);

  const supabase = await createClient();
  const { data: report } = await supabase
    .from('pl_reports')
    .select('*')
    .eq('id', reportId)
    .eq('organization_id', organization.id)
    .maybeSingle();

  if (!report) notFound();

  // El período del que sale este reporte. Sus números se muestran al lado de
  // cada campo: el reporte se puede ajustar a mano, y una diferencia con el
  // libro tiene que verse mientras se tipea, no después.
  const period = report.week_id
    ? await loadWeek(supabase, organization.id, report.week_id)
    : null;

  const fromWeek: WeekNumbers | null = period
    ? {
        amounts: { ...period.summary.revenue, ...period.summary.expenses },
        participants: period.summary.participants,
      }
    : null;

  const campus = campuses.find((c) => c.id === report.campus_id);
  const closed = report.status === 'closed';
  const readOnly = closed || !canWrite(role);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={`/${slug}/reportes`} className="text-sm text-zinc-500 hover:text-zinc-900">
          ← Profit &amp; Loss
        </Link>
        <PageHeader
          title={formatRange({ start: report.start_date, end: report.end_date })}
          subtitle={`${campus?.name ?? 'Campus'} · montos en ${report.currency_code}`}
          actions={
            <div className="flex items-center gap-2">
              <Badge tone={closed ? 'green' : 'amber'}>
                {REPORT_STATUS_LABELS[report.status]}
              </Badge>
              {/* El PDF existe recién cuando el reporte se cierra: en
                  borrador no hay nada definitivo que imprimir. */}
              {report.pdf_path ? (
                <LinkButton href={`/${slug}/reporte?id=${report.id}`} variant="secondary">
                  Descargar PDF
                </LinkButton>
              ) : null}
            </div>
          }
        />
      </div>

      {period ? (
        <p className="-mt-3 text-sm text-zinc-500">
          Los renglones que trae el Semanal se escriben acá al cerrar el período.{' '}
          <Link
            href={`/${slug}/semanal/${period.week.id}`}
            className="font-medium text-brand-600 hover:underline"
          >
            Ver el período →
          </Link>
        </p>
      ) : null}

      <ReportForm
        save={saveReport}
        close={closeReport}
        slug={slug}
        report={report}
        readOnly={readOnly}
        fromWeek={fromWeek}
      />

      {closed && canAdmin(role) ? (
        <ActionForm
          action={reopenReport}
          submitLabel="Reabrir reporte"
          submitVariant="secondary"
          footer={
            <p className="text-xs text-zinc-500">
              Reabrir deshace el cierre: el reporte vuelve a ser editable.
            </p>
          }
        >
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="id" value={report.id} />
        </ActionForm>
      ) : null}
    </div>
  );
}
