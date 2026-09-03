import Link from 'next/link';
import { notFound } from 'next/navigation';
import { canAdmin, canWrite, requireOrg } from '@/lib/auth';
import { closeReport, reopenReport, saveReport } from '@/lib/actions/reports';
import { createClient } from '@/lib/supabase/server';
import { formatLong } from '@/lib/dates';
import { REPORT_STATUS_LABELS } from '@/lib/reports';
import { ActionForm } from '@/components/form';
import { ReportForm } from '@/components/report-form';
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
          title={formatLong(report.service_date)}
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

      <ReportForm
        save={saveReport}
        close={closeReport}
        slug={slug}
        report={report}
        readOnly={readOnly}
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
