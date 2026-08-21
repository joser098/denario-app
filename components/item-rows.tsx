'use client';

import { useState } from 'react';
import { Input } from '@/components/ui';

/**
 * Las filas de ítems del pedido de compra. Los campos se repiten con el
 * mismo nombre y el servidor los lee en paralelo, así que agregar una fila
 * es solo dibujar tres inputs más.
 */
export function ItemRows({ initial = 3 }: { initial?: number }) {
  const [rows, setRows] = useState(initial);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-[1fr_5rem_5rem] gap-2 text-xs font-medium text-zinc-500">
        <span>Qué se necesita</span>
        <span>Cantidad</span>
        <span>Unidad</span>
      </div>

      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="grid grid-cols-[1fr_5rem_5rem] gap-2">
          <Input name="item_name" placeholder={index === 0 ? 'Sillas plegables' : ''} />
          <Input name="item_quantity" type="number" min={0} step="0.01" />
          <Input name="item_unit" placeholder={index === 0 ? 'u.' : ''} />
        </div>
      ))}

      <button
        type="button"
        onClick={() => setRows((current) => current + 1)}
        className="self-start text-sm font-medium text-brand-600 hover:underline"
      >
        + Agregar ítem
      </button>
    </div>
  );
}
