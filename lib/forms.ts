/**
 * Estado que devuelven los formularios a `useActionState`.
 * `error` se pinta en rojo, `message` en verde. Nunca los dos a la vez.
 *
 * Vive aca y no junto a las actions porque un archivo `'use server'` solo
 * puede exportar funciones async.
 */
export type FormState = { error?: string; message?: string };

export const EMPTY_STATE: FormState = {};
