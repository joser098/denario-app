import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/session';

// Next 16 renombro "middleware" a "proxy"; el comportamiento es el mismo.
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Todo salvo assets estaticos y archivos con extension.
    '/((?!_next/static|_next/image|favicon.ico|.*\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
