'use client';

import { useRef, type ReactNode } from 'react';
import { buttonClass } from '@/components/ui';

/**
 * Botón que abre un formulario en una ventana modal.
 *
 * Usa el `<dialog>` del navegador en vez de armar uno a mano: el fondo, el
 * foco atrapado adentro y cerrar con Escape ya vienen resueltos.
 *
 * El formulario de adentro se cierra solo cuando la acción sale bien — lo
 * hace `ActionForm`, que busca el `<dialog>` que lo contiene. Así el botón
 * no necesita conocer al formulario ni pasarle nada.
 */
export function ModalButton({
  label,
  title,
  description,
  children,
  variant = 'primary',
}: {
  label: string;
  title: string;
  description?: string;
  children: ReactNode;
  variant?: 'primary' | 'secondary';
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className={buttonClass(variant)}
      >
        {label}
      </button>

      <dialog
        ref={dialog}
        className="m-auto w-[calc(100%-2rem)] max-w-lg rounded-2xl border border-zinc-200 bg-white p-0 shadow-xl backdrop:bg-navy-950/50"
      >
        <div className="flex flex-col gap-5 p-6">
          <header className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-navy-900">{title}</h2>
              {description ? (
                <p className="mt-1 text-xs text-zinc-500">{description}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              aria-label="Cerrar"
              className="-mr-2 -mt-1 rounded-lg px-2 py-1 text-xl leading-none text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
            >
              ×
            </button>
          </header>

          {children}
        </div>
      </dialog>
    </>
  );
}
