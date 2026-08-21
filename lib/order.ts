/**
 * Orden de las listas configurables (reuniones, productos, conceptos).
 *
 * Nadie deberia escribir un numero para decir "esta va antes que aquella":
 * la pantalla ofrece flechas y aca se recalcula toda la numeracion de 10 en
 * 10. Los saltos dejan lugar por si alguna vez hace falta intercalar a mano.
 */
export type Ordered = { id: string; sort_order: number };

export const ORDER_STEP = 10;

export function nextOrder(rows: Ordered[]): number {
  const highest = rows.reduce((max, row) => Math.max(max, row.sort_order), 0);
  return highest + ORDER_STEP;
}

/**
 * Mueve `id` un lugar en la direccion pedida y renumera. Devuelve solo las
 * filas cuyo orden cambio; vacio si el movimiento no era posible (ya estaba
 * en la punta) o el elemento no esta en la lista.
 */
export function reorder(rows: Ordered[], id: string, direction: -1 | 1): Ordered[] {
  const list = [...rows].sort((a, b) => a.sort_order - b.sort_order);
  const index = list.findIndex((row) => row.id === id);
  const target = index + direction;

  if (index < 0 || target < 0 || target >= list.length) return [];

  [list[index], list[target]] = [list[target], list[index]];

  return list
    .map((row, position) => ({
      id: row.id,
      sort_order: (position + 1) * ORDER_STEP,
      previous: row.sort_order,
    }))
    .filter((row) => row.sort_order !== row.previous)
    .map(({ id: rowId, sort_order }) => ({ id: rowId, sort_order }));
}
