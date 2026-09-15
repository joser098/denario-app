import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, ExpenseKey, RevenueKey } from '@/lib/database.types';
import { formatRange, formatStamp, timezoneOf } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { EXPENSE_FIELDS, REVENUE_FIELDS, fieldLabel } from '@/lib/reports';
import { convert, ratesOf, summarizeWeek } from '@/lib/weeks';
import { loadLogo } from '@/lib/pdf/actas';
import { Sheet } from '@/lib/pdf/sheet';

type Client = SupabaseClient<Database>;

const LABEL = 300;
const AMOUNT = 120;
const NOTE = 63;

export type WeekPdf = { path: string; bytes: Uint8Array };

/**
 * El cierre del periodo del Semanal, en una hoja.
 *
 * Es el papel que explica el Profit & Loss: muestra de que movimientos salio
 * cada renglon del reporte y con que cotizacion se convirtio lo que estaba en
 * otra moneda. Sin esto, el reporte que se manda a HF es un numero sin
 * respaldo y la unica forma de auditarlo es volver a entrar a la app.
 *
 * Se arma al cerrar y no cada vez que alguien lo pide, igual que el acta del
 * domingo: mientras el periodo esta abierto los numeros se mueven, y un
 * papel que cambia solo no sirve de comprobante.
 */
export async function buildWeekSheet(
  supabase: Client,
  weekId: string,
): Promise<WeekPdf | null> {
  const { data: week } = await supabase
    .from('weeks')
    .select('*')
    .eq('id', weekId)
    .maybeSingle();

  if (!week) return null;

  const [{ data: organization }, { data: campus }] = await Promise.all([
    supabase
      .from('organizations')
      .select('name, logo_path, timezone')
      .eq('id', week.organization_id)
      .maybeSingle(),
    supabase
      .from('campuses')
      .select('name, timezone, default_currency')
      .eq('id', week.campus_id)
      .maybeSingle(),
  ]);

  if (!organization || !campus) return null;

  const [{ data: entries }, { data: concepts }, { data: rates }] = await Promise.all([
    supabase.from('week_entries').select('*').eq('week_id', weekId).order('entry_date'),
    supabase
      .from('week_concepts')
      .select('*')
      .eq('organization_id', week.organization_id)
      .order('sort_order'),
    supabase
      .from('exchange_rates')
      .select('currency_code, units_per_usd')
      .eq('organization_id', week.organization_id)
      .eq('period_start', week.start_date),
  ]);

  const currency = campus.default_currency;
  const rateMap = ratesOf(rates);
  const summary = summarizeWeek({
    entries: entries ?? [],
    concepts: concepts ?? [],
    currency,
    rates: rateMap,
  });

  const range = { start: week.start_date, end: week.end_date };
  const money = (value: number) => formatMoney(value, currency);
  const conceptById = new Map((concepts ?? []).map((c) => [c.id, c]));

  const sheet = await Sheet.create();
  const logo = await loadLogo(supabase, organization.logo_path);
  if (logo) await sheet.stamp(logo);

  sheet.text(organization.name, { size: 11, bold: true });
  sheet.text(campus.name, { size: 9, muted: true });
  sheet.gap(10);
  sheet.title('Cierre del período');
  sheet.text(`${formatRange(range)} · montos en ${currency}`, { size: 10, muted: true });
  sheet.gap(6);
  sheet.rule(true);

  // ---------- Ingresos ----------
  // Agrupados por el renglón del reporte al que bajan, que es la pregunta
  // que trae quien compara este papel contra el Profit & Loss.
  section(sheet, 'Ingresos');
  for (const field of REVENUE_FIELDS) {
    const amount = summary.revenue[field.key as RevenueKey];
    if (!amount) continue;
    line(sheet, fieldLabel(field), money(amount));
  }
  total(sheet, 'Total de ingresos', money(summary.local?.income ?? 0));

  // ---------- Egresos ----------
  section(sheet, 'Egresos');
  for (const field of EXPENSE_FIELDS) {
    const amount = summary.expenses[field.key as ExpenseKey];
    if (!amount) continue;
    line(sheet, fieldLabel(field), money(amount));
  }
  total(sheet, 'Total de egresos', money(summary.local?.expense ?? 0));

  // ---------- Saldo ----------
  sheet.gap(10);
  sheet.rule(true);
  const balance = summary.local?.balance ?? 0;
  sheet.row(
    [
      { text: balance < 0 ? 'Saldo negativo' : 'Saldo', width: LABEL, bold: true },
      { text: money(balance), width: AMOUNT, align: 'right', bold: true },
    ],
    { size: 12 },
  );

  // ---------- Lo que se cuenta ----------
  if (summary.counts.length > 0) {
    section(sheet, 'Datos de control');
    for (const row of summary.counts) line(sheet, row.name, String(row.movements));
    total(sheet, 'Participación', String(summary.participants));
  }

  // ---------- Cotizaciones ----------
  // Van impresas porque son parte del cálculo: sin ellas, los totales de
  // arriba no se pueden rehacer a partir de los movimientos de abajo.
  const used = Object.keys(rateMap).filter((code) => code !== currency);
  if (used.length > 0) {
    section(sheet, 'Cotizaciones del período');
    for (const code of used.sort()) {
      line(sheet, `1 USD = ${code}`, formatMoney(rateMap[code], code));
    }
  }

  // ---------- El detalle ----------
  sheet.reserve(120);
  section(sheet, 'Movimientos');
  sheet.row([
    { text: 'Concepto', width: LABEL, muted: true },
    { text: 'Monto', width: AMOUNT, align: 'right', muted: true },
    { text: 'En ' + currency, width: NOTE + AMOUNT, align: 'right', muted: true },
  ]);
  sheet.rule();

  for (const entry of entries ?? []) {
    const concept = conceptById.get(entry.concept_id);
    if (!concept) continue;

    const expense = concept.kind === 'expense';
    const detail = [
      concept.name,
      entry.pl_expense_key ? `· ${labelOf(entry.pl_expense_key)}` : '',
      entry.description ? `· ${entry.description}` : '',
    ]
      .filter(Boolean)
      .join(' ');

    if (concept.counts_only) {
      sheet.row([
        { text: detail, width: LABEL },
        { text: `${entry.movement_count ?? 0}`, width: AMOUNT, align: 'right' },
        { text: 'no es plata', width: NOTE + AMOUNT, align: 'right', muted: true },
      ]);
      continue;
    }

    const amount = Number(entry.amount);
    const local = convert(amount, entry.currency_code, currency, rateMap);

    sheet.row([
      { text: detail, width: LABEL },
      {
        text: `${expense ? '-' : ''}${formatMoney(amount, entry.currency_code)}`,
        width: AMOUNT,
        align: 'right',
      },
      {
        text:
          entry.currency_code === currency
            ? ''
            : `${expense ? '-' : ''}${local === null ? 'sin cotización' : money(local)}`,
        width: NOTE + AMOUNT,
        align: 'right',
        muted: true,
      },
    ]);
  }

  if (week.notes) {
    sheet.gap(10);
    sheet.text('Notas', { size: 9, muted: true });
    sheet.text(week.notes, { size: 9 });
  }

  sheet.footer([
    week.status === 'closed'
      ? `Período cerrado el ${formatStamp(week.closed_at, timezoneOf(campus, organization))}.`
      : 'Borrador: el período todavía está abierto.',
    'Documento generado por Denario.',
  ]);

  return {
    // El campus va segundo porque es lo que mira RLS sobre el bucket.
    path: `${week.organization_id}/${week.campus_id}/semanal-${week.id}.pdf`,
    bytes: await sheet.save(),
  };
}

/**
 * Genera el PDF y lo deja guardado en el periodo.
 *
 * Devuelve false si algo falla: el periodo ya quedo cerrado igual y el PDF se
 * puede volver a generar. Perder el cierre por un storage caido seria mucho
 * peor que quedarse sin el papel un rato.
 */
export async function attachWeekPdf(supabase: Client, weekId: string): Promise<boolean> {
  const pdf = await buildWeekSheet(supabase, weekId);
  if (!pdf) return false;

  const { error } = await supabase.storage
    .from('reportes')
    .upload(pdf.path, pdf.bytes, { contentType: 'application/pdf', upsert: true });

  if (error) return false;

  const { error: saveError } = await supabase
    .from('weeks')
    .update({ pdf_path: pdf.path })
    .eq('id', weekId);

  return !saveError;
}

function labelOf(key: ExpenseKey): string {
  return EXPENSE_FIELDS.find((field) => field.key === key)?.es ?? key;
}

function section(sheet: Sheet, title: string) {
  sheet.gap(10);
  sheet.text(title, { size: 11, bold: true });
  sheet.rule();
}

function line(sheet: Sheet, label: string, amount: string) {
  sheet.row([
    { text: label, width: LABEL },
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
