import Link from 'next/link';
import { notFound } from 'next/navigation';
import { canWrite, requireOrg } from '@/lib/auth';
import {
  closeSunday,
  generateSundayActa,
  reopenSunday,
  updateSundayNotes,
} from '@/lib/actions/sundays';
import { createClient } from '@/lib/supabase/server';
import { formatLong, formatTime } from '@/lib/dates';
import { formatTotals } from '@/lib/money';
import {
  COUNT_STATUS_LABELS,
  isEmpty,
  methodLabel,
  methodsOf,
  summarize,
  type Breakdown,
  type Totals,
} from '@/lib/sundays';
import { ActionForm } from '@/components/form';
import { Badge, Card, Field, PageHeader, Textarea } from '@/components/ui';

export const metadata = { title: 'Domingo' };

export default async function SundayPage(props: PageProps<'/[slug]/domingos/[sundayId]'>) {
  const { slug, sundayId } = await props.params;
  const { organization, campuses, role } = await requireOrg(slug);
  const writes = canWrite(role);

  const supabase = await createClient();
  const { data: sunday } = await supabase
    .from('sundays')
    .select('*')
    .eq('id', sundayId)
    .eq('organization_id', organization.id)
    .maybeSingle();

  if (!sunday) notFound();

  const [{ data: meetings }, { data: amounts }, { data: counts }] = await Promise.all([
    supabase
      .from('sunday_meetings')
      .select('*')
      .eq('sunday_id', sundayId)
      .order('sort_order'),
    supabase.from('meeting_amounts').select('*').eq('sunday_id', sundayId),
    supabase
      .from('offering_counts')
      .select('id, meeting_id, status, envelopes_count, sunday_meetings!inner(sunday_id)')
      .neq('status', 'voided')
      .eq('sunday_meetings.sunday_id', sundayId),
  ]);

  const totals = summarize(amounts);
  // Los sobres se cuentan con el mismo criterio que la ofrenda: solo las
  // actas finalizadas, que son las unicas que aportan plata al total. Sumar
  // los de un borrador mostraria sobres de plata que todavia no esta contada.
  const finalized = (counts ?? []).filter((c) => c.status === 'finalized');
  const envelopes = finalized.reduce((sum, c) => sum + c.envelopes_count, 0);
  const closed = sunday.status === 'closed';
  const campus = campuses.find((c) => c.id === sunday.campus_id);
  const countByMeeting = new Map((counts ?? []).map((c) => [c.meeting_id, c]));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={`/${slug}/domingos`} className="text-sm text-zinc-500 hover:text-zinc-900">
          ← Domingos
        </Link>
        <PageHeader
          title={formatLong(sunday.service_date)}
          subtitle={campus?.name}
          actions={<Badge tone={closed ? 'green' : 'amber'}>{closed ? 'Cerrado' : 'Abierto'}</Badge>}
        />
      </div>

      <Card className="flex flex-wrap gap-x-10 gap-y-4 p-5">
        <Amount label="Efectivo" totals={totals.offering} />
        <Amount label="Ventas" totals={totals.sales.total} breakdown={totals.sales} />
        <Amount label="Ingresos digitales" totals={totals.incomes.total} breakdown={totals.incomes} />
        <div>
          <p className="text-xs font-medium text-zinc-500">Sobres</p>
          <p className="text-base tabular-nums text-zinc-900">
            {finalized.length === 0 ? <span className="text-zinc-500">—</span> : envelopes}
          </p>
          <p className="text-xs text-zinc-500">dato de control</p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-xs font-medium text-zinc-500">Total del domingo</p>
          <p className="text-[11px] text-zinc-500">sin contar ventas</p>
          <p className="text-xl font-semibold tabular-nums text-zinc-900">
            {formatTotals(totals.total)}
          </p>
        </div>
      </Card>

      {sunday.acta_pdf_path ? (
        <a
          href={`/${slug}/acta?path=${encodeURIComponent(sunday.acta_pdf_path)}`}
          className="-mt-3 text-sm font-medium text-zinc-900 hover:underline"
        >
          Descargar el acta de cierre (PDF)
        </a>
      ) : closed && writes ? (
        <ActionForm
          action={generateSundayActa}
          submitLabel="Generar el acta de cierre (PDF)"
          submitVariant="secondary"
          className="-mt-3 items-start"
        >
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="sunday_id" value={sundayId} />
        </ActionForm>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-zinc-900">Reuniones</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {(meetings ?? []).map((meeting) => {
            const meetingTotals = summarize(
              (amounts ?? []).filter((a) => a.meeting_id === meeting.id),
            );
            const count = countByMeeting.get(meeting.id);

            return (
              <Link
                key={meeting.id}
                href={`/${slug}/domingos/${sundayId}/reuniones/${meeting.id}`}
                className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm hover:border-zinc-300"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-zinc-900">{meeting.label}</p>
                    <p className="text-xs text-zinc-500">{formatTime(meeting.start_time)}</p>
                  </div>
                  {count ? (
                    <Badge tone={count.status === 'finalized' ? 'green' : 'amber'}>
                      {COUNT_STATUS_LABELS[count.status]}
                    </Badge>
                  ) : (
                    <Badge tone="neutral">Sin acta</Badge>
                  )}
                </div>
                {isEmpty(meetingTotals.moved) ? (
                  <p className="text-base text-zinc-500">Sin movimientos</p>
                ) : (
                  <div>
                    <p className="text-lg font-semibold tabular-nums text-zinc-900">
                      {formatTotals(meetingTotals.total)}
                    </p>
                    {isEmpty(meetingTotals.sales.total) ? null : (
                      <p className="text-xs text-zinc-500">
                        Ventas {formatTotals(meetingTotals.sales.total)}
                      </p>
                    )}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      </section>

      {writes ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {closed ? null : (
          <Card className="p-5">
            <h2 className="mb-4 text-sm font-medium text-zinc-900">Notas del domingo</h2>
            <ActionForm action={updateSundayNotes} submitLabel="Guardar notas">
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="sunday_id" value={sundayId} />
              <Field label="Notas">
                <Textarea
                  name="notes"
                  defaultValue={sunday.notes ?? ''}
                  placeholder="Algo para dejar asentado de este domingo."
                />
              </Field>
            </ActionForm>
          </Card>
          )}

          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-sm font-medium text-zinc-900">
              {closed ? 'Reabrir el domingo' : 'Cerrar el domingo'}
            </h2>
            <p className="text-xs text-zinc-500">
              {closed
                ? 'Reabrir vuelve a habilitar la carga en todas las reuniones. Solo un administrador puede hacerlo.'
                : 'Al cerrar, las reuniones quedan bloqueadas. Antes hay que finalizar o anular las actas en borrador.'}
            </p>
            <ActionForm
              action={closed ? reopenSunday : closeSunday}
              submitLabel={closed ? 'Reabrir domingo' : 'Cerrar domingo'}
              submitVariant={closed ? 'secondary' : 'primary'}
            >
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="sunday_id" value={sundayId} />
            </ActionForm>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function Amount({
  label,
  totals,
  breakdown,
}: {
  label: string;
  totals: Totals;
  breakdown?: Breakdown;
}) {
  const methods = breakdown ? methodsOf(breakdown) : [];

  return (
    <div>
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="text-base tabular-nums text-zinc-900">
        {isEmpty(totals) ? <span className="text-zinc-500">—</span> : formatTotals(totals)}
      </p>
      {methods.length > 0 ? (
        <p className="text-xs text-zinc-500">
          {methods
            .map(
              (method) =>
                `${methodLabel(method)} ${formatTotals(breakdown!.byMethod[method])}`,
            )
            .join(' · ')}
        </p>
      ) : null}
    </div>
  );
}
