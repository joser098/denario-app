import { NextResponse, type NextRequest } from 'next/server';
import { requireOrg } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

/**
 * Descarga de un acta guardada en el bucket privado.
 *
 * No sirve el archivo: pide una URL firmada de corta vida y redirige. La
 * autorizacion la da RLS sobre storage.objects; el chequeo del prefijo evita
 * ademas que alguien pruebe paths de otra organizacion desde esta ruta.
 */
export async function GET(request: NextRequest, ctx: RouteContext<'/[slug]/acta'>) {
  const { slug } = await ctx.params;
  const { organization } = await requireOrg(slug);

  const path = request.nextUrl.searchParams.get('path') ?? '';
  if (!path.startsWith(`${organization.id}/`)) {
    return new NextResponse('No encontrado', { status: 404 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from('actas')
    .createSignedUrl(path, 60, { download: path.split('/').pop() ?? 'acta.pdf' });

  if (error || !data) {
    return new NextResponse('No encontrado', { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl);
}
