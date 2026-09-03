import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import { formatLong } from '@/lib/dates';
import { formatMoney } from '@/lib/money';
import { loadLogo } from '@/lib/pdf/actas';
import { Sheet } from '@/lib/pdf/sheet';

type Client = SupabaseClient<Database>;

/**
 * Recibo de un pago en efectivo.
 *
 * A diferencia de las actas, no se guarda en el bucket: se arma cada vez que
 * alguien lo pide. El acta es un documento firmado y congelado; el recibo se
 * firma en papel, así que el PDF es solo la hoja para imprimir y la fila de
 * `cash_payments` es la fuente. Si hace falta el escaneado firmado, se
 * adjunta como comprobante.
 */
export async function buildCashReceipt(
  supabase: Client,
  paymentId: string,
): Promise<Uint8Array | null> {
  const { data: payment } = await supabase
    .from('cash_payments')
    .select('*')
    .eq('id', paymentId)
    .maybeSingle();

  if (!payment) return null;

  const [{ data: organization }, { data: campus }, { data: team }] = await Promise.all([
    supabase
      .from('organizations')
      .select('name, logo_path')
      .eq('id', payment.organization_id)
      .maybeSingle(),
    supabase.from('campuses').select('name').eq('id', payment.campus_id).maybeSingle(),
    payment.team_id
      ? supabase.from('teams').select('name').eq('id', payment.team_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  if (!organization) return null;

  const sheet = await Sheet.create();
  const logo = await loadLogo(supabase, organization.logo_path);
  if (logo) await sheet.stamp(logo);

  sheet.text(organization.name, { size: 11, bold: true });
  sheet.text(campus?.name ?? '', { size: 9, muted: true });
  sheet.gap(10);
  sheet.title('Recibo de pago en efectivo');
  sheet.row([
    { text: `N° ${String(payment.receipt_number).padStart(6, '0')}`, width: 240, bold: true },
    { text: formatLong(payment.paid_on), width: 243, align: 'right', muted: true },
  ]);
  sheet.gap(4);
  sheet.rule(true);
  sheet.gap(10);

  // El cuerpo es la declaración que firma quien cobra: en primera persona y
  // con el monto en grande, porque es lo único que se lee dos veces.
  sheet.text(`Recibí de ${organization.name}${campus ? ` — ${campus.name}` : ''} la suma de`);
  sheet.gap(2);
  sheet.text(formatMoney(Number(payment.amount), payment.currency_code), { size: 18, bold: true });
  sheet.gap(6);
  sheet.text('en concepto de:', { size: 9, muted: true });
  sheet.text(payment.concept);

  if (team?.name) {
    sheet.gap(4);
    sheet.row([
      { text: 'Equipo', width: 120, muted: true },
      { text: team.name, width: 363 },
    ]);
  }

  if (payment.notes) {
    sheet.gap(6);
    sheet.text('Observaciones', { size: 9, muted: true });
    sheet.text(payment.notes, { size: 9 });
  }

  sheet.gap(10);
  sheet.rule();
  sheet.row([
    { text: 'Recibí conforme', width: 120, muted: true },
    { text: payment.payee_name, width: 363, bold: true },
  ]);
  if (payment.payee_document) {
    sheet.row([
      { text: 'Documento', width: 120, muted: true },
      { text: payment.payee_document, width: 363 },
    ]);
  }

  sheet.signatures([
    { role: 'Firma de quien recibe', name: payment.payee_name },
    { role: 'Aclaración', name: '' },
  ]);

  sheet.footer([
    'Este recibo vale como constancia de entrega del efectivo detallado.',
    'Documento generado por Denario.',
  ]);

  return sheet.save();
}
