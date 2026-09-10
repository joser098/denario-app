import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { formatLong } from '@/lib/dates';
import { CHANGELOG, KIND_LABEL, KIND_TONE } from '@/lib/changelog';
import { Badge, Card, EmptyState } from '@/components/ui';

export const metadata = { title: 'Novedades' };

/**
 * Las notas de version, para quien usa la app.
 *
 * Cuelga de la raiz y no de la organizacion, y no esta en el menu: se llega
 * escribiendo /changelog o siguiendo el link que alguien pasa. Es a proposito
 * — no es una pantalla de trabajo y no tiene por que competir por un lugar en
 * la barra con las que si lo son.
 *
 * No consulta nada: el contenido esta en lib/changelog.ts y viaja con el
 * deploy. Pide sesion igual, porque describe como se trabaja adentro.
 */
export default async function ChangelogPage() {
  await requireUser();

  return (
    <main className="flex flex-1 justify-center px-4 py-10">
      <div className="flex w-full max-w-3xl flex-col gap-6">
        <div className="flex flex-col gap-1">
          <Link href="/" className="text-sm text-zinc-500 hover:text-zinc-900">
            ← Volver
          </Link>
          <h1 className="text-3xl font-bold tracking-tight text-navy-900">Novedades</h1>
          <p className="text-sm text-zinc-500">
            Lo que fue cambiando en Denario, de lo más nuevo a lo más viejo.
          </p>
        </div>

        {CHANGELOG.length === 0 ? (
          <EmptyState title="Todavía no hay novedades para contar." />
        ) : (
          CHANGELOG.map((release) => (
            <section key={release.date} className="flex flex-col gap-3">
              <h2 className="text-sm font-medium text-zinc-500">{formatLong(release.date)}</h2>

              <Card className="divide-y divide-zinc-100">
                {release.changes.map((change) => (
                  <article key={change.title} className="flex flex-col gap-2 p-5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={KIND_TONE[change.kind]}>{KIND_LABEL[change.kind]}</Badge>
                      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                        {change.area}
                      </span>
                    </div>

                    <h3 className="text-sm font-semibold text-zinc-900">{change.title}</h3>
                    <p className="text-sm leading-relaxed text-zinc-600">{change.detail}</p>

                    {/*
                      Lo que hay que hacer distinto va aparte y destacado: es lo
                      unico de toda la entrada que le pide algo al que lee.
                    */}
                    {change.action ? (
                      <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        {change.action}
                      </p>
                    ) : null}
                  </article>
                ))}
              </Card>
            </section>
          ))
        )}
      </div>
    </main>
  );
}
