'use client';

import { useActionState, useRef, type ReactNode, type RefObject } from 'react';
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
        <fieldset disabled={pending} className={`min-w-0 border-0 p-0 ${fieldsClassName}`}>
          {children}
          <Button type="submit" variant={submitVariant} disabled={pending}>
            {pending ? 'Guardando…' : submitLabel}
          </Button>
        </fieldset>
      )}

      {/* El footer sobrevive al exito: es donde viven las salidas ("¿Ya tenés
          cuenta? Ingresar"). Ocultarlo dejaba al alta terminada sin a donde ir. */}
      {footer}
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
  label,
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  className?: string;
  /** Texto de la confirmacion. Solo para acciones destructivas. */
  confirm?: string;
  disabled?: boolean;
  title?: string;
  /**
   * Nombre accesible, para los botones cuyo contenido es un simbolo. Sin
   * esto, una flecha "↑" le llega al lector de pantalla como "flecha arriba"
   * y no como "subir".
   */
  label?: string;
}) {
  const { pending } = useFormStatus();
  const dialog = useRef<HTMLDialogElement>(null);

  const common = {
    title,
    'aria-label': label,
    disabled: pending || disabled,
    className: buttonClass(variant, className),
  };

  const content = pending ? '…' : children;

  if (!confirm) {
    return (
      <button type="submit" {...common}>
        {content}
      </button>
    );
  }

  // El confirm() del navegador bloquea el hilo, no se puede estilar y en el
  // telefono aparece como un cartel del sistema que no se parece en nada a la
  // app. El <dialog> nativo ya trae foco atrapado y cierre con Escape.
  return (
    <>
      <button type="button" onClick={() => dialog.current?.showModal()} {...common}>
        {content}
      </button>

      <ConfirmDialog dialog={dialog} message={confirm} variant={variant} />
    </>
  );
}

/**
 * La confirmacion de una accion destructiva.
 *
 * Vive dentro del mismo <form>, asi que su boton de confirmar es un submit
 * comun y no hace falta disparar el envio a mano.
 */
export function ConfirmDialog({
  dialog,
  message,
  variant = 'danger',
  formAction,
}: {
  dialog: RefObject<HTMLDialogElement | null>;
  message: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  /** Cuando confirmar dispara una accion distinta a la del formulario. */
  formAction?: (data: FormData) => void;
}) {
  return (
    <dialog
      ref={dialog}
      aria-label="Confirmar"
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-zinc-200 bg-white p-0 shadow-xl backdrop:bg-navy-950/50"
    >
      <div className="flex flex-col gap-5 p-6">
        <p className="text-sm text-zinc-700">{message}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className={buttonClass('secondary')}
          >
            Cancelar
          </button>
          <button
            type="submit"
            formAction={formAction}
            onClick={() => dialog.current?.close()}
            className={buttonClass(variant === 'ghost' ? 'danger' : variant)}
          >
            Confirmar
          </button>
        </div>
      </div>
    </dialog>
  );
}
