import Link from 'next/link';
import { notFound } from 'next/navigation';
import { canWrite, requireOrg } from '@/lib/auth';
import {
  addWeekEntry,
  closeWeek,
  deleteWeekEntry,
  reopenWeek,
  updateWeekNotes,
} from '@/lib/actions/weeks';
import { createClient } from '@/lib/supabase/server';
import { formatRange, formatShort } from '@/lib/dates';
import { formatAmount, formatMoney, formatTotals } from '@/lib/money';
import type { WeekConcept, WeekConceptKind } from '@/lib/database.types';
import { ActionForm, SubmitButton } from '@/components/form';
import { WeekEntryForm } from '@/components/week-entry-form';
import { Alert, Badge, Card, EmptyState, Field, PageHeader, Textarea } from '@/components/ui';

export const metadata = { title: 'Período' };

export default async function WeekPage(props: PageProps<'/[slug]/semanal/[weekId]'>) {
  const { slug, weekId } = await props.params;
  const { organization, campuses, role } = await requireOrg(slug);

  const supabase = await createClient();
  const { data: week } = await supabase
    .from('weeks')
    .select('*')
    .eq('id', weekId)
    .eq('organization_id', organization.id)
    .maybeSingle();

  if (!week) notFound();

  const [{ data: concepts }, { data: entries }] = await Promise.all([
    supabase
      .from('week_concepts')
      .select('*')
      .eq('organization_id', organization.id)
      .order('sort_order'),
    supabase.from('week_entries').select('*').eq('week_id', weekId).order('created_at'),
  ]);

  const closed = week.status === 'closed';
  const writes = canWrite(role) && !closed;
  const range = { start: week.start_date, end: week.end_date };
  const scope = campuses.find((c) => c.id === week.campus_id)?.name ?? 'Campus';

  const conceptById = new Map((concepts ?? []).map((c) => [c.id, c]));
  const rows = entries ?? [];

  // Una columna por moneda usada; una fila por concepto que tenga algo.
  const currencies = [...new Set(rows.map((e) => e.currency_code))].sort();
  const used = (kind: WeekConceptKind) =>
    (concepts ?? []).filter(
      (c) => c.kind === kind && rows.some((e) => e.concept_id === c.id),
    );

  const cell = (conceptId: string, currency: string) =>
    rows
      .filter((e) => e.concept_id === conceptId && e.currency_code === currency)
      .reduce((sum, e) => sum + Number(e.amount), 0);

  const movementsOf = (conceptId: string) =>
    rows
      .filter((e) => e.concept_id === conceptId)
      .reduce((sum, e) => sum + (e.movement_count ?? 0), 0);

  const sectionTotal = (kind: WeekConceptKind, currency: string) =>
    used(kind).reduce((sum, concept) => sum + cell(concept.id, currency), 0);

  const totalsOf = (kind: WeekConceptKind) =>
    Object.fromEntries(currencies.map((c) => [c, sectionTotal(kind, c)]));

  const balance = Object.fromEntries(
    currencies.map((c) => [c, sectionTotal('income', c) - sectionTotal('expense', c)]),
  );

  const hasAny = used('income').length > 0 || used('expense').length > 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={`/${slug}/semanal`} className="text-sm text-zinc-500 hover:text-zinc-900">
          ← Semanal
        </Link>
        <PageHeader
          title={formatRange(range)}
          subtitle={`${scope} · ${formatShort(week.start_date)} al ${formatShort(week.end_date)}`}
          actions={
            <Badge tone={closed ? 'green' : 'amber'}>{closed ? 'Cerrado' : 'Abierto'}</Badge>
          }
        />
      </div>

      {closed ? (
        <Alert tone="info">
          El período está cerrado: quedó en solo lectura. Un administrador puede reabrirlo.
        </Alert>
      ) : null}

      {/* ---------- El libro ---------- */}
      {!hasAny ? (
        <EmptyState title="Todavía no cargaste movimientos en este período." />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-lg text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs font-medium text-zinc-500">
                <th scope="col" className="px-5 py-3 text-left">
                  Concepto
                </th>
                {currencies.map((currency) => (
                  <th key={currency} scope="col" className="px-5 py-3 text-right">
                    {currency}
                  </th>
                ))}
                <th scope="col" className="px-5 py-3 text-right">
                  Movimientos
                </th>
              </tr>
            </thead>

            {(['income', 'expense'] as const).map((kind) =>
              used(kind).length === 0 ? null : (
                <tbody key={kind}>
                  <tr className="bg-zinc-50/70">
                    <td
                      colSpan={currencies.length + 2}
                      className="px-5 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500"
                    >
                      {kind === 'income' ? 'Ingresos' : 'Egresos'}
                    </td>
                  </tr>

                  {used(kind).map((concept) => (
                    <tr key={concept.id} className="border-b border-zinc-100">
                      <td className="px-5 py-3 text-zinc-900">{concept.name}</td>
                      {currencies.map((currency) => {
                        const value = cell(concept.id, currency);
                        return (
                          <td
                            key={currency}
                            className={`px-5 py-3 text-right tabular-nums ${
                              value ? 'text-zinc-900' : 'text-zinc-300'
                            }`}
                          >
                            {formatAmount(value)}
                          </td>
                        );
                      })}
                      <td className="px-5 py-3 text-right tabular-nums text-zinc-500">
                        {concept.has_movement_count ? movementsOf(concept.id) : '—'}
                      </td>
                    </tr>
                  ))}

                  <tr className="border-b border-zinc-200 font-medium">
                    <td className="px-5 py-3 text-zinc-500">
                      Total {kind === 'income' ? 'ingresos' : 'egresos'}
                    </td>
                    {currencies.map((currency) => (
                      <td
                        key={currency}
                        className="px-5 py-3 text-right tabular-nums text-zinc-900"
                      >
                        {formatAmount(sectionTotal(kind, currency))}
                      </td>
                    ))}
                    <td />
                  </tr>
                </tbody>
              ),
            )}

            <tfoot>
              <tr className="border-t-2 border-zinc-300 text-base font-semibold">
                <td className="px-5 py-3 text-navy-900">Saldo</td>
                {currencies.map((currency) => (
                  <td
                    key={currency}
                    className={`px-5 py-3 text-right tabular-nums ${
                      balance[currency] < 0 ? 'text-red-600' : 'text-navy-900'
                    }`}
                  >
                    {formatAmount(balance[currency])}
                  </td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </Card>
      )}

      {hasAny ? (
        <p className="-mt-3 text-right text-sm text-zinc-500">
          Ingresos {formatTotals(totalsOf('income'))} · Egresos{' '}
          {formatTotals(totalsOf('expense'))} ·{' '}
          <span className="font-semibold text-navy-900">Saldo {formatTotals(balance)}</span>
        </p>
      ) : null}

      {/* ---------- Alta ---------- */}
      {writes ? (
        <Card className="p-5">
          <h2 className="mb-4 text-sm font-medium text-zinc-900">Cargar movimiento</h2>
          <WeekEntryForm
            action={addWeekEntry}
            slug={slug}
            weekId={weekId}
            range={range}
            concepts={(concepts ?? [])
              .filter((c) => c.is_active)
              .map((c: WeekConcept) => ({
                id: c.id,
                name: c.name,
                kind: c.kind,
                allowed_currencies: c.allowed_currencies,
                has_movement_count: c.has_movement_count,
              }))}
          />
        </Card>
      ) : null}

      {/* ---------- Detalle ---------- */}
      {rows.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-medium text-zinc-900">Movimientos cargados</h2>
          <Card className="divide-y divide-zinc-100">
            {rows.map((entry) => {
              const concept = conceptById.get(entry.concept_id);
              const expense = concept?.kind === 'expense';

              return (
                <div
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                >
                  <div>
                    <p className="text-sm text-zinc-900">
                      {concept?.name ?? 'Concepto'}
                      {entry.movement_count !== null ? (
                        <span className="text-zinc-500"> · {entry.movement_count} mov.</span>
                      ) : null}
                    </p>
                    <p className="text-xs text-zinc-500">
                      {entry.entry_date ? formatShort(entry.entry_date) : 'Sin fecha'}
                      {entry.description ? ` · ${entry.description}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-sm tabular-nums ${
                        expense ? 'text-red-600' : 'text-zinc-900'
                      }`}
                    >
                      {expense ? '−' : ''}
                      {formatMoney(Number(entry.amount), entry.currency_code)}
                    </span>
                    {entry.source_type ? (
                      <Badge tone="neutral">Automático</Badge>
                    ) : writes ? (
                      <form action={deleteWeekEntry}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="week_id" value={weekId} />
                        <input type="hidden" name="id" value={entry.id} />
                        <SubmitButton variant="ghost">Borrar</SubmitButton>
                      </form>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </Card>
        </section>
      ) : null}

      {/* ---------- Notas y cierre ---------- */}
      {canWrite(role) ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {writes ? (
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-medium text-zinc-900">Notas del período</h2>
              <ActionForm action={updateWeekNotes} submitLabel="Guardar notas">
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="week_id" value={weekId} />
                <Field label="Notas">
                  <Textarea
                    name="notes"
                    defaultValue={week.notes ?? ''}
                    placeholder="Algo para dejar asentado de este período."
                  />
                </Field>
              </ActionForm>
            </Card>
          ) : null}

          <Card className="flex flex-col gap-3 p-5">
            <h2 className="text-sm font-medium text-zinc-900">
              {closed ? 'Reabrir el período' : 'Cerrar el período'}
            </h2>
            <p className="text-xs text-zinc-500">
              {closed
                ? 'Reabrir vuelve a habilitar la carga. Solo un administrador puede hacerlo.'
                : 'Al cerrar, no se pueden agregar ni borrar movimientos.'}
            </p>
            <ActionForm
              action={closed ? reopenWeek : closeWeek}
              submitLabel={closed ? 'Reabrir período' : 'Cerrar período'}
              submitVariant={closed ? 'secondary' : 'primary'}
            >
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="week_id" value={weekId} />
            </ActionForm>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
