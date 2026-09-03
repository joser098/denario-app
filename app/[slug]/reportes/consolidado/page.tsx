import Link from 'next/link';
import { redirect } from 'next/navigation';
import { canAdmin, requireOrg } from '@/lib/auth';
import { saveExchangeRate } from '@/lib/actions/reports';
import { createClient } from '@/lib/supabase/server';
import { formatLong, lastSunday, todayIn } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import {
  consolidate,
  fieldLabel,
  formatPercent,
  type ConsolidatedCampus,
  type ConsolidatedRow,
} from '@/lib/reports';
import { ActionForm } from '@/components/form';
import { MoneyInput } from '@/components/money-input';
import { Alert, Card, Field, Input, LinkButton, PageHeader, Select } from '@/components/ui';

export const metadata = { title: 'Consolidado' };

/**
 * El Profit & Loss de toda la organizacion, en dolares.
 *
 * Cada campus carga en su moneda; acá se convierte con la cotización de ese
 * domingo y se suma. El monto local queda al lado, en menor jerarquía: es de
 * donde salió el número, y sin eso nadie puede verificar la conversión.
 *
 * Solo para quien ve más de un campus: el que está acotado a uno ya tiene su
 * reporte y no hay nada que consolidar.
 */
export default async function ConsolidatedPage(
  props: PageProps<'/[slug]/reportes/consolidado'>,
) {
  const { slug } = await props.params;
  const { fecha } = await props.searchParams;
  const { organization, campuses, campusId, role } = await requireOrg(slug);

  if (campusId) redirect(`/${slug}/reportes`);

  const requested = typeof fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null;
  const date = requested ?? lastSunday(todayIn(organization.timezone));

  const supabase = await createClient();
  const [{ data: reports }, { data: rates }] = await Promise.all([
    supabase
      .from('pl_reports')
      .select('*')
      .eq('organization_id', organization.id)
      .eq('service_date', date),
    supabase
      .from('exchange_rates')
      .select('currency_code, units_per_usd')
      .eq('organization_id', organization.id)
      .eq('service_date', date),
  ]);

  // El dólar no lleva cotización: vale uno.
  const rateOf = (currency: string): number | null =>
    currency === 'USD'
      ? 1
      : ((rates ?? []).find((r) => r.currency_code === currency)?.units_per_usd ?? null);

  const items: ConsolidatedCampus[] = campuses.map((campus) => {
    const report = (reports ?? []).find((r) => r.campus_id === campus.id) ?? null;
    return {
      campus: { id: campus.id, name: campus.name },
      report,
      unitsPerUsd: report ? rateOf(report.currency_code) : null,
    };
  });

  const data = consolidate(items);
  const shown = items.filter((i) => i.report);

  // Las monedas de este domingo que todavía no tienen cotización.
  const pending = [
    ...new Set(
      shown
        .filter((i) => i.unitsPerUsd === null)
        .map((i) => i.report!.currency_code),
    ),
  ];

  const cell = (row: ConsolidatedRow, item: ConsolidatedCampus) => (
    <td key={item.campus.id} className="px-4 py-2 text-right align-top">
      <span className="block text-sm tabular-nums text-zinc-900">
        {row.usd[item.campus.id] === null || row.usd[item.campus.id] === undefined
          ? '—'
          : formatMoney(row.usd[item.campus.id]!, 'USD')}
      </span>
      {item.report ? (
        <span className="block text-xs tabular-nums text-zinc-500">
          {formatMoney(row.local[item.campus.id] ?? 0, item.report.currency_code)}
        </span>
      ) : null}
    </td>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href={`/${slug}/reportes`} className="text-sm text-zinc-500 hover:text-zinc-900">
          ← Profit &amp; Loss
        </Link>
        <PageHeader
          title="Consolidado"
          subtitle={`${formatLong(date)} · toda la organización, en dólares`}
          actions={
            <div className="flex items-end gap-2">
              <form className="flex items-end gap-2">
                <Input name="fecha" type="date" defaultValue={date} className="w-44" />
                <button
                  type="submit"
                  className="h-10 rounded-lg border border-zinc-200 px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Ver
                </button>
              </form>
              {shown.length > 0 ? (
                <LinkButton href={`/${slug}/consolidado?fecha=${date}`} variant="secondary">
                  Descargar PDF
                </LinkButton>
              ) : null}
            </div>
          }
        />
      </div>

      {data.missingReport.length > 0 ? (
        <Alert tone="info">
          Sin reporte de este domingo: {data.missingReport.join(', ')}. No entran en la suma.
        </Alert>
      ) : null}

      {pending.length > 0 ? (
        <Alert tone="error">
          Falta la cotización de {pending.join(', ')} para este domingo, así que{' '}
          {data.missingRate.join(', ')} no {data.missingRate.length === 1 ? 'entra' : 'entran'} en
          el total.
        </Alert>
      ) : null}

      {canAdmin(role) && shown.length > 0 ? (
        <Card className="p-5">
          <h2 className="mb-1 text-sm font-medium text-zinc-900">Cotización del domingo</h2>
          <p className="mb-4 text-xs text-zinc-500">
            Cuántas unidades de cada moneda equivalen a un dólar. Queda guardada: el consolidado
            de una semana vieja no se mueve porque el dólar cambió hoy.
          </p>
          <ActionForm
            action={saveExchangeRate}
            submitLabel="Guardar cotización"
            fieldsClassName="flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="service_date" value={date} />
            <Field label="Moneda">
              <Select name="currency_code" className="w-32" required>
                {[...new Set(shown.map((i) => i.report!.currency_code))]
                  .filter((c) => c !== 'USD')
                  .map((currency) => (
                    <option key={currency} value={currency}>
                      {currency}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Equivalen a 1 USD">
              <MoneyInput name="units_per_usd" className="w-40 text-right" required />
            </Field>
            <div className="flex flex-wrap gap-x-4 text-xs text-zinc-500 sm:self-center">
              {(rates ?? []).map((rate) => (
                <span key={rate.currency_code}>
                  {rate.currency_code} {Number(rate.units_per_usd).toLocaleString('es-AR')}
                </span>
              ))}
            </div>
          </ActionForm>
        </Card>
      ) : null}

      {shown.length === 0 ? (
        <Alert tone="info">Ningún campus cargó el reporte de este domingo todavía.</Alert>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr className="border-b border-zinc-200 text-xs font-medium text-zinc-500">
                <th scope="col" className="px-5 py-3 text-left">
                  Concepto
                </th>
                {shown.map((item) => (
                  <th key={item.campus.id} scope="col" className="px-4 py-3 text-right">
                    {item.campus.name}
                    <span className="block font-normal text-zinc-500">
                      {item.report!.currency_code}
                    </span>
                  </th>
                ))}
                <th scope="col" className="px-5 py-3 text-right text-zinc-900">
                  Total USD
                </th>
              </tr>
            </thead>

            <tbody>
              <Section label="Ingresos (Revenue)" span={shown.length + 2} />
              {data.revenue.map((row) => (
                <tr key={row.field.key} className="border-b border-zinc-50">
                  <th scope="row" className="px-5 py-2 text-left font-normal text-zinc-700">
                    {fieldLabel(row.field)}
                  </th>
                  {shown.map((item) => cell(row, item))}
                  <td className="px-5 py-2 text-right text-sm font-medium tabular-nums text-zinc-900">
                    {formatMoney(row.total, 'USD')}
                  </td>
                </tr>
              ))}
              <Totals
                label="Total de ingresos (Total Revenue)"
                columns={shown.length}
                value={data.totals.revenue}
              />

              <Section label="Egresos (Expenses)" span={shown.length + 2} />
              <tr className="border-b border-zinc-50">
                <td className="px-5 py-2 text-zinc-700">
                  Contribución global (Global Contribution)
                </td>
                <td colSpan={shown.length} />
                <td className="px-5 py-2 text-right text-sm font-medium tabular-nums text-zinc-900">
                  {formatMoney(data.totals.globalContribution, 'USD')}
                </td>
              </tr>
              <tr className="border-b border-zinc-50">
                <td className="px-5 py-2 text-zinc-700">
                  Contribución continental (Continental Contribution)
                </td>
                <td colSpan={shown.length} />
                <td className="px-5 py-2 text-right text-sm font-medium tabular-nums text-zinc-900">
                  {formatMoney(data.totals.continentalContribution, 'USD')}
                </td>
              </tr>
              {data.expenses.map((row) => (
                <tr key={row.field.key} className="border-b border-zinc-50">
                  <th scope="row" className="px-5 py-2 text-left font-normal text-zinc-700">
                    {fieldLabel(row.field)}
                  </th>
                  {shown.map((item) => cell(row, item))}
                  <td className="px-5 py-2 text-right text-sm font-medium tabular-nums text-zinc-900">
                    {formatMoney(row.total, 'USD')}
                  </td>
                </tr>
              ))}
              <Totals
                label="Total de egresos (Total Expenses)"
                columns={shown.length}
                value={data.totals.expenses}
              />

              <tr className="border-t-2 border-zinc-300">
                <td className="px-5 py-3 text-sm font-semibold text-navy-900">
                  {data.totals.surplus < 0 ? 'Déficit (Deficit)' : 'Superávit (Surplus)'}
                </td>
                <td colSpan={shown.length} />
                <td
                  className={`px-5 py-3 text-right text-base font-semibold tabular-nums ${
                    data.totals.surplus < 0 ? 'text-red-600' : 'text-zinc-900'
                  }`}
                >
                  {formatMoney(data.totals.surplus, 'USD')}
                </td>
              </tr>
            </tbody>
          </table>
        </Card>
      )}

      {shown.length > 0 ? (
        <Card className="flex flex-wrap gap-x-10 gap-y-4 p-5">
          {/* La gente no se convierte: se suma. */}
          <Metric label="Asistencia" value={data.totals.attendance.toLocaleString('es-AR')} />
          <Metric label="Participación" value={data.totals.participants.toLocaleString('es-AR')} />
          <Metric label="% de participación" value={formatPercent(data.totals.participation)} />
          <Metric label="Salvaciones" value={data.totals.salvations.toLocaleString('es-AR')} />
          <Metric
            label="Costo por alma salvada"
            value={
              data.totals.costPerSoul === null
                ? '—'
                : formatMoney(data.totals.costPerSoul, 'USD')
            }
          />
        </Card>
      ) : null}
    </div>
  );
}

function Section({ label, span }: { label: string; span: number }) {
  return (
    <tr className="bg-zinc-50">
      <td colSpan={span} className="px-5 py-2 text-xs font-semibold text-navy-900">
        {label}
      </td>
    </tr>
  );
}

function Totals({
  label,
  columns,
  value,
}: {
  label: string;
  columns: number;
  value: number;
}) {
  return (
    <tr className="border-b border-zinc-200 bg-zinc-50/60">
      <td className="px-5 py-2 text-sm font-medium text-navy-900">{label}</td>
      <td colSpan={columns} />
      <td className="px-5 py-2 text-right text-sm font-semibold tabular-nums text-zinc-900">
        {formatMoney(value, 'USD')}
      </td>
    </tr>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <p className="text-lg font-semibold tabular-nums text-zinc-900">{value}</p>
    </div>
  );
}
