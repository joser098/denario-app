import { NextResponse, type NextRequest } from 'next/server';
import { requireOrg } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { pdfName } from '@/lib/pdf/names';

/**
 * Descarga del Profit & Loss de un campus.
 *
 * Sirve el archivo que se congelo al cerrar el reporte, no uno armado en el
 * momento: mientras es borrador no hay PDF, y eso es a proposito. La
 * autorizacion la da RLS sobre pl_reports y sobre el bucket.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/[slug]/reporte'>) {
  const { slug } = await ctx.params;
  const { organization } = await requireOrg(slug);

  const id = request.nextUrl.searchParams.get('id') ?? '';
  if (!id) return new NextResponse('No encontrado', { status: 404 });

  const supabase = await createClient();
  const { data: report } = await supabase
    .from('pl_reports')
    .select('pdf_path, service_date, campuses!inner(name)')
    .eq('id', id)
    .eq('organization_id', organization.id)
    .maybeSingle();

  if (!report?.pdf_path) {
    return new NextResponse('El reporte todavía no está cerrado', { status: 404 });
  }

  const campus = report.campuses as unknown as { name: string };
  const { data, error } = await supabase.storage
    .from('reportes')
    .createSignedUrl(report.pdf_path, 60, {
      download: pdfName({ kind: 'pl', campus: campus.name, date: report.service_date }),
    });

  if (error || !data) return new NextResponse('No encontrado', { status: 404 });

  return NextResponse.redirect(data.signedUrl);
}
