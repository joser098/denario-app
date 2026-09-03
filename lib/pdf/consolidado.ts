import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Campus, Database } from '@/lib/database.types';
import { formatLong } from '@/lib/dates';
import { formatAmountWithSymbol } from '@/lib/money';
import {
  consolidate,
  fieldLabel,
  formatPercent,
  type ConsolidatedCampus,
  type ConsolidatedRow,
} from '@/lib/reports';
import { loadLogo } from '@/lib/pdf/actas';
import { Sheet } from '@/lib/pdf/sheet';

type Client = SupabaseClient<Database>;

/**
 * El Profit & Loss de toda la organizacion, en dolares, en hoja apaisada.
 *
 * Apaisada porque la tabla crece a lo ancho: una columna por campus mas la
 * del total. En vertical entraban tres campus justos y el cuarto ya empezaba
 * a cortar los montos; acostada entran seis con holgura, y el nombre de cada
 * concepto tiene lugar para ir en los dos idiomas.
 *
 * No se guarda en storage: el consolidado es una lectura que cambia cada vez
 * que un campus cierra su reporte o el admin corrige una cotizacion, asi que
 * un archivo congelado envejeceria mal.
 */
export async function buildConsolidated(
  supabase: Client,
  organizationId: string,
  date: string,
): Promise<Uint8Array | null> {
  const [{ data: organization }, { data: campuses }, { data: reports }, { data: rates }] =
    await Promise.all([
      supabase
        .from('organizations')
        .select('name, logo_path')
        .eq('id', organizationId)
        .maybeSingle(),
      supabase
        .from('campuses')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('is_active', true)
        .order('name'),
      supabase
        .from('pl_reports')
        .select('*')
        .eq('organization_id', organizationId)
        .eq('service_date', date),
      supabase
        .from('exchange_rates')
        .select('currency_code, units_per_usd')
        .eq('organization_id', organizationId)
        .eq('service_date', date),
    ]);

  if (!organization) return null;

  const rateOf = (currency: string): number | null =>
    currency === 'USD'
      ? 1
      : ((rates ?? []).find((r) => r.currency_code === currency)?.units_per_usd ?? null);

  const items: ConsolidatedCampus[] = (campuses ?? []).map((campus: Campus) => {
    const report = (reports ?? []).find((r) => r.campus_id === campus.id) ?? null;
    return {
      campus: { id: campus.id, name: campus.name },
      report,
      unitsPerUsd: report ? rateOf(report.currency_code) : null,
    };
  });

  const data = consolidate(items);
  const shown = items.filter((i) => i.report);
  if (shown.length === 0) return null;

  /** Lo que aporta cada campus, para la fila de totales. */
  const totalPorCampus = (filas: ConsolidatedRow[]) =>
    Object.fromEntries(
      shown.map((item) => [
        item.campus.id,
        filas.reduce((suma, row) => suma + (row.usd[item.campus.id] ?? 0), 0),
      ]),
    );

  const sheet = await Sheet.create({ landscape: true });
  const logo = await loadLogo(supabase, organization.logo_path);
  if (logo) await sheet.stamp(logo);

  // Los montos llevan simbolo pero no el codigo: el cuadro entero esta en
  // dolares y lo dice el subtitulo, asi que "USD" en cada celda no
  // desambigua nada y solo come ancho. 64 puntos es lo que mide
  // "US$ 111.021,75" a 8 puntos mas el aire de la celda; lo que sobra se lo
  // lleva el nombre del concepto.
  const ancho = sheet.width;
  const columna = Math.min(64, Math.floor((ancho - 200) / (shown.length + 1)));
  const etiqueta = ancho - columna * (shown.length + 1);

  // Con lugar de sobra el concepto va en los dos idiomas, como en el reporte
  // de cada campus; cuando los campus se multiplican y la columna se angosta,
  // se cae al castellano solo antes que a cortar los nombres.
  const nombre = (row: ConsolidatedRow) =>
    etiqueta >= 300 ? fieldLabel(row.field) : row.field.es;

  sheet.text(organization.name, { size: 11, bold: true });
  sheet.text('Consolidado de la organización', { size: 9, muted: true });
  sheet.gap(10);
  sheet.title('Profit & Loss Report');
  sheet.text(`${formatLong(date)} · todos los montos en dólares`, { size: 10, muted: true });
  sheet.gap(6);
  sheet.rule(true);

  const encabezado = () =>
    sheet.row(
      [
        { text: 'Concepto', width: etiqueta, muted: true },
        // Sin la moneda del campus: la columna esta en dolares como el resto,
        // y poner "(COP)" arriba de un numero en USD era mentir. La moneda de
        // cada uno esta abajo, en las cotizaciones.
        ...shown.map((item) => ({
          text: item.campus.name,
          width: columna,
          align: 'right' as const,
          muted: true,
        })),
        { text: 'Total', width: columna, align: 'right' as const, bold: true },
      ],
      { size: 7 },
    );

  const fila = (row: ConsolidatedRow) =>
    sheet.row(
      [
        { text: nombre(row), width: etiqueta },
        ...shown.map((item) => ({
          text: usd(row.usd[item.campus.id]),
          width: columna,
          align: 'right' as const,
        })),
        { text: usd(row.total), width: columna, align: 'right' as const, bold: true },
      ],
      { size: 8 },
    );

  const totalFila = (
    label: string,
    valor: number,
    porCampus?: Record<string, number>,
  ) =>
    sheet.row(
      [
        { text: label, width: etiqueta, bold: true },
        ...shown.map((item) => ({
          text: porCampus ? usd(porCampus[item.campus.id]) : '',
          width: columna,
          align: 'right' as const,
          bold: true,
        })),
        { text: usd(valor), width: columna, align: 'right' as const, bold: true },
      ],
      { size: 8 },
    );

  // ---------- Ingresos ----------
  sheet.gap(8);
  sheet.reserve(60);
  sheet.text('Ingresos (Revenue)', { size: 10, bold: true });
  encabezado();
  sheet.rule();
  for (const row of data.revenue) fila(row);
  sheet.rule();
  totalFila('Total de ingresos (Total Revenue)', data.totals.revenue, totalPorCampus(data.revenue));

  // ---------- Egresos ----------
  sheet.gap(10);
  sheet.reserve(60);
  sheet.text('Egresos (Expenses)', { size: 10, bold: true });
  sheet.rule();
  totalFila('Contribución global (Global Contribution)', data.totals.globalContribution);
  totalFila('Contribución continental (Continental Contribution)', data.totals.continentalContribution);
  for (const row of data.expenses) fila(row);
  sheet.rule();
  totalFila('Total de egresos (Total Expenses)', data.totals.expenses);

  // ---------- Resultado ----------
  sheet.gap(8);
  sheet.rule(true);
  // El monto va a 11 puntos y con moneda: necesita mucho mas que el ancho de
  // una columna de la tabla, que esta pensada para numeros a 8 puntos.
  const anchoResultado = 170;
  sheet.row(
    [
      {
        text: data.totals.surplus < 0 ? 'Déficit (Deficit)' : 'Superávit (Surplus)',
        width: ancho - anchoResultado,
        bold: true,
      },
      { text: usd(data.totals.surplus), width: anchoResultado, align: 'right', bold: true },
    ],
    { size: 11 },
  );

  // ---------- Gente ----------
  // No se convierte, se suma: los dos indicadores salen de estos totales y no
  // del promedio de los de cada campus.
  sheet.gap(10);
  // Cinco renglones de 17 puntos mas el titulo: o entra el bloque entero o
  // arranca en la hoja siguiente.
  sheet.reserve(5 * 17 + 30);
  sheet.text('Asistencia y salvaciones', { size: 10, bold: true });
  sheet.rule();
  metric(sheet, 'Asistencia (Sunday Attendance)', data.totals.attendance.toLocaleString('es-AR'));
  metric(sheet, 'Participación (Total Participation)', data.totals.participants.toLocaleString('es-AR'));
  metric(sheet, '% de participación (Participation %)', formatPercent(data.totals.participation));
  metric(sheet, 'Salvaciones (Salvations)', data.totals.salvations.toLocaleString('es-AR'));
  metric(
    sheet,
    'Costo por alma salvada (Cost per Soul)',
    data.totals.costPerSoul === null ? '—' : usd(data.totals.costPerSoul),
  );

  // ---------- Cotizaciones ----------
  // Van impresas porque son lo que explica cada número de arriba: sin ellas,
  // el consolidado no se puede rehacer a mano.
  sheet.gap(10);
  sheet.reserve(shown.length * 17 + 30);
  sheet.text('Cotizaciones usadas', { size: 10, bold: true });
  sheet.rule();
  for (const item of shown) {
    metric(
      sheet,
      `${item.campus.name} · ${item.report!.currency_code}`,
      item.unitsPerUsd === null
        ? 'sin cotización — no entra en el total'
        : `${Number(item.unitsPerUsd).toLocaleString('es-AR')} por USD`,
    );
  }

  const pie = ['Documento generado por Denario.'];
  if (data.missingRate.length > 0) {
    pie.unshift(`Sin cotización, fuera del total: ${data.missingRate.join(', ')}.`);
  }
  if (data.missingReport.length > 0) {
    pie.unshift(`Sin reporte de este domingo: ${data.missingReport.join(', ')}.`);
  }
  sheet.footer(pie);

  return sheet.save();
}

/**
 * Todo monto del documento: con simbolo y sin el "USD" al final.
 *
 * El cuadro entero esta en dolares y el subtitulo lo dice, asi que el codigo
 * repetido en cada celda no desambigua nada — pero el simbolo si hace falta
 * para que un numero suelto se lea como plata.
 */
function usd(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : formatAmountWithSymbol(value, 'USD');
}

function metric(sheet: Sheet, label: string, value: string) {
  sheet.row(
    [
      { text: label, width: 300, muted: true },
      { text: value, width: sheet.width - 300, align: 'right' },
    ],
    { size: 9 },
  );
}
