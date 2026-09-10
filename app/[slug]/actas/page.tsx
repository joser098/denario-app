import Link from 'next/link';
import { requireAdminOrg } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatLong, formatStamp, formatTime, timezoneOf } from '@/lib/dates';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader } from '@/components/ui';

export const metadata = { title: 'Actas' };

/** Cuantos domingos se miran para atras. Alcanza para mas de un año. */
const LIMIT = 200;

type ActaKind = 'acta' | 'caja' | 'cierre';

const KIND_LABEL: Record<ActaKind, string> = {
  acta: 'Conteo de ofrenda',
  caja: 'Caja de ventas',
  cierre: 'Cierre del domingo',
};

const KIND_TONE: Record<ActaKind, 'blue' | 'neutral' | 'green'> = {
  acta: 'blue',
  caja: 'neutral',
  cierre: 'green',
};

type Acta = {
  key: string;
  kind: ActaKind;
  /** El domingo al que pertenece. Es por lo que se ordena y se filtra. */
  date: string;
  campusId: string;
  meeting: string | null;
  who: string | null;
  code: string | null;
  path: string;
  voided: boolean;
  /** Cuando se firmo o se cerro. Null si nunca se registro. */
  at: string | null;
  /**
   * Desempate dentro del mismo domingo: el orden de la reunion. El cierre no
   * es de ninguna reunion y va ultimo, que es cuando pasa.
   */
  order: number;
};

const isDate = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

/**
 * Todas las actas de la organizacion en una sola lista.
 *
 * Son tres cosas distintas guardadas en tres tablas —el conteo de la ofrenda,
 * la caja de ventas y el cierre del domingo— pero para quien las archiva son
 * lo mismo: un PDF firmado, de un campus, de una fecha. Hasta aca habia que
 * entrar domingo por domingo y reunion por reunion para juntarlas.
 *
 * Se arma con consultas planas y se une en memoria en vez de con una vista:
 * son pocas filas, y una vista nueva es una migracion mas sobre una base que
 * ya esta en produccion.
 *
 * El archivo entero es de quien administra. El tesorero sigue llegando al PDF
 * de su propia acta desde Domingos y desde la reunion, que es lo que necesita
 * para trabajar; lo que no tiene es la lista de todas.
 */
export default async function ActasPage(props: PageProps<'/[slug]/actas'>) {
  const { slug } = await props.params;
  const { desde, hasta } = await props.searchParams;
  // Solo owner y admin. `requireAdminOrg` redirige al resumen a cualquier
  // otro rol: esconder el item del sidebar no es una barrera, la URL se
  // escribe a mano.
  const { organization, campuses, campusId } = await requireAdminOrg(slug);

  const from = isDate(desde) ? desde : null;
  const to = isDate(hasta) ? hasta : null;
  const filtered = Boolean(from || to);

  const supabase = await createClient();

  // El domingo es la puerta de entrada: de el salen la fecha y el campus, que
  // son las dos columnas por las que se ordena y se filtra.
  const sundaysQuery = supabase
    .from('sundays')
    .select('id, service_date, campus_id, acta_pdf_path, closed_at')
    .eq('organization_id', organization.id);

  // RLS ya recorta por campus; el filtro esta para que la consulta diga lo
  // mismo que la pantalla.
  if (campusId) sundaysQuery.eq('campus_id', campusId);
  if (from) sundaysQuery.gte('service_date', from);
  if (to) sundaysQuery.lte('service_date', to);

  const { data: sundays } = await sundaysQuery
    .order('service_date', { ascending: false })
    .limit(LIMIT);

  const sundayIds = (sundays ?? []).map((s) => s.id);

  const { data: meetings } = sundayIds.length
    ? await supabase
        .from('sunday_meetings')
        .select('id, sunday_id, label, start_time, sort_order')
        .in('sunday_id', sundayIds)
    : { data: [] };

  const meetingIds = (meetings ?? []).map((m) => m.id);

  // `not('pdf_path', 'is', null)`: sin PDF no hay nada que listar. Un acta en
  // borrador todavia no es un acta.
  const [{ data: counts }, { data: sessions }] = meetingIds.length
    ? await Promise.all([
        supabase
          .from('offering_counts')
          .select('id, meeting_id, public_id, status, pdf_path, finalized_at, volunteer_name')
          .in('meeting_id', meetingIds)
          .not('pdf_path', 'is', null),
        supabase
          .from('meeting_sales_sessions')
          .select('id, meeting_id, seller_name, pdf_path, closed_at')
          .in('meeting_id', meetingIds)
          .not('pdf_path', 'is', null),
      ])
    : [{ data: [] }, { data: [] }];

  const sundayById = new Map((sundays ?? []).map((s) => [s.id, s]));
  const meetingById = new Map((meetings ?? []).map((m) => [m.id, m]));

  const rows: Acta[] = [];

  for (const count of counts ?? []) {
    const meeting = meetingById.get(count.meeting_id);
    const sunday = meeting ? sundayById.get(meeting.sunday_id) : null;
    if (!meeting || !sunday || !count.pdf_path) continue;

    rows.push({
      key: `acta-${count.id}`,
      kind: 'acta',
      date: sunday.service_date,
      campusId: sunday.campus_id,
      meeting: `${meeting.label} (${formatTime(meeting.start_time)})`,
      who: count.volunteer_name,
      code: count.public_id,
      path: count.pdf_path,
      voided: count.status === 'voided',
      at: count.finalized_at,
      order: meeting.sort_order * 10,
    });
  }

  for (const session of sessions ?? []) {
    const meeting = meetingById.get(session.meeting_id);
    const sunday = meeting ? sundayById.get(meeting.sunday_id) : null;
    if (!meeting || !sunday || !session.pdf_path) continue;

    rows.push({
      key: `caja-${session.id}`,
      kind: 'caja',
      date: sunday.service_date,
      campusId: sunday.campus_id,
      meeting: `${meeting.label} (${formatTime(meeting.start_time)})`,
      who: session.seller_name,
      code: null,
      path: session.pdf_path,
      voided: false,
      at: session.closed_at,
      // La caja de una reunion va justo despues del conteo de esa reunion.
      order: meeting.sort_order * 10 + 1,
    });
  }

  for (const sunday of sundays ?? []) {
    if (!sunday.acta_pdf_path) continue;

    rows.push({
      key: `cierre-${sunday.id}`,
      kind: 'cierre',
      date: sunday.service_date,
      campusId: sunday.campus_id,
      meeting: null,
      who: null,
      code: null,
      path: sunday.acta_pdf_path,
      voided: false,
      at: sunday.closed_at,
      order: Number.MAX_SAFE_INTEGER,
    });
  }

  // El domingo mas nuevo arriba; adentro del domingo, en el orden en que
  // pasaron las cosas y con el cierre al final.
  rows.sort((a, b) => b.date.localeCompare(a.date) || a.order - b.order);

  const campusName = (id: string) => campuses.find((c) => c.id === id)?.name ?? 'Campus';
  // La hora de la firma se lee en la del campus que firmo, no en la del
  // servidor: la lista mezcla campus y esta pagina se renderiza en el server.
  const signedAt = (row: Acta) =>
    formatStamp(row.at, timezoneOf(campuses.find((c) => c.id === row.campusId), organization));
  const manyCampuses = campuses.length > 1;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Actas"
        subtitle="Los PDF firmados de conteo, caja y cierre, todos juntos."
      />

      <Card className="p-5">
        {/*
          GET y no una server action: el filtro es un lugar al que se llega,
          no un cambio. Asi la busqueda queda en la URL y se puede compartir o
          dejar en favoritos.
        */}
        <form method="get" className="flex flex-wrap items-end gap-3">
          <Field label="Desde">
            <Input name="desde" type="date" defaultValue={from ?? ''} className="w-44" />
          </Field>
          <Field label="Hasta">
            <Input name="hasta" type="date" defaultValue={to ?? ''} className="w-44" />
          </Field>
          <Button type="submit" variant="secondary">
            Filtrar
          </Button>
          {filtered ? (
            <Link
              href={`/${slug}/actas`}
              className="self-center text-sm text-zinc-500 hover:text-zinc-900"
            >
              Limpiar
            </Link>
          ) : null}
        </form>
        <p className="mt-3 text-xs text-zinc-500">
          Las fechas son las del domingo al que pertenece el acta, no la del día en que se firmó.
        </p>
      </Card>

      {rows.length === 0 ? (
        <EmptyState
          title={filtered ? 'No hay actas en ese rango.' : 'Todavía no hay actas firmadas.'}
          description={
            filtered
              ? 'Probá con otras fechas o limpiá el filtro.'
              : 'Un acta aparece acá cuando se firma y queda su PDF.'
          }
        />
      ) : (
        <Card className="divide-y divide-zinc-100">
          {rows.map((row) => (
            <div
              key={row.key}
              className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-4"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-zinc-900">{formatLong(row.date)}</p>
                  <Badge tone={KIND_TONE[row.kind]}>{KIND_LABEL[row.kind]}</Badge>
                  {row.voided ? <Badge tone="red">Anulada</Badge> : null}
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {[
                    manyCampuses ? campusName(row.campusId) : null,
                    row.meeting,
                    row.who,
                    row.code,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>

              <div className="flex items-center gap-4">
                {row.at ? <span className="text-xs text-zinc-500">{signedAt(row)}</span> : null}
                {/*
                  Ver abre el PDF en una pestaña nueva: quien esta revisando
                  una tanda de actas no quiere perder la lista ni juntar
                  quince archivos en Descargas para mirar uno.
                */}
                <a
                  href={`/${slug}/acta?ver=1&path=${encodeURIComponent(row.path)}`}
                  target="_blank"
                  rel="noopener"
                  className="text-sm font-medium text-zinc-900 hover:underline"
                >
                  Ver
                </a>
                <a
                  href={`/${slug}/acta?path=${encodeURIComponent(row.path)}`}
                  className="text-sm font-medium text-zinc-500 hover:text-zinc-900 hover:underline"
                >
                  Descargar
                </a>
              </div>
            </div>
          ))}
        </Card>
      )}

      {rows.length >= LIMIT ? (
        <p className="text-xs text-zinc-500">
          Se muestran los {LIMIT} domingos más recientes. Filtrá por fecha para ver los anteriores.
        </p>
      ) : null}
    </div>
  );
}
