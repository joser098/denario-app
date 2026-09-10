import Link from 'next/link';
import { canAdmin, requireOrg } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import {
  formatDayMonth,
  formatLong,
  formatMonth,
  formatRange,
  sameMonth,
  todayIn,
} from '@/lib/dates';
import { formatAmount, formatMoney, formatTotals } from '@/lib/money';
import { isEmpty, summarize, type Totals } from '@/lib/sundays';
import { hasMovements, weekTotals } from '@/lib/weeks';
import type { MeetingAmount, WeekAmount } from '@/lib/database.types';
import { CampusPicker } from '@/components/campus-picker';
import { Badge, Card, LinkButton, PageHeader } from '@/components/ui';

export default async function OrgHomePage(props: PageProps<'/[slug]'>) {
  const { slug } = await props.params;
  const { campus: campusParam } = await props.searchParams;
  const { organization, campuses, campusId, role } = await requireOrg(slug);

  const today = todayIn(organization.timezone);

  const supabase = await createClient();
  const [{ data: recentSundays }, { data: currentWeeks }, { count: members }] = await Promise.all([
    // Se traen los ultimos domingos de todos los campus de una: son pocos, y
    // asi el campus por defecto sale de los mismos datos, sin otra consulta.
    supabase
      .from('sundays')
      .select('id, service_date, status, campus_id')
      .eq('organization_id', organization.id)
      .order('service_date', { ascending: false })
      .limit(60),
    // El periodo que contiene hoy, que ya no es una semana fija: lo abrio
    // alguien eligiendo desde y hasta. Uno por campus como mucho — la base no
    // deja que dos se pisen. Cual se muestra depende del campus elegido mas
    // abajo, asi que se traen todos y se filtra despues.
    supabase
      .from('weeks')
      .select('id, status, campus_id, start_date, end_date')
      .eq('organization_id', organization.id)
      .lte('start_date', today)
      .gte('end_date', today),
    supabase
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organization.id),
  ]);

  // RLS ya recorta por campus; el filtro queda porque `visible` tambien
  // decide el campus por defecto y cual se puede elegir.
  const visible = new Set(campuses.map((c) => c.id));
  const sundays = (recentSundays ?? []).filter((s) => visible.has(s.campus_id));

  // El miembro atado a un campus no elige: es el suyo. El que ve todos arranca
  // en el campus del domingo mas reciente, que es el dato que viene a mirar.
  const requested = typeof campusParam === 'string' && visible.has(campusParam) ? campusParam : null;
  const selectedCampus = campusId ?? requested ?? sundays[0]?.campus_id ?? campuses[0]?.id ?? null;
  const campusName = campuses.find((c) => c.id === selectedCampus)?.name ?? 'Sin campus';
  const canSwitchCampus = !campusId && campuses.length > 1;

  const campusSundays = sundays.filter((s) => s.campus_id === selectedCampus);
  const [lastSunday, previousSunday] = campusSundays;

  // El grafico muestra el mes del ultimo domingo cargado, no el mes del
  // calendario: si hoy es 2 de septiembre y todavia no hubo domingo, el mes
  // corriente esta vacio y la pantalla no diria nada.
  //
  // Con un solo domingo en el mes no hay comparacion posible, asi que se suma
  // el anterior: una columna sola no es un grafico.
  const monthSundays = lastSunday
    ? campusSundays.filter((s) => sameMonth(s.service_date, lastSunday.service_date))
    : [];
  const charted = (monthSundays.length > 1 ? monthSundays : campusSundays.slice(0, 2))
    .slice()
    .reverse();

  const sundayIds = charted.map((s) => s.id);
  // El libro semanal es del campus: sumar los de todos los campus no da un
  // numero que signifique nada, porque cada uno puede llevar otra moneda.
  const campusWeeks = (currentWeeks ?? []).filter((w) => w.campus_id === selectedCampus);
  const weekIds = campusWeeks.map((w) => w.id);
  const [{ data: sundayAmounts }, { data: weekRows }] = await Promise.all([
    sundayIds.length
      ? supabase.from('meeting_amounts').select('*').in('sunday_id', sundayIds)
      : Promise.resolve({ data: [] as MeetingAmount[] }),
    weekIds.length
      ? supabase.from('week_amounts').select('*').in('week_id', weekIds)
      : Promise.resolve({ data: [] as WeekAmount[] }),
  ]);

  const sundaySummary = (id: string | undefined) =>
    summarize(id ? (sundayAmounts ?? []).filter((a) => a.sunday_id === id) : []);

  const lastSummary = sundaySummary(lastSunday?.id);
  const lastTotals = lastSummary.total;
  const previousTotals = sundaySummary(previousSunday?.id).total;
  const points = charted.map((s) => {
    const summary = sundaySummary(s.id);
    // Un domingo todavia sin cargar no es un cero: es un dato que falta, y en
    // el grafico se distingue asi de una reunion que si se conto y dio cero.
    return { date: s.service_date, totals: summary.total, loaded: !isEmpty(summary.moved) };
  });
  const weekBalance = weekTotals(weekRows);
  const openWeek = campusWeeks.some((w) => w.status === 'open');
  // Si no hay periodo abierto para hoy no hay rango que mostrar: antes se
  // pintaba igual el martes-lunes calculado, que no correspondia a nada.
  const currentWeek = campusWeeks[0];
  const weekRange = currentWeek
    ? formatRange({ start: currentWeek.start_date, end: currentWeek.end_date })
    : 'Sin período abierto';

  return (
    <div className="flex flex-col gap-6">
      {/* Un solo selector para toda la pantalla: Domingos, Semanal y el
          grafico miran siempre el mismo campus. Tener uno por tarjeta seria
          invitar a comparar numeros de campus distintos sin darse cuenta. */}
      <PageHeader
        title="Resumen"
        subtitle={formatLong(today)}
        actions={
          canSwitchCampus ? (
            <CampusPicker campuses={campuses} value={selectedCampus ?? ''} />
          ) : (
            <span className="self-center text-sm font-medium text-zinc-900">{campusName}</span>
          )
        }
      />

      <div className="grid items-start gap-4 sm:grid-cols-2">
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-zinc-500">Último domingo</h2>
            {lastSunday ? (
              <Badge tone={lastSunday.status === 'closed' ? 'green' : 'amber'}>
                {lastSunday.status === 'closed' ? 'Cerrado' : 'Borrador'}
              </Badge>
            ) : null}
          </div>

          {lastSunday ? (
            <div>
              {/* Un domingo abierto sin nada cargado no vale "$ 0": eso se lee
                  como que se conto y no entro plata. */}
              <p
                className={`text-2xl font-semibold ${
                  isEmpty(lastSummary.moved) ? 'text-zinc-500' : 'text-zinc-900'
                }`}
              >
                {isEmpty(lastSummary.moved) ? 'Sin movimientos' : formatTotals(lastTotals)}
              </p>
              <p className="text-xs text-zinc-500">
                {formatLong(lastSunday.service_date)}
                {isEmpty(lastSummary.moved) ? null : ' · sin contar ventas'}
              </p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Todavía no cargaste ninguno.</p>
          )}

          <LinkButton href={`/${slug}/domingos`} className="self-start">
            Ir a Domingos
          </LinkButton>
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-medium text-zinc-500">Período en curso</h2>
            {weekIds.length === 0 ? null : (
              <Badge tone={openWeek ? 'amber' : 'green'}>{openWeek ? 'Abierto' : 'Cerrado'}</Badge>
            )}
          </div>

          {hasMovements(weekBalance) ? (
            <div>
              <p className="text-2xl font-semibold text-zinc-900">
                {formatTotals(weekBalance.balance)}
              </p>
              <p className="text-xs text-zinc-500">
                {weekRange}
                {isEmpty(weekBalance.expense)
                  ? null
                  : ` · ingresos ${formatTotals(weekBalance.income)} · egresos ${formatTotals(weekBalance.expense)}`}
              </p>
            </div>
          ) : (
            <div>
              <p className="text-2xl font-semibold text-zinc-500">
                {currentWeek ? 'Sin movimientos' : 'Sin período'}
              </p>
              <p className="text-xs text-zinc-500">{weekRange}</p>
            </div>
          )}

          <LinkButton href={`/${slug}/semanal`} className="self-start">
            Ir a Semanal
          </LinkButton>
        </Card>
      </div>

      {points.length > 1 && lastSunday ? (
        <SundayChart
          points={points}
          month={lastSunday.service_date}
          last={lastTotals}
          previous={previousTotals}
        />
      ) : null}

      <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 p-5">
        <Stat label="Campus" value={campuses.length} />
        <Stat label="Personas con acceso" value={members ?? 0} />
        {canAdmin(role) ? (
          <Link
            href={`/${slug}/configuracion`}
            className="ml-auto text-sm font-medium text-zinc-900 hover:underline"
          >
            Configuración →
          </Link>
        ) : null}
      </Card>
    </div>
  );
}

type SundayPoint = { date: string; totals: Totals; loaded: boolean };

/**
 * Los domingos del mes, en columnas.
 *
 * El ultimo va en azul y el resto en gris: no son series distintas, es la
 * misma medida a lo largo del mes y la ultima es la que se viene a mirar.
 * Cada columna lleva su monto en la punta y su fecha abajo, asi que el color
 * no es el unico canal y no hace falta leyenda ni tooltip.
 *
 * Un grafico por moneda, cada uno con su escala: ARS y USD no se suman ni
 * comparten eje, igual que en el resto de la app.
 */
function SundayChart({
  points,
  month,
  last,
  previous,
}: {
  points: SundayPoint[];
  month: string;
  last: Totals;
  previous: Totals;
}) {
  const currencies = [...new Set(points.flatMap((p) => Object.keys(p.totals)))]
    .filter((c) => points.some((p) => (p.totals[c] ?? 0) !== 0))
    .sort();

  if (currencies.length === 0) return null;

  return (
    <Card className="flex flex-col gap-5 p-5">
      <div>
        <h2 className="text-sm font-medium text-zinc-900 first-letter:uppercase">
          Domingos de {formatMonth(month)}
        </h2>
        <p className="text-xs text-zinc-500">
          Total de cada domingo, sin contar ventas. Cada moneda con su propia escala.
        </p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        {currencies.map((currency) => {
          const max = Math.max(...points.map((p) => p.totals[currency] ?? 0));
          const now = last[currency] ?? 0;
          const before = previous[currency] ?? 0;

          return (
            <div key={currency} className="flex flex-col gap-3">
              <p className="text-xs font-medium text-zinc-500">{currency}</p>

              {/* El alto reservado arriba es para la etiqueta de la columna mas
                  alta: sin el, una columna al 100% empujaria su monto fuera. */}
              <div className="flex items-end gap-2 border-b border-zinc-200 pt-6">
                {points.map((point, index) => (
                  <Column
                    key={point.date}
                    date={point.date}
                    amount={point.totals[currency] ?? 0}
                    max={max}
                    loaded={point.loaded}
                    accent={index === points.length - 1}
                  />
                ))}
              </div>

              <p className="text-xs text-zinc-500">{delta(now, before, currency)}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function Column({
  date,
  amount,
  max,
  loaded,
  accent = false,
}: {
  date: string;
  amount: number;
  max: number;
  loaded: boolean;
  accent?: boolean;
}) {
  // Un monto chico pero real no puede quedar en una columna invisible.
  const share = max > 0 ? (amount / max) * 100 : 0;
  const height = amount > 0 ? Math.max(share, 2) : 0;

  return (
    <div className="flex min-w-0 flex-1 flex-col items-center gap-2">
      <div className="relative h-28 w-full">
        <div
          className={`absolute bottom-0 left-1/2 w-6 -translate-x-1/2 rounded-t-[4px] ${
            accent ? 'bg-brand-500' : 'bg-zinc-500'
          }`}
          style={{ height: `${height}%` }}
        >
          <span
            className={`absolute -top-5 left-1/2 -translate-x-1/2 text-[11px] tabular-nums whitespace-nowrap ${
              loaded ? 'text-zinc-900' : 'text-zinc-500'
            }`}
          >
            {loaded ? formatAmount(amount) : '—'}
          </span>
        </div>
      </div>
      <span className="text-[11px] whitespace-nowrap text-zinc-500">{formatDayMonth(date)}</span>
    </div>
  );
}

/** El cambio contra el domingo anterior, en palabras y sin juzgarlo. */
function delta(now: number, before: number, currency: string): string {
  if (now === before) return 'Igual que el domingo anterior.';

  const difference = now - before;
  const sign = difference > 0 ? '↑' : '↓';
  const absolute = formatMoney(Math.abs(difference), currency);

  // Sin base no hay porcentaje: contra cero, cualquier variacion es infinita.
  if (before === 0) return `${sign} ${absolute} contra un domingo anterior sin movimientos.`;

  const percent = formatAmount(Math.round(Math.abs(difference / before) * 1000) / 10);
  return `${sign} ${percent}% (${absolute}) contra el domingo anterior.`;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-2xl font-semibold text-zinc-900">{value}</p>
      <p className="text-sm text-zinc-500">{label}</p>
    </div>
  );
}
