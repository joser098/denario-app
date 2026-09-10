import type { Metadata } from 'next';
import Image from 'next/image';
import Link from 'next/link';
import { signOut } from '@/lib/actions/auth';
import { canAdmin, requireOrg, ROLE_LABELS } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { logoUrl } from '@/lib/logo';
import { Icon, SidebarNav, type NavItem } from '@/components/nav';

/**
 * El titulo de cada pantalla.
 *
 * Todas las pantallas de adentro decian "Denario", asi que la pestaña y el
 * historial no distinguian ninguna — y con dos iglesias abiertas a la vez,
 * tampoco cual era cual. El template pone el nombre de la organizacion y
 * cada pagina solo declara su seccion.
 */
export async function generateMetadata(props: LayoutProps<'/[slug]'>): Promise<Metadata> {
  const { slug } = await props.params;
  const supabase = await createClient();
  const { data } = await supabase
    .from('organizations')
    .select('name')
    .eq('slug', slug)
    .maybeSingle();

  const name = data?.name ?? 'Denario';
  // `template` aplica a los segmentos hijos; la pagina de este mismo
  // segmento (el Resumen) cae en `default`, por eso lleva su nombre.
  return { title: { template: `%s · ${name}`, default: `Resumen · ${name}` } };
}

export default async function OrgLayout(props: LayoutProps<'/[slug]'>) {
  const { slug } = await props.params;
  const { organization, role, email } = await requireOrg(slug);

  const items: NavItem[] = [
    { href: `/${slug}`, label: 'Resumen', icon: 'resumen', exact: true },
    { href: `/${slug}/domingos`, label: 'Domingos', icon: 'domingos' },
    { href: `/${slug}/semanal`, label: 'Semanal', icon: 'semanal' },
    { href: `/${slug}/gastos`, label: 'Gastos', icon: 'gastos' },
    { href: `/${slug}/reportes`, label: 'Profit & Loss', icon: 'reportes' },
  ];
  if (canAdmin(role)) {
    items.push(
      { href: `/${slug}/actas`, label: 'Actas', icon: 'actas' },
      { href: `/${slug}/usuarios`, label: 'Usuarios', icon: 'usuarios' },
      { href: `/${slug}/configuracion`, label: 'Configuración', icon: 'configuracion' },
    );
  }

  const logo = logoUrl(organization.logo_path);

  return (
    <div className="flex min-h-full flex-1 flex-col lg:flex-row">
      {/*
        En escritorio la barra se clava al viewport: sin esto se iba con el
        scroll de la pagina y "Cerrar sesion" quedaba abajo de todo, fuera de
        la vista. `self-start` es necesario para que el stretch del flex no
        pise la altura, que es lo que hace posible el sticky. En mobile la
        barra va arriba y no cambia nada.
      */}
      <aside className="flex flex-col bg-navy-900 lg:sticky lg:top-0 lg:h-dvh lg:w-64 lg:shrink-0 lg:self-start">
        <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-5 lg:pb-2">
          <Link href={`/${slug}`} className="flex min-w-0 items-center gap-3">
            {logo ? (
              <Image
                src={logo}
                alt=""
                width={36}
                height={36}
                className="size-9 shrink-0 rounded-full bg-white object-contain"
              />
            ) : (
              <span className="grid size-9 shrink-0 place-items-center rounded-full border border-navy-700 text-sm font-semibold text-white">
                {organization.name.slice(0, 1).toUpperCase()}
              </span>
            )}
            <span className="truncate text-base font-semibold text-white">
              {organization.name}
            </span>
          </Link>

          <form action={signOut} className="lg:hidden">
            <button
              type="submit"
              title="Cerrar sesión"
              className="p-2 text-navy-300 hover:text-white"
            >
              <Icon name="salir" />
            </button>
          </form>
        </div>

        <SidebarNav items={items} />

        <div className="mt-auto hidden border-t border-navy-800 px-5 py-4 lg:block">
          <p className="truncate text-sm text-white">{email}</p>
          <p className="text-xs text-navy-300">{ROLE_LABELS[role]}</p>
          <form action={signOut} className="mt-3">
            <button
              type="submit"
              className="flex items-center gap-2 text-sm text-navy-300 transition-colors hover:text-white"
            >
              <Icon name="salir" />
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 px-4 py-6 lg:px-10 lg:py-10">
        <div className="mx-auto w-full max-w-5xl">{props.children}</div>
      </main>
    </div>
  );
}
