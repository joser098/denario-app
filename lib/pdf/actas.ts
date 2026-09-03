import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { formatLong, formatTime } from '@/lib/dates';
import { formatMoney, formatTotals, sumByCurrency } from '@/lib/money';
import { isEmpty, methodLabel, methodsOf, summarize, type Breakdown } from '@/lib/sundays';
import { Sheet } from '@/lib/pdf/sheet';

type Client = SupabaseClient<Database>;

export type Acta = { path: string; bytes: Uint8Array };

const GENERATED_BY = 'Documento generado por Denario.';

function stamp(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Renglon chico con el desglose por medio de pago, si hay mas de uno. */
function breakdownLine(sheet: Sheet, group: Breakdown) {
  const methods = methodsOf(group);
  if (methods.length === 0 || isEmpty(group.total)) return;

  sheet.row(
    [
      {
        text: methods
          .map((method) => `${methodLabel(method)} ${formatTotals(group.byMethod[method])}`)
          .join('   '),
        width: 483,
        align: 'right',
        muted: true,
      },
    ],
    { size: 8 },
  );
}

export type Logo = { bytes: Uint8Array; kind: 'png' | 'jpg' };

/**
 * Baja el logo de la organizacion para estamparlo en el PDF. Si falla, el
 * documento sale igual: el logo es decoracion, no contenido.
 */
export async function loadLogo(supabase: Client, logoPath: string | null): Promise<Logo | null> {
  if (!logoPath) return null;

  const { data } = await supabase.storage.from('logos').download(logoPath);
  if (!data) return null;

  return {
    bytes: new Uint8Array(await data.arrayBuffer()),
    kind: logoPath.toLowerCase().endsWith('.png') ? 'png' : 'jpg',
  };
}

/** Cabecera comun: quien, donde, cuando. */
async function header(
  sheet: Sheet,
  org: string,
  campus: string,
  subtitle: string,
  title: string,
  logo: Logo | null,
) {
  if (logo) await sheet.stamp(logo);
  sheet.text(org, { size: 11, bold: true });
  sheet.text(campus, { size: 9, muted: true });
  sheet.gap(10);
  sheet.title(title);
  sheet.text(subtitle, { size: 10, muted: true });
  sheet.gap(6);
  sheet.rule(true);
}

// ============================================================
// Acta de conteo de una reunion
// ============================================================

export async function buildCountActa(supabase: Client, countId: string): Promise<Acta | null> {
  const { data: count } = await supabase
    .from('offering_counts')
    .select('*')
    .eq('id', countId)
    .maybeSingle();
  if (!count) return null;

  const { data: meeting } = await supabase
    .from('sunday_meetings')
    .select('*')
    .eq('id', count.meeting_id)
    .maybeSingle();
  if (!meeting) return null;

  const { data: sunday } = await supabase
    .from('sundays')
    .select('*')
    .eq('id', meeting.sunday_id)
    .maybeSingle();
  if (!sunday) return null;

  const [{ data: org }, { data: campus }, { data: lines }] = await Promise.all([
    supabase.from('organizations').select('name, logo_path').eq('id', sunday.organization_id).maybeSingle(),
    supabase.from('campuses').select('name').eq('id', sunday.campus_id).maybeSingle(),
    supabase.from('offering_count_lines').select('*').eq('offering_count_id', countId),
  ]);

  const rows = (lines ?? [])
    .slice()
    .sort(
      (a, b) =>
        a.currency_code.localeCompare(b.currency_code) ||
        Number(b.denomination_value) - Number(a.denomination_value),
    );

  const totals = sumByCurrency(
    rows.map((l) => ({ currency_code: l.currency_code, subtotal: Number(l.subtotal) })),
  );

  const sheet = await Sheet.create();
  await header(
    sheet,
    org?.name ?? 'Organización',
    campus?.name ?? '',
    `${formatLong(sunday.service_date)} · ${meeting.label} (${formatTime(meeting.start_time)})`,
    'Acta de conteo de ofrenda',
    await loadLogo(supabase, org?.logo_path ?? null),
  );

  sheet.gap(6);
  sheet.row([
    { text: 'Billete', width: 160, bold: true, muted: true },
    { text: 'Cantidad', width: 120, align: 'right', bold: true, muted: true },
    { text: 'Subtotal', width: 203, align: 'right', bold: true, muted: true },
  ]);
  sheet.rule();

  if (rows.length === 0) {
    sheet.text('El acta se cerró sin billetes cargados.', { size: 10, muted: true });
  } else {
    for (const line of rows) {
      sheet.row([
        { text: formatMoney(Number(line.denomination_value), line.currency_code), width: 160 },
        { text: String(line.quantity), width: 120, align: 'right' },
        {
          text: formatMoney(Number(line.subtotal), line.currency_code),
          width: 203,
          align: 'right',
        },
      ]);
    }
  }

  sheet.rule(true);
  sheet.row([
    { text: 'Total contado', width: 280, bold: true },
    { text: formatTotals(totals), width: 203, align: 'right', bold: true },
  ]);

  sheet.gap(10);
  sheet.text(
    `Sobres recibidos: ${count.envelopes_count}.`,
    { size: 9, muted: true },
  );

  if (count.notes) {
    sheet.gap(6);
    sheet.text('Observaciones', { size: 9, bold: true, muted: true });
    sheet.text(count.notes, { size: 10 });
  }

  sheet.signatures([
    { role: 'Contó', name: count.volunteer_name ?? '' },
    { role: 'Testigo 1', name: count.witness_1_name ?? '' },
    { role: 'Testigo 2', name: count.witness_2_name ?? '' },
  ]);

  sheet.footer([
    `Acta ${count.public_id} · firmada el ${stamp(count.finalized_at)}`,
    'Una vez firmada, esta acta no se edita: si hay un error se anula y se hace una nueva.',
    GENERATED_BY,
  ]);

  return {
    path: `${sunday.organization_id}/${sunday.id}/acta-${count.id}.pdf`,
    bytes: await sheet.save(),
  };
}

// ============================================================
// Acta de cierre del domingo
// ============================================================

export async function buildSundayActa(
  supabase: Client,
  sundayId: string,
  options: { closedBy?: string } = {},
): Promise<Acta | null> {
  const { data: sunday } = await supabase
    .from('sundays')
    .select('*')
    .eq('id', sundayId)
    .maybeSingle();
  if (!sunday) return null;

  const [{ data: org }, { data: campus }, { data: meetings }, { data: amounts }] =
    await Promise.all([
      supabase.from('organizations').select('name, logo_path').eq('id', sunday.organization_id).maybeSingle(),
      supabase.from('campuses').select('name').eq('id', sunday.campus_id).maybeSingle(),
      supabase.from('sunday_meetings').select('*').eq('sunday_id', sundayId).order('sort_order'),
      supabase.from('meeting_amounts').select('*').eq('sunday_id', sundayId),
    ]);

  const meetingIds = (meetings ?? []).map((m) => m.id);
  const { data: counts } = meetingIds.length
    ? await supabase
        .from('offering_counts')
        .select('meeting_id, volunteer_name, envelopes_count')
        .eq('status', 'finalized')
        .in('meeting_id', meetingIds)
    : {
        data: [] as Array<{
          meeting_id: string;
          volunteer_name: string | null;
          envelopes_count: number;
        }>,
      };

  const totals = summarize(amounts);
  const countByMeeting = new Map((counts ?? []).map((c) => [c.meeting_id, c]));
  // Solo actas finalizadas, igual que la ofrenda: la consulta ya filtra por eso.
  const envelopes = (counts ?? []).reduce((sum, c) => sum + c.envelopes_count, 0);

  const sheet = await Sheet.create();
  await header(
    sheet,
    org?.name ?? 'Organización',
    campus?.name ?? '',
    formatLong(sunday.service_date),
    'Cierre del domingo',
    await loadLogo(supabase, org?.logo_path ?? null),
  );

  sheet.gap(6);
  // Cinco columnas en 483 puntos: la grilla va a cuerpo 9 para que entren
  // los nombres largos de reunion sin recortarse.
  const COLUMNS = [155, 88, 80, 80, 80];
  const ROW = { size: 9 };

  sheet.row(
    [
      { text: 'Reunión', width: COLUMNS[0], bold: true, muted: true },
      { text: 'Contó', width: COLUMNS[1], bold: true, muted: true },
      { text: 'Ofrenda', width: COLUMNS[2], align: 'right', bold: true, muted: true },
      { text: 'Ventas', width: COLUMNS[3], align: 'right', bold: true, muted: true },
      { text: 'Ingresos', width: COLUMNS[4], align: 'right', bold: true, muted: true },
    ],
    ROW,
  );
  sheet.rule();

  for (const meeting of meetings ?? []) {
    const own = summarize((amounts ?? []).filter((a) => a.meeting_id === meeting.id));

    sheet.row(
      [
        { text: `${meeting.label} (${formatTime(meeting.start_time)})`, width: COLUMNS[0] },
        { text: countByMeeting.get(meeting.id)?.volunteer_name ?? 'Sin acta', width: COLUMNS[1] },
        { text: formatTotals(own.offering), width: COLUMNS[2], align: 'right' },
        { text: formatTotals(own.sales.total), width: COLUMNS[3], align: 'right' },
        { text: formatTotals(own.incomes.total), width: COLUMNS[4], align: 'right' },
      ],
      ROW,
    );
  }

  sheet.rule(true);
  sheet.row([
    { text: 'Ofrendas (efectivo contado)', width: 280 },
    { text: formatTotals(totals.offering), width: 203, align: 'right' },
  ]);
  sheet.row([
    { text: 'Ventas', width: 280 },
    { text: formatTotals(totals.sales.total), width: 203, align: 'right' },
  ]);
  breakdownLine(sheet, totals.sales);
  sheet.row([
    { text: 'Ingresos digitales', width: 280 },
    { text: formatTotals(totals.incomes.total), width: 203, align: 'right' },
  ]);
  breakdownLine(sheet, totals.incomes);
  sheet.rule();
  sheet.row([
    { text: 'Total del domingo (sin ventas)', width: 280, bold: true },
    { text: formatTotals(totals.total), width: 203, align: 'right', bold: true },
  ]);

  // Los sobres van despues del total y con aire en medio: es un conteo, no
  // plata, y pegado al total se leeria como parte de la suma.
  sheet.gap(8);
  sheet.row([
    { text: 'Sobres recibidos', width: 280 },
    { text: String(envelopes), width: 203, align: 'right' },
  ]);

  sheet.gap(8);
  sheet.text(
    'La ofrenda y las ventas son plata distinta: lo cobrado por ventas no forma parte del acta de conteo, ni siquiera en efectivo, y no suma al total del domingo.',
    { size: 9, muted: true },
  );
  sheet.text(
    'Los sobres son un dato de control: la plata que tenían adentro ya está contada en la ofrenda.',
    { size: 9, muted: true },
  );

  if (sunday.notes) {
    sheet.gap(8);
    sheet.text('Notas del domingo', { size: 9, bold: true, muted: true });
    sheet.text(sunday.notes, { size: 10 });
  }

  sheet.signatures([{ role: 'Cerró el domingo', name: options.closedBy ?? '' }]);

  sheet.footer([`Cerrado el ${stamp(sunday.closed_at)}`, GENERATED_BY]);

  return {
    path: `${sunday.organization_id}/${sunday.id}/cierre-${sunday.closed_at}.pdf`,
    bytes: await sheet.save(),
  };
}

// ============================================================
// Guardado
// ============================================================

export async function uploadActa(supabase: Client, acta: Acta): Promise<boolean> {
  const { error } = await supabase.storage
    .from('actas')
    .upload(acta.path, acta.bytes, { contentType: 'application/pdf', upsert: true });

  return !error;
}

/**
 * Genera el PDF y lo cuelga de la fila. Devuelve false si algo falla: el acta
 * ya esta firmada y eso es lo que vale — el PDF es una representacion y se
 * puede volver a generar.
 */
export async function attachCountActa(supabase: Client, countId: string): Promise<boolean> {
  const acta = await buildCountActa(supabase, countId);
  if (!acta || !(await uploadActa(supabase, acta))) return false;

  const { error } = await supabase
    .from('offering_counts')
    .update({ pdf_path: acta.path })
    .eq('id', countId);

  return !error;
}

export async function attachSundayActa(
  supabase: Client,
  sundayId: string,
  options: { closedBy?: string } = {},
): Promise<boolean> {
  const acta = await buildSundayActa(supabase, sundayId, options);
  if (!acta || !(await uploadActa(supabase, acta))) return false;

  const { error } = await supabase
    .from('sundays')
    .update({ acta_pdf_path: acta.path })
    .eq('id', sundayId);

  return !error;
}

// ============================================================
// Cierre de caja de ventas
// ============================================================

export async function buildCashboxActa(
  supabase: Client,
  sessionId: string,
): Promise<Acta | null> {
  const { data: session } = await supabase
    .from('meeting_sales_sessions')
    .select('*')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return null;

  const { data: meeting } = await supabase
    .from('sunday_meetings')
    .select('*')
    .eq('id', session.meeting_id)
    .maybeSingle();
  if (!meeting) return null;

  const { data: sunday } = await supabase
    .from('sundays')
    .select('*')
    .eq('id', meeting.sunday_id)
    .maybeSingle();
  if (!sunday) return null;

  const [{ data: org }, { data: campus }, { data: sales }] = await Promise.all([
    supabase.from('organizations').select('name, logo_path').eq('id', sunday.organization_id).maybeSingle(),
    supabase.from('campuses').select('name').eq('id', sunday.campus_id).maybeSingle(),
    supabase.from('sales').select('*').eq('session_id', sessionId).order('created_at'),
  ]);

  const saleIds = (sales ?? []).map((s) => s.id);
  const { data: lines } = saleIds.length
    ? await supabase.from('sale_lines').select('*').in('sale_id', saleIds)
    : { data: [] as Array<{ sale_id: string; product_name: string; quantity: number; subtotal: number }> };

  // Una fila por producto, no una por venta: al vendedor le importa cuantas
  // unidades salieron, no en cuantos tickets.
  const perProduct = new Map<string, { name: string; quantity: number; subtotal: number; currency: string }>();
  const byMethod: Breakdown = { total: {}, byMethod: {} };

  for (const sale of sales ?? []) {
    for (const line of (lines ?? []).filter((l) => l.sale_id === sale.id)) {
      const key = `${line.product_name}:${sale.currency_code}`;
      const current = perProduct.get(key) ?? {
        name: line.product_name,
        quantity: 0,
        subtotal: 0,
        currency: sale.currency_code,
      };
      current.quantity += line.quantity;
      current.subtotal += Number(line.subtotal);
      perProduct.set(key, current);

      byMethod.total[sale.currency_code] =
        (byMethod.total[sale.currency_code] ?? 0) + Number(line.subtotal);
      const bucket = byMethod.byMethod[sale.payment_method] ?? {};
      bucket[sale.currency_code] = (bucket[sale.currency_code] ?? 0) + Number(line.subtotal);
      byMethod.byMethod[sale.payment_method] = bucket;
    }
  }

  const sheet = await Sheet.create();
  await header(
    sheet,
    org?.name ?? 'Organización',
    campus?.name ?? '',
    `${formatLong(sunday.service_date)} · ${meeting.label} (${formatTime(meeting.start_time)})`,
    'Cierre de caja de ventas',
    await loadLogo(supabase, org?.logo_path ?? null),
  );

  sheet.gap(6);
  sheet.row([
    { text: 'Producto', width: 283, bold: true, muted: true },
    { text: 'Unidades', width: 100, align: 'right', bold: true, muted: true },
    { text: 'Subtotal', width: 100, align: 'right', bold: true, muted: true },
  ]);
  sheet.rule();

  if (perProduct.size === 0) {
    sheet.text('La caja se cerró sin ventas registradas.', { size: 10, muted: true });
  } else {
    for (const row of [...perProduct.values()].sort((a, b) => b.subtotal - a.subtotal)) {
      sheet.row([
        { text: row.name, width: 283 },
        { text: String(row.quantity), width: 100, align: 'right' },
        { text: formatMoney(row.subtotal, row.currency), width: 100, align: 'right' },
      ]);
    }
  }

  sheet.rule(true);
  for (const method of methodsOf(byMethod)) {
    sheet.row([
      { text: methodLabel(method), width: 383 },
      { text: formatTotals(byMethod.byMethod[method]), width: 100, align: 'right' },
    ]);
  }
  sheet.rule();
  sheet.row([
    { text: 'Total de la caja', width: 383, bold: true },
    { text: formatTotals(byMethod.total), width: 100, align: 'right', bold: true },
  ]);

  if (session.notes) {
    sheet.gap(8);
    sheet.text('Observaciones', { size: 9, bold: true, muted: true });
    sheet.text(session.notes, { size: 10 });
  }

  sheet.signatures([
    { role: 'Vendió', name: session.seller_name },
    { role: 'Testigo', name: session.witness_name ?? '' },
  ]);

  sheet.footer([
    `Caja cerrada el ${stamp(session.closed_at)}`,
    'Las ventas no forman parte del acta de conteo de la ofrenda: es plata aparte.',
    GENERATED_BY,
  ]);

  return {
    path: `${sunday.organization_id}/${sunday.id}/caja-${session.id}.pdf`,
    bytes: await sheet.save(),
  };
}

export async function attachCashboxActa(supabase: Client, sessionId: string): Promise<boolean> {
  const acta = await buildCashboxActa(supabase, sessionId);
  if (!acta || !(await uploadActa(supabase, acta))) return false;

  const { error } = await supabase
    .from('meeting_sales_sessions')
    .update({ pdf_path: acta.path })
    .eq('id', sessionId);

  return !error;
}
