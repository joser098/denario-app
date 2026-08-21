'use client';

import { useState } from 'react';
import { buttonClass } from '@/components/ui';

/**
 * No mandamos mails de invitacion: el admin copia este link y se lo pasa a la
 * persona por donde le quede comodo.
 */
export function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="flex min-w-0 flex-1 gap-2">
      <input
        readOnly
        value={value}
        onFocus={(event) => event.currentTarget.select()}
        className="h-9 min-w-0 flex-1 rounded-lg border border-zinc-200 bg-zinc-50 px-2 font-mono text-xs text-zinc-600"
      />
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          } catch {
            // Sin permiso de portapapeles queda el input para copiar a mano.
          }
        }}
        className={buttonClass('secondary', 'h-9 shrink-0')}
      >
        {copied ? 'Copiado' : 'Copiar'}
      </button>
    </div>
  );
}
