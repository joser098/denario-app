/**
 * Links entre la invitacion, /login y /signup.
 *
 * Los tres tienen que arrastrar dos cosas: a donde volver y con que email.
 * Perder el `next` te deja en /nueva-organizacion en vez de la invitacion;
 * perder el `email` te obliga a tipearlo, y una invitacion solo sirve para el
 * email al que fue emitida.
 *
 * El email viaja por la URL solo para completar el campo. Quien acepta lo
 * valida de nuevo contra auth.users en accept_invitation, asi que cambiarlo a
 * mano no habilita nada.
 */
export function authHref(path: '/login' | '/signup', next?: string, email?: string) {
  const params = new URLSearchParams();
  if (next && next !== '/') params.set('next', next);
  if (email) params.set('email', email);
  const query = params.toString();
  return query ? `${path}?${query}` : path;
}

/** El unico valor de searchParams que nos sirve es un string. */
export function param(value: string | string[] | undefined) {
  return typeof value === 'string' ? value : undefined;
}
