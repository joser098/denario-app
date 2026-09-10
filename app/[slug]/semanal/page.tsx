import Link from 'next/link';
import { canWrite, requireOrg } from '@/lib/auth';
import { openWeek } from '@/lib/actions/weeks';
import { createClient } from '@/lib/supabase/server';
import { formatRange, todayIn, weekOf } from '@/lib/dates';
import { formatTotals } from '@/lib/money';
import { isEmpty } from '@/lib/sundays';
import type { WeekAmount } from '@/lib/database.types';
import { hasMovements, weekTotals } from '@/lib/weeks';
import { ActionForm } from '@/components/form';
import { Badge, Card, EmptyState, Field, Input, PageHeader, Select } from '@/components/ui';

export const metadata = { title: 'Semanal' };

export default async function WeeksPage(props: PageProps<'/[slug]/semanal'>) {
  const { slug } = await props.params;
  const { organization, campuses, campusId, role } = await requireOrg(slug);
  const writes = canWrite(role);

  // Sugerencia para el formulario, no una regla: la semana martes a lunes
  // que corre hoy. Las dos fechas se editan.
  const suggested = weekOf(todayIn(organization.timezone));

  const supabase = await createClient();
  // Quien esta acotado a un campus ve solo las semanas de ese campus. RLS ya
  // lo recorta; el filtro esta para que la consulta diga lo mismo que la
  // pantalla.
  const query = supabase
    .from('weeks')
    .select('id, start_date, end_date, status, campus_id')
    .eq('organization_id', organization.id);

  if (campusId) query.eq('campus_id', campusId);

  const { data: weeks } = await query
    .order('start_date', { ascending: false })
    .limit(30);

  const ids = (weeks ?? []).map((w) => w.id);
  const { data: amounts } = ids.length
    ? await supabase.from('week_amounts').select('*').in('week_id', ids)
    : { data: [] as WeekAmount[] };

  const rowsByWeek = new Map<string, WeekAmount[]>();
  for (const row of amounts ?? []) {
    rowsByWeek.set(row.week_id, [...(rowsByWeek.get(row.week_id) ?? []), row]);
  }

  const campusName = (id: string) => campuses.find((c) => c.id === id)?.name ?? 'Campus';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Semanal"
        subtitle="Libro general por período. Se carga aparte de Domingos."
      />

      {writes ? (
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-medium text-zinc-900">Abrir un período</h2>
          <ActionForm
            action={openWeek}
            submitLabel="Abrir período"
            fieldsClassName="flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="slug" value={slug} />
            {/*
              Viene precargada la semana martes a lunes en curso porque es lo
              que se venía usando, pero son dos fechas sueltas: el período es
              el que elijas — una quincena, un mes, lo que sea.
            */}
            <Field label="Desde">
              <Input
                name="start_date"
                type="date"
                defaultValue={suggested.start}
                className="w-44"
                required
              />
            </Field>
            <Field label="Hasta" hint="El período que quieras. No puede pisarse con otro del campus.">
              <Input
                name="end_date"
                type="date"
                defaultValue={suggested.end}
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
          </ActionForm>
        </Card>
      ) : null}

      {(weeks ?? []).length === 0 ? (
        <EmptyState
          title="Todavía no abriste ningún período."
          description="Elegí desde y hasta arriba. Un gasto solo entra al libro si su fecha cae adentro de un período abierto."
        />
      ) : (
        <Card className="divide-y divide-zinc-100">
          {(weeks ?? []).map((week) => {
            const totals = weekTotals(rowsByWeek.get(week.id));

            return (
              <Link
                key={week.id}
                href={`/${slug}/semanal/${week.id}`}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-zinc-50"
              >
                <div>
                  <p className="text-sm font-medium text-zinc-900">
                    {formatRange({ start: week.start_date, end: week.end_date })}
                  </p>
                  <p className="text-xs text-zinc-500">{campusName(week.campus_id)}</p>
                </div>

                <div className="flex items-center gap-4">
                  {hasMovements(totals) ? (
                    <div className="text-right">
                      <p className="text-sm font-medium tabular-nums text-zinc-900">
                        {formatTotals(totals.balance)}
                      </p>
                      {isEmpty(totals.expense) ? null : (
                        <p className="text-xs text-zinc-500">
                          Ingresos {formatTotals(totals.income)} · Egresos{' '}
                          {formatTotals(totals.expense)}
                        </p>
                      )}
                    </div>
                  ) : (
                    <span className="text-sm text-zinc-500">Sin movimientos</span>
                  )}
                  <Badge tone={week.status === 'closed' ? 'green' : 'amber'}>
                    {week.status === 'closed' ? 'Cerrado' : 'Abierto'}
                  </Badge>
                </div>
              </Link>
            );
          })}
        </Card>
      )}

      <p className="text-xs text-zinc-500">
        Los períodos no se abren solos. Un pago o una compra cuya fecha no caiga en ninguno no se
        registra hasta que lo abras.
      </p>
    </div>
  );
}
