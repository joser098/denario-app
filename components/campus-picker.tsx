'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
import { Select } from '@/components/ui';

/**
 * Cambia el campus que mira el Resumen.
 *
 * El campus elegido vive en la URL (`?campus=`), no en estado del cliente:
 * asi la pantalla se puede compartir por link y la pagina sigue siendo un
 * server component, que es quien trae los totales. Solo se muestra al que
 * ve todos los campus; el que esta atado a uno no tiene nada que elegir.
 */
export function CampusPicker({
  campuses,
  value,
}: {
  campuses: Array<{ id: string; name: string }>;
  value: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  return (
    <Select
      aria-label="Campus"
      value={value}
      disabled={pending}
      className="h-9 w-full max-w-56"
      onChange={(event) => {
        const next = new URLSearchParams(params);
        next.set('campus', event.target.value);
        startTransition(() => router.replace(`${pathname}?${next}`, { scroll: false }));
      }}
    >
      {campuses.map((campus) => (
        <option key={campus.id} value={campus.id}>
          {campus.name}
        </option>
      ))}
    </Select>
  );
}
