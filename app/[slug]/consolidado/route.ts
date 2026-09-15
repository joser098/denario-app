import { NextResponse, type NextRequest } from 'next/server';
import { requireOrg } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { buildConsolidated } from '@/lib/pdf/consolidado';
import { pdfName } from '@/lib/pdf/names';

/**
 * El consolidado de un periodo, en PDF.
 *
 * Se arma en el momento y no se guarda: cambia cada vez que un campus cierra
 * su reporte o el admin corrige una cotización, así que un archivo congelado
 * envejecería mal. Solo para quien no está acotado a un campus — el que ve
 * uno solo no tiene nada que consolidar.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/[slug]/consolidado'>) {
  const { slug } = await ctx.params;
  const { organization, campusId } = await requireOrg(slug);

  if (campusId) return new NextResponse('No encontrado', { status: 404 });

  const date = request.nextUrl.searchParams.get('periodo') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new NextResponse('Falta el período', { status: 400 });
  }

  const supabase = await createClient();
  const bytes = await buildConsolidated(supabase, organization.id, date);

  if (!bytes) {
    return new NextResponse('Ningún campus cerró el reporte de este período', { status: 404 });
  }

  return new NextResponse(bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${pdfName({
        kind: 'pl',
        campus: 'consolidado',
        date,
      })}"`,
    },
  });
}
