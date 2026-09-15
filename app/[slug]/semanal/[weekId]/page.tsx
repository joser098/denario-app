import Link from 'next/link';
import { notFound } from 'next/navigation';
import { canAdmin, canWrite, requireOrg } from '@/lib/auth';
import {
  addWeekEntry,
  closeWeek,
  deleteWeekEntry,
  reopenWeek,
  setEntryCategory,
  updateWeekNotes,
} from '@/lib/actions/weeks';
import { openReport, saveExchangeRate } from '@/lib/actions/reports';
import { createClient } from '@/lib/supabase/server';
import { formatRange, formatShort } from '@/lib/dates';
import { formatAmount, formatMoney, formatTotals } from '@/lib/money';
import { EXPENSE_FIELDS, expenseLabel } from '@/lib/reports';
import { loadWeek } from '@/lib/week-data';
import { convert } from '@/lib/weeks';
import type { WeekConceptKind } from '@/lib/database.types';
import { ActionForm, SubmitButton } from '@/components/form';
import { MoneyInput } from '@/components/money-input';
import { WeekEntryForm } from '@/components/week-entry-form';
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  Field,
  LinkButton,
  PageHeader,
  Select,
  Textarea,
} from '@/components/ui';

export const metadata = { title: 'Período' };

export default async function WeekPage(props: PageProps<'/[slug]/semanal/[weekId]'>) {
  const { slug, weekId } = await props.params;
  const { organization, campuses, role } = await requireOrg(slug);

  const supabase = await createClient();
  const loaded = await loadWeek(supabase, organization.id, weekId);
  if (!loaded) notFound();

  const { week, currency, rates, entries: rows, concepts, summary } = loaded;

  // El reporte que cuelga de este período. Es a donde bajan los números al
  // cerrarlo, y saberlo acá es lo que deja llevar de una pantalla a la otra.
  const { data: report } = await supabase
    .from('pl_reports')
    .select('id, status')
    .eq('week_id', weekId)
    .maybeSingle();

  const closed = week.status === 'closed';
  const writes = canWrite(role) && !closed;
  const admin = canAdmin(role);
  const range = { start: week.start_date, end: week.end_date };
  const scope = campuses.find((c) => c.id === week.campus_id)?.name ?? 'Campus';

  const conceptById = new Map(concepts.map((c) => [c.id, c]));
  const money = concepts.filter((c) => !c.counts_only);

  // Una columna por moneda usada; una fila por concepto que tenga algo.
  const currencies = [
    ...new Set(
      rows
        .filter((e) => !conceptById.get(e.concept_id)?.counts_only)
        .map((e) => e.currency_code),
    ),
  ].sort();

  const used = (kind: WeekConceptKind) =>
    money.filter((c) => c.kind === kind && rows.some((e) => e.concept_id === c.id));

  const cell = (conceptId: string, code: string) =>
    rows
      .filter((e) => e.concept_id === conceptId && e.currency_code === code)
      .reduce((sum, e) => sum + Number(e.amount), 0);

  const sectionTotal = (kind: WeekConceptKind, code: string) =>
    used(kind).reduce((sum, concept) => sum + cell(concept.id, code), 0);

  const totalsOf = (kind: WeekConceptKind) =>
    Object.fromEntries(currencies.map((c) => [c, sectionTotal(kind, c)]));

  const balance = Object.fromEntries(
    currencies.map((c) => [c, sectionTotal('income', c) - sectionTotal('expense', c)]),
  );

  // Lo local de un concepto: la suma de sus montos ya convertidos. Null si a
  // alguno le falta la cotización — un total al que le falta una parte no es
  // un total y no se puede mostrar como si lo fuera.
  const localOf = (conceptId: string): number | null => {
    let sum = 0;
    for (const entry of rows.filter((e) => e.concept_id === conceptId)) {
      const value = convert(Number(entry.amount), entry.currency_code, currency, rates);
      if (value === null) return null;
      sum += value;
    }
    return Math.round(sum * 100) / 100;
  };

  const uncategorized = rows.filter(
    (e) => conceptById.get(e.concept_id)?.kind === 'expense' && !e.pl_expense_key,
  );

  const hasAny = used('income').length > 0 || used('expense').length > 0;
  const needsRate = summary.missingRates.length > 0;
  // La moneda del campus nunca se cotiza contra sí misma, y el dólar vale uno.
  const quotable = [...new Set(currencies)].filter((c) => c !== currency && c !== 'USD');
  if (currency !== 'USD' && currencies.includes('USD')) quotable.push(currency);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={`/${slug}/semanal`} className="text-sm text-zinc-500 hover:text-zinc-900">
          ← Semanal
        </Link>
        <PageHeader
          title={formatRange(range)}
          subtitle={`${scope} · ${formatShort(week.start_date)} al ${formatShort(week.end_date)} · montos en ${currency}`}
          actions={
            <div className="flex items-center gap-2">
              <Badge tone={closed ? 'green' : 'amber'}>{closed ? 'Cerrado' : 'Abierto'}</Badge>
              {week.pdf_path ? (
                <LinkButton
                  href={`/${slug}/reporte?semanal=${week.id}`}
                  variant="secondary"
                >
                  Descargar PDF
                </LinkButton>
              ) : null}
            </div>
          }
        />
      </div>

      {closed ? (
        <Alert tone="info">
          El período está cerrado: quedó en solo lectura. Un administrador puede reabrirlo.
        </Alert>
      ) : null}

      {/* ---------- Lo que falta para poder cerrar ---------- */}
      {!closed && needsRate ? (
        <Alert tone="warning">
          Falta cargar cuántos {summary.missingRates.join(' y ')} equivalen a un dólar en este
          período. Sin eso no hay un total en {currency} y el período no se puede cerrar.
        </Alert>
      ) : null}

      {!closed && uncategorized.length > 0 ? (
        <Alert tone="warning">
          Hay {uncategorized.length} egreso(s) sin categoría. Elegiles una más abajo: es el
          renglón del Profit &amp; Loss donde va a caer cada uno.
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
                {currencies.map((code) => (
                  <th key={code} scope="col" className="px-5 py-3 text-right">
                    {code}
                  </th>
                ))}
                {/* La columna que cierra: todo llevado a la moneda del campus
                    con la cotización del período. Es la que baja al reporte. */}
                <th scope="col" className="px-5 py-3 text-right">
                  Total {currency}
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

                  {used(kind).map((concept) => {
                    const local = localOf(concept.id);

                    return (
                      <tr key={concept.id} className="border-b border-zinc-100">
                        <td className="px-5 py-3 text-zinc-900">{concept.name}</td>
                        {currencies.map((code) => {
                          const value = cell(concept.id, code);
                          return (
                            <td
                              key={code}
                              className={`px-5 py-3 text-right tabular-nums ${
                                value ? 'text-zinc-900' : 'text-zinc-300'
                              }`}
                            >
                              {formatAmount(value)}
                            </td>
                          );
                        })}
                        <td className="px-5 py-3 text-right tabular-nums font-medium text-zinc-900">
                          {local === null ? (
                            <span className="text-amber-600">sin cotización</span>
                          ) : (
                            formatAmount(local)
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  <tr className="border-b border-zinc-200 font-medium">
                    <td className="px-5 py-3 text-zinc-500">
                      Total {kind === 'income' ? 'ingresos' : 'egresos'}
                    </td>
                    {currencies.map((code) => (
                      <td key={code} className="px-5 py-3 text-right tabular-nums text-zinc-900">
                        {formatAmount(sectionTotal(kind, code))}
                      </td>
                    ))}
                    <td className="px-5 py-3 text-right tabular-nums text-zinc-900">
                      {summary.local
                        ? formatAmount(
                            kind === 'income' ? summary.local.income : summary.local.expense,
                          )
                        : '—'}
                    </td>
                  </tr>
                </tbody>
              ),
            )}

            <tfoot>
              <tr className="border-t-2 border-zinc-300 text-base font-semibold">
                <td className="px-5 py-3 text-navy-900">Saldo</td>
                {currencies.map((code) => (
                  <td
                    key={code}
                    className={`px-5 py-3 text-right tabular-nums ${
                      balance[code] < 0 ? 'text-red-600' : 'text-navy-900'
                    }`}
                  >
                    {formatAmount(balance[code])}
                  </td>
                ))}
                <td
                  className={`px-5 py-3 text-right tabular-nums ${
                    (summary.local?.balance ?? 0) < 0 ? 'text-red-600' : 'text-navy-900'
                  }`}
                >
                  {summary.local ? formatAmount(summary.local.balance) : '—'}
                </td>
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

      {/* ---------- Lo que se cuenta y no es plata ---------- */}
      {summary.counts.length > 0 ? (
        <Card className="flex flex-wrap items-end gap-x-10 gap-y-4 p-5">
          {summary.counts.map((row) => (
            <div key={row.code}>
              <p className="text-xs font-medium text-zinc-500">{row.name}</p>
              <p className="text-base tabular-nums text-zinc-900">{row.movements}</p>
            </div>
          ))}
          <div className="ml-auto text-right">
            <p className="text-xs font-medium text-zinc-500">Participación</p>
            <p className="text-xl font-semibold tabular-nums text-zinc-900">
              {summary.participants}
            </p>
            <p className="text-[11px] text-zinc-500">transacciones + sobres</p>
          </div>
        </Card>
      ) : null}

      {/* ---------- Cotizaciones del período ---------- */}
      {quotable.length > 0 ? (
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="text-sm font-medium text-zinc-900">Cotizaciones del período</h2>
          <p className="text-xs text-zinc-500">
            Cuántas unidades equivalen a un dólar. Es lo que pasa a {currency} lo que se cargó en
            otra moneda, y lo mismo que usa el consolidado para volver a dólares.
            {admin ? '' : ' Las carga un administrador.'}
          </p>

          <div className="flex flex-col gap-1 text-sm">
            {quotable.map((code) => (
              <p key={code} className="text-zinc-700">
                1 USD ={' '}
                <span className="tabular-nums">
                  {rates[code] ? (
                    formatMoney(rates[code], code)
                  ) : (
                    <span className="text-amber-600">sin cargar</span>
                  )}
                </span>
              </p>
            ))}
          </div>

          {admin ? (
            <ActionForm
              action={saveExchangeRate}
              submitLabel="Guardar cotización"
              submitVariant="secondary"
              fieldsClassName="flex flex-wrap items-end gap-3"
            >
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="period_start" value={week.start_date} />
              <Field label="Moneda">
                <Select name="currency_code" defaultValue={quotable[0]} className="w-28">
                  {quotable.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Unidades por dólar">
                <MoneyInput name="units_per_usd" className="w-36 text-right" required />
              </Field>
            </ActionForm>
          ) : null}
        </Card>
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
            categories={EXPENSE_FIELDS.map((field) => ({ key: field.key, name: field.es }))}
            concepts={concepts
              .filter((c) => c.is_active)
              .map((c) => ({
                id: c.id,
                name: c.name,
                kind: c.kind,
                allowed_currencies: c.allowed_currencies,
                has_movement_count: c.has_movement_count,
                counts_only: c.counts_only,
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
                      {expense ? ` · ${expenseLabel(entry.pl_expense_key)}` : ''}
                      {entry.description ? ` · ${entry.description}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    {/*
                      Un egreso sin categoría no sabe a qué renglón del reporte
                      bajar. Los que llegan de Compras y Pagos vienen así, y
                      este es el lugar donde se entiende qué fue cada uno.
                    */}
                    {writes && expense && !entry.pl_expense_key ? (
                      <form action={setEntryCategory} className="flex items-center gap-2">
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="week_id" value={weekId} />
                        <input type="hidden" name="id" value={entry.id} />
                        <Select name="pl_expense_key" className="w-52" defaultValue="">
                          <option value="" disabled>
                            Elegí la categoría…
                          </option>
                          {EXPENSE_FIELDS.map((field) => (
                            <option key={field.key} value={field.key}>
                              {field.es}
                            </option>
                          ))}
                        </Select>
                        <SubmitButton variant="secondary">Guardar</SubmitButton>
                      </form>
                    ) : null}

                    {concept?.counts_only ? (
                      <span className="text-sm text-zinc-500">no es plata</span>
                    ) : (
                      <span
                        className={`text-sm tabular-nums ${
                          expense ? 'text-red-600' : 'text-zinc-900'
                        }`}
                      >
                        {expense ? '−' : ''}
                        {formatMoney(Number(entry.amount), entry.currency_code)}
                      </span>
                    )}

                    {entry.source_type ? (
                      <Badge tone="neutral">
                        {entry.source_type === 'sunday' ? 'Del domingo' : 'Automático'}
                      </Badge>
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
                : 'Al cerrar, los números bajan al Profit & Loss de este campus y queda el PDF del período. No se pueden agregar ni borrar movimientos.'}
            </p>
            <ActionForm
              action={closed ? reopenWeek : closeWeek}
              submitLabel={closed ? 'Reabrir período' : 'Cerrar período'}
              submitVariant={closed ? 'secondary' : 'primary'}
              confirm={
                closed
                  ? undefined
                  : 'Al cerrar, los números bajan al Profit & Loss. ¿Seguimos?'
              }
            >
              <input type="hidden" name="slug" value={slug} />
              <input type="hidden" name="week_id" value={weekId} />
            </ActionForm>

            {report ? (
              <Link
                href={`/${slug}/reportes/${report.id}`}
                className="text-sm font-medium text-brand-600 hover:underline"
              >
                Ver el Profit &amp; Loss de este período →
              </Link>
            ) : (
              /*
                El reporte nace con el período, así que normalmente ya está.
                Esto es para los períodos que vienen de antes de que los dos
                módulos estuvieran atados: sin reporte, el cierre no tendría a
                dónde bajar los números.
              */
              <ActionForm
                action={openReport}
                submitLabel="Abrir el Profit & Loss de este período"
                submitVariant="secondary"
                className="items-start"
              >
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="week_id" value={weekId} />
              </ActionForm>
            )}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
