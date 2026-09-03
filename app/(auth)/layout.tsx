import type { ReactNode } from 'react';

/**
 * Pantallas de acceso: panel de marca a la izquierda y formulario a la
 * derecha. En telefono el panel desaparece y queda solo el formulario con
 * una marca chica arriba.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1">
      {/* Panel de marca: no aporta nada a quien no lo ve, y repetirlo antes
          del formulario obligaria a saltearlo en cada pantalla de acceso. */}
      <div
        aria-hidden="true"
        className="brand-gradient hidden w-1/2 flex-col justify-between p-12 text-white lg:flex xl:p-16"
      >
        <Mark className="size-16 border-2 border-white/70 text-xl" />

        <div>
          <p className="text-5xl font-bold tracking-tight">Tesorería clara.</p>
          <p className="mt-4 max-w-sm text-lg text-white/75">
            Las ofrendas de cada domingo y el libro semanal, en un solo lugar.
          </p>
        </div>

        <p className="text-sm text-white/60">© Denario</p>
      </div>

      <main className="flex flex-1 items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-10 flex items-center gap-3 lg:hidden">
            <Mark className="size-11 bg-brand-500 text-base" />
            <span className="text-lg font-semibold text-navy-900">Denario</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

function Mark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`grid shrink-0 place-items-center rounded-full font-semibold text-white ${className}`}
    >
      D
    </span>
  );
}
