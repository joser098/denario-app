import { NextResponse, type NextRequest } from 'next/server';
import { requireOrg } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { buildCashReceipt } from '@/lib/pdf/recibo';
import { pdfName } from '@/lib/pdf/names';

/**
 * Recibo de un pago en efectivo, para imprimir y firmar.
 *
 * Se arma en el momento y se sirve derecho: no hay archivo guardado que
 * pedirle a storage. La autorizacion la da RLS sobre cash_payments — si el
 * pago es de otro campus, la consulta vuelve vacia y esto es un 404.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/[slug]/recibo'>) {
  const { slug } = await ctx.params;
  await requireOrg(slug);

  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!id) return new NextResponse('No encontrado', { status: 404 });

  const supabase = await createClient();
  const bytes = await buildCashReceipt(supabase, id);

  if (!bytes) return new NextResponse('No encontrado', { status: 404 });

  // El numero del recibo va en el nombre porque es como se lo pide la gente:
  // "pasame el 41", no "el de tal fecha".
  const { data: payment } = await supabase
    .from('cash_payments')
    .select('receipt_number, paid_on, campuses!inner(name)')
    .eq('id', id)
    .maybeSingle();

  const campus = payment?.campuses as unknown as { name: string } | undefined;
  const name = payment
    ? pdfName({
        kind: 'recibo',
        campus: campus?.name ?? '',
        date: payment.paid_on,
        detail: String(payment.receipt_number).padStart(6, '0'),
      })
    : 'recibo.pdf';

  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${name}"`,
    },
  });
}
