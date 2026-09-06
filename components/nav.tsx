'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export type NavItem = { href: string; label: string; icon?: IconName; exact?: boolean };

function isActive(pathname: string, item: NavItem) {
  return item.exact
    ? pathname === item.href
    : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/** Sub-navegacion en pestañas (dentro de Configuración). */
export function NavTabs({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto">
      {items.map((item) => {
        const active = isActive(pathname, item);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={[
              'whitespace-nowrap border-b-2 px-3 py-3 text-sm font-medium transition-colors',
              active
                ? 'border-brand-500 text-brand-600'
                : 'border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900',
            ].join(' ')}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Navegacion principal. En pantalla grande es la columna del sidebar; en
 * telefono, una fila que se desplaza. Misma marcacion en los dos casos.
 */
export function SidebarNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  // En mobile es una tira horizontal que se desliza. En escritorio ocupa el
  // alto que sobra entre el encabezado y el pie de la barra; solo aparece
  // scroll si la pantalla es tan baja que los items no entran, y aun asi el
  // pie con "Cerrar sesion" se queda en su lugar.
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto lg:py-4">
      {items.map((item) => {
        const active = isActive(pathname, item);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={[
              'flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
              'border-l-[3px]',
              active
                ? 'border-brand-500 bg-navy-800 text-white'
                : 'border-transparent text-navy-300 hover:bg-navy-800/60 hover:text-white',
            ].join(' ')}
          >
            {item.icon ? <Icon name={item.icon} /> : null}
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

// ---------- Iconos ----------
// Trazos simples, dibujados a mano: una libreria entera para cinco iconos
// serian cientos de kilobytes en el bundle.

export type IconName =
  | 'resumen'
  | 'domingos'
  | 'semanal'
  | 'gastos'
  | 'reportes'
  | 'usuarios'
  | 'configuracion'
  | 'salir';

const PATHS: Record<IconName, ReactNode> = {
  resumen: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  domingos: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 11h18" />
    </>
  ),
  semanal: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </>
  ),
  gastos: (
    <>
      <path d="M4 7h16v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M9 12h6" />
    </>
  ),
  reportes: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </>
  ),
  usuarios: (
    <>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0M17 11.5a3 3 0 0 0 0-6M18 20a5.8 5.8 0 0 0-2-4.2" />
    </>
  ),
  configuracion: (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  salir: (
    <>
      <path d="M9 20H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4M16 16l4-4-4-4M20 12H9" />
    </>
  ),
};

export function Icon({ name }: { name: IconName }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="size-[18px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}
