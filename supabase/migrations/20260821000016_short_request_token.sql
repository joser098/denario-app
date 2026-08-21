-- =============================================================
-- Denario v2 — Link de pedidos corto
--
-- Era un hexadecimal de 32 caracteres: imposible de dictar por telefono y
-- feo de pegar en un grupo. Pasa al mismo formato que los links de conteo y
-- de caja: 6 caracteres del alfabeto sin I/O/0/1.
--
-- Los tokens de seguimiento de cada solicitud (purchase_requests.public_token
-- y budget_requests.public_token) NO cambian: esos abren los datos de
-- contacto de quien pidio, y 6 caracteres se adivinan a fuerza bruta.
-- =============================================================

create or replace function public.new_request_token()
returns text language plpgsql volatile as $fn$
declare candidate text;
begin
  loop
    candidate := public.gen_public_id(6);
    exit when not exists (
      select 1 from organizations where public_request_token = candidate
    );
  end loop;
  return candidate;
end;
$fn$;

alter table organizations
  alter column public_request_token set default public.new_request_token();

-- Fila por fila: dentro de un UPDATE masivo cada llamada no veria los tokens
-- que asignaron las filas anteriores.
do $backfill$
declare r record;
begin
  for r in select id from organizations loop
    update organizations
      set public_request_token = public.new_request_token()
      where id = r.id;
  end loop;
end;
$backfill$;

-- La app la llama al regenerar el link desde Gastos.
revoke all on function public.new_request_token() from public;
grant execute on function public.new_request_token() to authenticated;
