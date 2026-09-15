import Link from 'next/link';
import { canAdmin, requireOrg } from '@/lib/auth';
import { deletePeriod, openPeriod } from '@/lib/actions/weeks';
import { createClient } from '@/lib/supabase/server';
import { formatRange, todayIn, weekOf } from '@/lib/dates';
import { formatTotals } from '@/lib/money';
import { isEmpty } from '@/lib/sundays';
import type { WeekAmount, WeekCount } from '@/lib/database.types';
import { hasMovements, weekTotals } from '@/lib/weeks';
import { ActionForm } from '@/components/form';
import { Badge, Card, EmptyState, Field, Input, PageHeader } from '@/components/ui';

export const metadata = { title: 'Semanal' };

export default async function WeeksPage(props: PageProps<'/[slug]/semanal'>) {
  const { slug } = await props.params;
  const { organization, campuses, campusId, role } = await requireOrg(slug);
  // El período es de toda la organización: lo abre un administrador y se abre
  // igual en todos los campus. El tesorero carga adentro del que ya está.
  const admin = canAdmin(role);

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
    .limit(60);

  const ids = (weeks ?? []).map((w) => w.id);
  // Los conteos van aparte de los montos: transacciones y sobres no son
  // plata, pero son algo cargado — un período que los tiene no está vacío.
  const [{ data: amounts }, { data: counted }] = ids.length
    ? await Promise.all([
        supabase.from('week_amounts').select('*').in('week_id', ids),
        supabase.from('week_counts').select('*').in('week_id', ids),
      ])
    : [{ data: [] as WeekAmount[] }, { data: [] as WeekCount[] }];

  const rowsByWeek = new Map<string, WeekAmount[]>();
  for (const row of amounts ?? []) {
    rowsByWeek.set(row.week_id, [...(rowsByWeek.get(row.week_id) ?? []), row]);
  }

  const touched = new Set([
    ...(amounts ?? []).map((row) => row.week_id),
    ...(counted ?? []).filter((row) => row.movements > 0).map((row) => row.week_id),
  ]);

  // Un período es el mismo tramo de calendario en todos los campus, así que
  // la lista lo muestra una sola vez con sus campus adentro. Cuatro filas
  // repitiendo las mismas fechas no dejaban ver cuántos períodos había.
  const periods = new Map<string, { start: string; end: string; weeks: typeof weeks }>();
  for (const week of weeks ?? []) {
    const key = `${week.start_date}|${week.end_date}`;
    const period = periods.get(key) ?? {
      start: week.start_date,
      end: week.end_date,
      weeks: [] as typeof weeks,
    };
    period.weeks!.push(week);
    periods.set(key, period);
  }

  /**
   * Un período que nadie tocó: ningún campus lo cerró y no tiene nada
   * cargado. Recién ahí se ofrece borrarlo, igual que con un domingo — con
   * un movimiento adentro ya es un libro y lo que se hace es corregirlo.
   *
   * El servidor vuelve a comprobarlo, y además mira los Profit & Loss: uno
   * puede tener números tipeados a mano aunque el período esté vacío.
   */
  const untouched = (period: { weeks: typeof weeks }) =>
    (period.weeks ?? []).every((week) => week.status === 'open' && !touched.has(week.id));

  const campusName = (id: string) => campuses.find((c) => c.id === id)?.name ?? 'Campus';

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Semanal"
        subtitle="El libro general. Recibe los domingos y alimenta el Profit & Loss."
      />

      {admin ? (
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-medium text-zinc-900">Abrir un período</h2>
          <ActionForm
            action={openPeriod}
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
            <Field label="Hasta" hint="No puede pisarse con otro período.">
              <Input
                name="end_date"
                type="date"
                defaultValue={suggested.end}
                className="w-44"
                required
              />
            </Field>
            <p className="w-full text-xs text-zinc-500 sm:w-auto sm:self-center">
              Se abre en todos los campus, y cada uno arranca su Profit &amp; Loss con estas
              mismas fechas.
            </p>
          </ActionForm>
        </Card>
      ) : null}

      {(weeks ?? []).length === 0 ? (
        <EmptyState
          title="Todavía no hay ningún período abierto."
          description={
            admin
              ? 'Elegí desde y hasta arriba. Sin un período abierto no se puede cerrar un domingo ni registrar un gasto.'
              : 'Los abre un administrador. Sin un período abierto no se puede cerrar un domingo ni registrar un gasto.'
          }
        />
      ) : (
        <div className="flex flex-col gap-5">
          {[...periods.values()].map((period) => (
            <section key={`${period.start}|${period.end}`} className="flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-zinc-900">
                  {formatRange({ start: period.start, end: period.end })}
                </h2>

                {admin && untouched(period) ? (
                  <ActionForm
                    action={deletePeriod}
                    submitLabel="Borrar período"
                    submitVariant="ghost"
                    confirm={`Se borra el período ${formatRange({
                      start: period.start,
                      end: period.end,
                    })} en todos los campus, con sus Profit & Loss. ¿Seguimos?`}
                    className="items-end"
                  >
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="start_date" value={period.start} />
                  </ActionForm>
                ) : null}
              </div>

              <Card className="divide-y divide-zinc-100">
                {(period.weeks ?? []).map((week) => {
                  const totals = weekTotals(rowsByWeek.get(week.id));

                  return (
                    <Link
                      key={week.id}
                      href={`/${slug}/semanal/${week.id}`}
                      className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-zinc-50"
                    >
                      <p className="text-sm font-medium text-zinc-900">
                        {campusName(week.campus_id)}
                      </p>

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
            </section>
          ))}
        </div>
      )}

      <p className="text-xs text-zinc-500">
        Los períodos no se abren solos. Un domingo, un pago o una compra cuya fecha no caiga en
        ninguno no se puede registrar hasta que un administrador lo abra.
      </p>
    </div>
  );
}
