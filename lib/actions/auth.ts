'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import type { FormState } from '@/lib/forms';
import { siteOrigin } from '@/lib/site';


/** Solo aceptamos rutas internas: `next=https://otro-sitio` seria open redirect. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === 'string' ? value : '';
  return next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

const credentials = z.object({
  email: z.email('Escribi un email valido.'),
  password: z.string().min(8, 'La contraseña necesita al menos 8 caracteres.'),
});

// ---------- Ingresar ----------

export async function signIn(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // No distinguimos "no existe" de "contraseña incorrecta": eso le diria a
    // un desconocido que ese email tiene cuenta.
    return { error: 'Email o contraseña incorrectos.' };
  }

  redirect(safeNext(formData.get('next')));
}

// ---------- Crear cuenta ----------

export async function signUp(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = credentials.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0].message };
  }
  if (formData.get('password') !== formData.get('password2')) {
    return { error: 'Las contraseñas no coinciden.' };
  }

  const supabase = await createClient();
  const next = safeNext(formData.get('next'));
  const { data, error } = await supabase.auth.signUp({
    ...parsed.data,
    options: { emailRedirectTo: `${await siteOrigin()}/auth/callback?next=${encodeURIComponent(next)}` },
  });

  if (error) {
    return { error: error.message };
  }

  // Sin sesion pasan dos cosas distintas y Supabase las devuelve igual, a
  // proposito: o la cuenta es nueva y falta confirmar el mail, o el email ya
  // tenia cuenta (ahi manda `identities` vacio y ningun error). Decir cual es
  // seria confirmarle a un desconocido que ese email esta registrado, la
  // misma razon por la que signIn no distingue sus errores. Asi que el
  // mensaje cubre los dos casos y en ambos la salida es la misma pantalla.
  if (!data.session) {
    return {
      message:
        'Si el email no tenía cuenta, te llega un mail para confirmarla. Si ya tenías, entrá con tu contraseña.',
    };
  }

  redirect(next);
}

// ---------- Recuperar contraseña ----------

export async function requestPasswordReset(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = z.email().safeParse(formData.get('email'));
  if (!email.success) {
    return { error: 'Escribi un email valido.' };
  }

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${await siteOrigin()}/auth/callback?next=/recuperar/nueva`,
  });

  // Respuesta identica exista o no la cuenta.
  return { message: 'Si ese email tiene cuenta, te llega un link para cambiar la contraseña.' };
}

export async function updatePassword(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const password = z
    .string()
    .min(8, 'La contraseña necesita al menos 8 caracteres.')
    .safeParse(formData.get('password'));
  if (!password.success) {
    return { error: password.error.issues[0].message };
  }
  if (formData.get('password') !== formData.get('password2')) {
    return { error: 'Las contraseñas no coinciden.' };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: 'El link vencio. Pedi uno nuevo desde "Olvide mi contraseña".' };
  }

  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) {
    return { error: error.message };
  }

  redirect('/');
}

// ---------- Salir ----------

/**
 * `next` deja volver a donde estabas despues de cambiar de cuenta: la pantalla
 * de invitacion lo usa para traerte de vuelta al token, en vez de dejarte en
 * un login pelado que ya no sabe a que te habian invitado.
 */
export async function signOut(formData?: FormData) {
  const supabase = await createClient();
  await supabase.auth.signOut();

  const next = safeNext(formData?.get('next') ?? null);
  redirect(next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`);
}
