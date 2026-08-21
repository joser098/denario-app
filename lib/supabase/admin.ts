import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';

/**
 * Cliente con service-role: SALTEA RLS por completo.
 *
 * Existe por una sola razon: la superficie publica de las reuniones
 * (/r/<publicId>). Un voluntario anonimo no tiene auth.uid(), asi que ninguna
 * policy puede autorizarlo — la posesion del ID publico es la autorizacion, y
 * esa verificacion la hace el codigo del servidor antes de tocar la base.
 *
 * Nunca importar esto desde un Client Component ni usarlo para operaciones de
 * un usuario autenticado: para eso esta lib/supabase/server.ts.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error('Falta SUPABASE_SERVICE_ROLE_KEY');

  return createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
