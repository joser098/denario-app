import { canAdmin, requireOrg } from '@/lib/auth';
import { regenerateRequestToken } from '@/lib/actions/settings';
import { siteOrigin } from '@/lib/site';
import { SubmitButton } from '@/components/form';
import { CopyField } from '@/components/copy-field';
import { NavTabs, type NavItem } from '@/components/nav';
import { Card, PageHeader } from '@/components/ui';

export default async function ExpensesLayout(props: LayoutProps<'/[slug]/gastos'>) {
  const { slug } = await props.params;
  const { organization, role } = await requireOrg(slug);
  const origin = await siteOrigin();

  const items: NavItem[] = [
    { href: `/${slug}/gastos`, label: 'Compras', exact: true },
    { href: `/${slug}/gastos/presupuestos`, label: 'Presupuestos' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Gastos"
        subtitle="Pedidos que llegan por el link público. Al cerrarlos, el gasto va al libro semanal."
      />

      {/* El link vive acá y no en Configuración: es lo que se comparte todo
          el tiempo, y es donde uno lo busca cuando piensa en pedidos. */}
      <Card className="flex flex-wrap items-end justify-between gap-4 p-5">
        <div className="min-w-0 flex-1">
          <p className="mb-2 text-xs font-medium text-zinc-500">
            Link para pedir — compartilo con los encargados de cada equipo, no necesitan cuenta
          </p>
          <CopyField value={`${origin}/p/${organization.public_request_token}`} />
        </div>

        {canAdmin(role) ? (
          <form action={regenerateRequestToken}>
            <input type="hidden" name="slug" value={slug} />
            <SubmitButton variant="ghost" confirm="El link actual deja de funcionar. ¿Seguimos?">
              Generar uno nuevo
            </SubmitButton>
          </form>
        ) : null}
      </Card>

      <div className="border-b border-zinc-200">
        <NavTabs items={items} />
      </div>

      {props.children}
    </div>
  );
}
