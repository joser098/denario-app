'use client';

import { useActionState, useRef, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { EMPTY_STATE, type FormState } from '@/lib/forms';
import { Alert, Button, buttonClass } from '@/components/ui';

/**
 * Formulario contra una Server Action. Los campos son children estaticos
 * (Server Components), asi que cada pantalla arma los suyos; aca vive solo
 * el estado: error, mensaje y "enviando".
 */
export function ActionForm({
  action,
  submitLabel,
  submitVariant = 'primary',
  children,
  footer,
  /** Al terminar bien, el formulario se reemplaza por el mensaje. */
  replaceOnSuccess = false,
  /** Vacia los campos despues de un alta exitosa. */
  resetOnSuccess = false,
  className = '',
  fieldsClassName = 'flex flex-col gap-4',
}: {
  action: (prev: FormState, data: FormData) => Promise<FormState>;
  submitLabel: string;
  submitVariant?: 'primary' | 'secondary' | 'danger';
  children: ReactNode;
  footer?: ReactNode;
  replaceOnSuccess?: boolean;
  resetOnSuccess?: boolean;
  className?: string;
  fieldsClassName?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, formAction, pending] = useActionState(
    async (prev: FormState, data: FormData) => {
      const next = await action(prev, data);

      if (!next.error) {
        if (resetOnSuccess) formRef.current?.reset();
        // Si el formulario vive dentro de un modal, sale bien = se cierra.
        // La lista de atrás ya se actualizó sola: dejarlo abierto obligaría
        // a cerrarlo a mano para ver el resultado.
        formRef.current?.closest('dialog')?.close();
      }

      return next;
    },
    EMPTY_STATE,
  );
  const done = replaceOnSuccess && Boolean(state.message);

  return (
    <form ref={formRef} action={formAction} className={`flex flex-col gap-4 ${className}`}>
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.message ? <Alert tone="success">{state.message}</Alert> : null}

      {done ? null : (
        <>
          <fieldset disabled={pending} className={`min-w-0 border-0 p-0 ${fieldsClassName}`}>
            {children}
            <Button type="submit" variant={submitVariant} disabled={pending}>
              {pending ? 'Guardando…' : submitLabel}
            </Button>
          </fieldset>
          {footer}
        </>
      )}
    </form>
  );
}

/**
 * Boton de una accion sin estado propio (borrar, activar). El formulario que
 * lo contiene es un `<form action={serverAction}>` a secas.
 */
export function SubmitButton({
  children,
  variant = 'secondary',
  className = '',
  confirm,
  disabled = false,
  title,
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  className?: string;
  /** Texto del confirm() del navegador. Solo para acciones destructivas. */
  confirm?: string;
  disabled?: boolean;
  title?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      title={title}
      disabled={pending || disabled}
      onClick={
        confirm
          ? (event) => {
              if (!window.confirm(confirm)) event.preventDefault();
            }
          : undefined
      }
      className={buttonClass(variant, className)}
    >
      {pending ? '…' : children}
    </button>
  );
}
