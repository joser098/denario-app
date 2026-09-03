import { canWrite, requireOrg } from '@/lib/auth';
import { regenerateRequestToken } from '@/lib/actions/settings';
import { siteOrigin } from '@/lib/site';
import { SubmitButton } from '@/components/form';
import { CopyField } from '@/components/copy-field';
import { NavTabs, type NavItem } from '@/components/nav';
import { Card, PageHeader } from '@/components/ui';

export default async function ExpensesLayout(props: LayoutProps<'/[slug]/gastos'>) {
  const { slug } = await props.params;
  const { campuses, role } = await requireOrg(slug);
  const origin = await siteOrigin();

  const items: NavItem[] = [
    { href: `/${slug}/gastos`, label: 'Compras', exact: true },
    { href: `/${slug}/gastos/presupuestos`, label: 'Presupuestos' },
    { href: `/${slug}/gastos/pagos`, label: 'Pagos y transferencias' },
    { href: `/${slug}/gastos/efectivo`, label: 'Pagos en efectivo' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Gastos"
        subtitle="Pedidos que llegan por el link del campus. Al cerrarlos, el gasto va al libro semanal."
      />

      {/* Los links viven acá y no en Configuración: es lo que se comparte todo
          el tiempo, y es donde uno lo busca cuando piensa en pedidos. Hay uno
          por campus, y el link solo ya dice de qué campus es el pedido: quien
          pide no elige campus ni se puede equivocar. */}
      <Card className="flex flex-col gap-4 p-5">
        <p className="text-xs font-medium text-zinc-500">
          {campuses.length > 1 ? 'Links para pedir' : 'Link para pedir'} — compartilos con los
          encargados de cada equipo, no necesitan cuenta
        </p>

        {campuses.map((campus) => (
          <div key={campus.id} className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0 flex-1">
              {campuses.length > 1 ? (
                <p className="mb-1.5 text-xs text-zinc-500">{campus.name}</p>
              ) : null}
              <CopyField value={`${origin}/p/${campus.public_request_token}`} />
            </div>

            {canWrite(role) ? (
              <form action={regenerateRequestToken}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="campus_id" value={campus.id} />
                <SubmitButton
                  variant="ghost"
                  confirm="El link actual de este campus deja de funcionar. ¿Seguimos?"
                >
                  Generar uno nuevo
                </SubmitButton>
              </form>
            ) : null}
          </div>
        ))}
      </Card>

      <div className="border-b border-zinc-200">
        <NavTabs items={items} />
      </div>

      {props.children}
    </div>
  );
}
