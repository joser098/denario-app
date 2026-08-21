import Link from 'next/link';
import { canAdmin, requireOrg } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { formatLong, formatRange, todayIn, weekOf } from '@/lib/dates';
import { Badge, Card, LinkButton, PageHeader } from '@/components/ui';

export default async function OrgHomePage(props: PageProps<'/[slug]'>) {
  const { slug } = await props.params;
  const { organization, campuses, role } = await requireOrg(slug);

  const today = todayIn(organization.timezone);
  const week = weekOf(today);

  const supabase = await createClient();
  const [{ data: lastSunday }, { data: currentWeeks }, { count: members }] = await Promise.all([
    supabase
      .from('sundays')
      .select('id, service_date, status')
      .eq('organization_id', organization.id)
      .order('service_date', { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Puede haber una semana por campus mas la de la organizacion. Si alguna
    // sigue abierta, la semana todavia se esta cargando.
    supabase
      .from('weeks')
      .select('id, status')
      .eq('organization_id', organization.id)
      .eq('start_date', week.start),
    supabase
      .from('organization_members')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organization.id),
  ]);

  const weekRows = currentWeeks ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Resumen" subtitle={formatLong(today)} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-500">Último domingo</h2>
            {lastSunday ? (
              <Badge tone={lastSunday.status === 'closed' ? 'green' : 'amber'}>
                {lastSunday.status === 'closed' ? 'Cerrado' : 'Borrador'}
              </Badge>
            ) : null}
          </div>
          <p className="text-lg font-semibold text-zinc-900">
            {lastSunday ? formatLong(lastSunday.service_date) : 'Todavía no cargaste ninguno'}
          </p>
          <LinkButton href={`/${slug}/domingos`} className="self-start">
            Ir a Domingos
          </LinkButton>
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-zinc-500">Semana en curso</h2>
            {weekRows.length === 0 ? null : (
              <Badge tone={weekRows.some((w) => w.status === 'open') ? 'amber' : 'green'}>
                {weekRows.some((w) => w.status === 'open') ? 'Abierta' : 'Cerrada'}
              </Badge>
            )}
          </div>
          <p className="text-lg font-semibold text-zinc-900">{formatRange(week)}</p>
          <LinkButton href={`/${slug}/semanal`} className="self-start">
            Ir a Semanal
          </LinkButton>
        </Card>
      </div>

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

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-2xl font-semibold text-zinc-900">{value}</p>
      <p className="text-sm text-zinc-500">{label}</p>
    </div>
  );
}
