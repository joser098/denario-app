import { redirect } from 'next/navigation';
import { canAdmin, requireOrg } from '@/lib/auth';
import { NavTabs, type NavItem } from '@/components/nav';
import { PageHeader } from '@/components/ui';

export default async function SettingsLayout(props: LayoutProps<'/[slug]/configuracion'>) {
  const { slug } = await props.params;
  const { role } = await requireOrg(slug);

  // Tesoreros y lectores no configuran nada.
  if (!canAdmin(role)) redirect(`/${slug}`);

  const items: NavItem[] = [
    { href: `/${slug}/configuracion`, label: 'Organización', exact: true },
    { href: `/${slug}/configuracion/campus`, label: 'Campus' },
    { href: `/${slug}/configuracion/reuniones`, label: 'Reuniones' },
    { href: `/${slug}/configuracion/productos`, label: 'Productos' },
    { href: `/${slug}/configuracion/conceptos`, label: 'Conceptos' },
    { href: `/${slug}/configuracion/equipos`, label: 'Equipos' },
    { href: `/${slug}/configuracion/medios-de-pago`, label: 'Medios de pago' },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Configuración" />
      <div className="border-b border-zinc-200">
        <NavTabs items={items} />
      </div>
      {props.children}
    </div>
  );
}
