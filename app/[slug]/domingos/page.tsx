import Link from 'next/link';
import { canWrite, requireOrg } from '@/lib/auth';
import { openSunday } from '@/lib/actions/sundays';
import { createClient } from '@/lib/supabase/server';
import { formatLong, lastSunday, todayIn } from '@/lib/dates';
import { formatTotals } from '@/lib/money';
import { isEmpty, summarize } from '@/lib/sundays';
import type { MeetingAmount } from '@/lib/database.types';
import { ActionForm } from '@/components/form';
import { Badge, Card, EmptyState, Field, Input, PageHeader, Select } from '@/components/ui';

export default async function SundaysPage(props: PageProps<'/[slug]/domingos'>) {
  const { slug } = await props.params;
  const { organization, campuses, role } = await requireOrg(slug);
  const writes = canWrite(role);

  const supabase = await createClient();
  const { data: sundays } = await supabase
    .from('sundays')
    .select('id, service_date, status, campus_id')
    .eq('organization_id', organization.id)
    .order('service_date', { ascending: false })
    .limit(30);

  const ids = (sundays ?? []).map((s) => s.id);
  const { data: amounts } = ids.length
    ? await supabase.from('meeting_amounts').select('*').in('sunday_id', ids)
    : { data: [] as MeetingAmount[] };

  const bySunday = new Map<string, MeetingAmount[]>();
  for (const row of amounts ?? []) {
    bySunday.set(row.sunday_id, [...(bySunday.get(row.sunday_id) ?? []), row]);
  }

  const campusName = (id: string) => campuses.find((c) => c.id === id)?.name ?? 'Campus';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Domingos" subtitle="Ofrendas, ventas e ingresos de cada reunión." />

      {writes ? (
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-medium text-zinc-900">Abrir un domingo</h2>
          <ActionForm
            action={openSunday}
            submitLabel="Abrir domingo"
            fieldsClassName="flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="slug" value={slug} />
            <Field label="Fecha">
              <Input
                name="service_date"
                type="date"
                defaultValue={lastSunday(todayIn(organization.timezone))}
                className="w-44"
                required
              />
            </Field>
            <Field label="Campus">
              <Select name="campus_id" defaultValue={campuses[0]?.id ?? ''} className="w-56">
                {campuses.map((campus) => (
                  <option key={campus.id} value={campus.id}>
                    {campus.name}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="w-full text-xs text-zinc-500 sm:w-auto sm:self-center">
              Se crean las reuniones activas del campus.
            </p>
          </ActionForm>
        </Card>
      ) : null}

      {(sundays ?? []).length === 0 ? (
        <EmptyState
          title="Todavía no abriste ningún domingo."
          description="Abrí la fecha y vas a poder cargar el conteo de cada reunión."
        />
      ) : (
        <Card className="divide-y divide-zinc-100">
          {(sundays ?? []).map((sunday) => {
            const totals = summarize(bySunday.get(sunday.id));

            return (
              <Link
                key={sunday.id}
                href={`/${slug}/domingos/${sunday.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-zinc-50"
              >
                <div>
                  <p className="text-sm font-medium text-zinc-900">
                    {formatLong(sunday.service_date)}
                  </p>
                  <p className="text-xs text-zinc-500">{campusName(sunday.campus_id)}</p>
                </div>

                <div className="flex items-center gap-4">
                  <span className="text-sm tabular-nums text-zinc-900">
                    {isEmpty(totals.moved) ? (
                      <span className="text-zinc-400">Sin movimientos</span>
                    ) : (
                      formatTotals(totals.total)
                    )}
                  </span>
                  <Badge tone={sunday.status === 'closed' ? 'green' : 'amber'}>
                    {sunday.status === 'closed' ? 'Cerrado' : 'Abierto'}
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
