'use client';

import { useEffect } from 'react';
import { Button, Card } from '@/components/ui';

/**
 * Una consulta que falla ya no deja la pantalla de error cruda de Next.
 *
 * En esta versión el segundo argumento es `retry`, no `reset`: reintenta el
 * segmento sin recargar toda la página, así que no se pierde la sesión ni el
 * scroll de la lista de atrás.
 */
export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <Card className="flex flex-col items-start gap-3 p-6">
      <h1 className="text-lg font-semibold text-navy-900">No pudimos cargar esta pantalla</h1>
      <p className="text-sm text-zinc-600">
        Puede ser un problema de conexión con la base. Probá de nuevo; si sigue pasando, avisale a
        quien administra la app.
      </p>
      {/* El digest es lo único que sirve para encontrar el error en los logs
          del servidor: el mensaje real no viaja al navegador en producción. */}
      {error.digest ? (
        <p className="font-mono text-xs text-zinc-500">Referencia: {error.digest}</p>
      ) : null}
      <Button type="button" onClick={retry}>
        Reintentar
      </Button>
    </Card>
  );
}
