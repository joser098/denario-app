'use client';

/**
 * Última red: un error en el layout raíz, donde ya no hay app alrededor.
 * Tiene que traer su propio <html> y <body> porque reemplaza el documento.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="es-AR">
      <body className="flex min-h-screen items-center justify-center bg-zinc-50 p-6 font-sans">
        <main className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-6">
          <h1 className="text-lg font-semibold text-zinc-900">Algo se rompió</h1>
          <p className="mt-2 text-sm text-zinc-600">
            Probá de nuevo. Si sigue pasando, avisale a quien administra la app.
          </p>
          {error.digest ? (
            <p className="mt-3 font-mono text-xs text-zinc-500">Referencia: {error.digest}</p>
          ) : null}
          <button
            type="button"
            onClick={retry}
            className="mt-4 h-10 rounded-lg bg-zinc-900 px-4 text-sm font-medium text-white"
          >
            Reintentar
          </button>
        </main>
      </body>
    </html>
  );
}
