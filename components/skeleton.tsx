/**
 * Bloques grises con el tamaño aproximado de lo que viene.
 *
 * No es decoración: cada pantalla hace entre tres y seis consultas a
 * Supabase, y hasta ahora la navegación se quedaba congelada sin decir nada.
 * `aria-hidden` porque la forma no significa nada para quien no la ve — el
 * anuncio de "cargando" lo hace el texto de al lado.
 */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-zinc-200 ${className}`} />;
}

/** El esqueleto genérico de una pantalla: encabezado y una lista. */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-6">
      <span className="sr-only" role="status">
        Cargando…
      </span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-52" />
        <Skeleton className="h-4 w-72" />
      </div>

      <div className="flex flex-col gap-px overflow-hidden rounded-xl border border-zinc-200 bg-white">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="flex flex-col gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-6 w-28" />
          </div>
        ))}
      </div>
    </div>
  );
}
