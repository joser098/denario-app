import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { formatLong } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import {
  EXPENSE_FIELDS,
  FOUNDATION_CLOSING,
  FOUNDATION_FIELDS,
  REVENUE_FIELDS,
  fieldLabel,
  formatPercent,
  reportTotals,
  type ReportField,
} from '@/lib/reports';
import { loadLogo } from '@/lib/pdf/actas';
import { Sheet } from '@/lib/pdf/sheet';

type Client = SupabaseClient<Database>;

const LABEL = 340;
const AMOUNT = 143;

export type ReportPdf = { path: string; bytes: Uint8Array };

/**
 * El Profit & Loss de un domingo, en una hoja.
 *
 * Se guarda al cerrar el reporte y no se arma cada vez que alguien lo pide:
 * con el reporte en borrador saldrian papeles de numeros a medio cargar,
 * iguales al definitivo, y el que lo manda a HF no sabria cual es cual.
 */
export async function buildProfitLoss(
  supabase: Client,
  reportId: string,
): Promise<ReportPdf | null> {
  const { data: report } = await supabase
    .from('pl_reports')
    .select('*')
    .eq('id', reportId)
    .maybeSingle();

  if (!report) return null;

  const [{ data: organization }, { data: campus }] = await Promise.all([
    supabase
      .from('organizations')
      .select('name, logo_path')
      .eq('id', report.organization_id)
      .maybeSingle(),
    supabase.from('campuses').select('name').eq('id', report.campus_id).maybeSingle(),
  ]);

  if (!organization) return null;

  const totals = reportTotals(report);
  const money = (value: number) => formatMoney(value, report.currency_code);

  const sheet = await Sheet.create();
  const logo = await loadLogo(supabase, organization.logo_path);
  if (logo) await sheet.stamp(logo);

  sheet.text(organization.name, { size: 11, bold: true });
  sheet.text(campus?.name ?? '', { size: 9, muted: true });
  sheet.gap(10);
  sheet.title('Profit & Loss Report');
  sheet.text(`${formatLong(report.service_date)} · montos en ${report.currency_code}`, {
    size: 10,
    muted: true,
  });
  sheet.gap(6);
  sheet.rule(true);

  // ---------- Ingresos ----------
  section(sheet, 'Ingresos (Revenue)');
  for (const field of REVENUE_FIELDS) line(sheet, field, money(Number(report[field.key])));
  total(sheet, 'Total de ingresos (Total Revenue)', money(totals.revenue));

  sheet.gap(6);
  metric(sheet, 'Asistencia del domingo (Sunday Attendance)', String(report.attendance));
  metric(sheet, 'Total de participación (Total Participation)', String(report.participants));
  metric(sheet, '% de participación (Participation %)', formatPercent(totals.participation));

  // ---------- Egresos ----------
  section(sheet, 'Egresos (Expenses)');
  sheet.row([
    { text: `Contribución global (Global Contribution ${percent(report.global_rate)})`, width: LABEL },
    { text: money(totals.globalContribution), width: AMOUNT, align: 'right' },
  ]);
  sheet.row([
    {
      text: `Contribución continental (Continental Contribution ${percent(report.continental_rate)})`,
      width: LABEL,
    },
    { text: money(totals.continentalContribution), width: AMOUNT, align: 'right' },
  ]);
  for (const field of EXPENSE_FIELDS) line(sheet, field, money(Number(report[field.key])));
  total(sheet, 'Total de egresos (Total Expenses)', money(totals.expenses));

  sheet.gap(6);
  metric(sheet, 'Total de salvaciones (Salvations)', String(report.salvations));
  metric(
    sheet,
    'Costo por alma salvada (Cost per Soul)',
    totals.costPerSoul === null ? '—' : money(totals.costPerSoul),
  );

  // ---------- Resultado ----------
  sheet.gap(10);
  sheet.rule(true);
  sheet.row(
    [
      {
        text: totals.surplus < 0 ? 'Déficit (Deficit)' : 'Superávit (Surplus)',
        width: LABEL,
        bold: true,
      },
      { text: money(totals.surplus), width: AMOUNT, align: 'right', bold: true },
    ],
    { size: 12 },
  );

  // ---------- Foundation Budget ----------
  // Va despues del superavit y no adentro de egresos: es otra plata, con su
  // propio saldo de apertura y de cierre.
  //
  // La seccion entera se reserva: al pie de la hoja entraban el titulo y un
  // renglon, y los otros cuatro mas el saldo final se iban a la hoja
  // siguiente. Un saldo de cierre separado de sus partes no se puede leer.
  sheet.reserve(150);
  section(sheet, 'Presupuesto de la Fundación (Foundation Budget)');
  for (const field of FOUNDATION_FIELDS) line(sheet, field, money(Number(report[field.key])));
  total(
    sheet,
    `${FOUNDATION_CLOSING.es} (${FOUNDATION_CLOSING.en})`,
    money(totals.foundationClosing),
  );

  if (report.notes) {
    sheet.gap(10);
    sheet.text('Notas', { size: 9, muted: true });
    sheet.text(report.notes, { size: 9 });
  }

  sheet.footer([
    report.status === 'closed'
      ? `Reporte cerrado el ${stamp(report.closed_at)}.`
      : 'Borrador: todavía se puede editar.',
    'Documento generado por Denario.',
  ]);

  return {
    // El campus va en el path porque es lo que mira RLS sobre el bucket.
    path: `${report.organization_id}/${report.campus_id}/${report.service_date}-${report.id}.pdf`,
    bytes: await sheet.save(),
  };
}

/**
 * Genera el PDF y lo deja guardado en el reporte.
 *
 * Devuelve false si algo falla: el reporte ya quedo cerrado igual, y el PDF
 * se puede volver a generar. Perder el cierre por un storage caido seria
 * mucho peor que quedarse sin el papel un rato.
 */
export async function attachReportPdf(supabase: Client, reportId: string): Promise<boolean> {
  const pdf = await buildProfitLoss(supabase, reportId);
  if (!pdf) return false;

  const { error } = await supabase.storage
    .from('reportes')
    .upload(pdf.path, pdf.bytes, { contentType: 'application/pdf', upsert: true });

  if (error) return false;

  const { error: saveError } = await supabase
    .from('pl_reports')
    .update({ pdf_path: pdf.path })
    .eq('id', reportId);

  return !saveError;
}

function section(sheet: Sheet, title: string) {
  sheet.gap(10);
  sheet.text(title, { size: 11, bold: true });
  sheet.rule();
}

function line(sheet: Sheet, field: ReportField, amount: string) {
  sheet.row([
    { text: fieldLabel(field), width: LABEL },
    { text: amount, width: AMOUNT, align: 'right' },
  ]);
}

function total(sheet: Sheet, label: string, amount: string) {
  sheet.rule();
  sheet.row([
    { text: label, width: LABEL, bold: true },
    { text: amount, width: AMOUNT, align: 'right', bold: true },
  ]);
}

function metric(sheet: Sheet, label: string, value: string) {
  sheet.row(
    [
      { text: label, width: LABEL, muted: true },
      { text: value, width: AMOUNT, align: 'right' },
    ],
    { size: 9 },
  );
}

function percent(rate: number): string {
  return `${Number((Number(rate) * 100).toFixed(2))}%`;
}

function stamp(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}
