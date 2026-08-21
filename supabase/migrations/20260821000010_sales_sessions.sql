-- =============================================================
-- Denario v2 — Caja de ventas por reunion
--
-- Espeja al acta de conteo: el que vende entra por un link, registra venta
-- por venta, ve cuanto lleva, y al terminar cierra la caja. El cierre firma
-- el total y deja el detalle inmutable.
--
-- Es un link distinto al del conteo: son dos personas distintas y no tienen
-- por que ver el trabajo del otro.
-- =============================================================

-- ---------- Segundo ID publico de la reunion ----------
alter table sunday_meetings add column sales_public_id text;

-- El generador ahora evita colisiones contra las dos columnas: un ID nunca
-- puede ser ambiguo entre la pantalla de conteo y la de ventas.
create or replace function public.new_meeting_public_id()
returns text language plpgsql volatile as $fn$
declare candidate text;
begin
  loop
    candidate := public.gen_public_id(6);
    exit when not exists (
      select 1 from sunday_meetings
      where public_id = candidate or sales_public_id = candidate
    );
  end loop;
  return candidate;
end;
$fn$;

-- Fila por fila: dentro de un mismo UPDATE masivo cada llamada no veria los
-- IDs que asignaron las filas anteriores.
do $backfill$
declare r record;
begin
  for r in select id from sunday_meetings where sales_public_id is null loop
    update sunday_meetings
      set sales_public_id = public.new_meeting_public_id()
      where id = r.id;
  end loop;
end;
$backfill$;

alter table sunday_meetings
  alter column sales_public_id set not null,
  alter column sales_public_id set default public.new_meeting_public_id(),
  add constraint sunday_meetings_sales_public_id_key unique (sales_public_id);

-- ---------- La caja ----------
create type sales_session_status as enum ('open', 'closed');

create table meeting_sales_sessions (
  id           uuid primary key default gen_random_uuid(),
  meeting_id   uuid not null references sunday_meetings(id) on delete cascade,
  seller_name  text not null,
  witness_name text,
  notes        text,
  status       sales_session_status not null default 'open',
  closed_at    timestamptz,
  pdf_path     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
-- Una caja por reunion: dos cajas abiertas para el mismo publico serian dos
-- totales que nadie sabria como conciliar.
create unique index meeting_sales_sessions_one_per_meeting
  on meeting_sales_sessions (meeting_id);

create trigger meeting_sales_sessions_touch before update on meeting_sales_sessions
  for each row execute function public.touch_updated_at();

-- Las ventas cargadas desde la caja quedan atadas a ella. Las que carga la
-- tesoreria desde la app no tienen caja: session_id queda en null.
alter table sales add column session_id uuid references meeting_sales_sessions(id) on delete set null;
create index sales_session_idx on sales (session_id);

-- ---------- Una caja cerrada no se toca ----------
create or replace function public.guard_closed_sales_session()
returns trigger language plpgsql as $fn$
declare current_status sales_session_status;
begin
  if tg_table_name = 'meeting_sales_sessions' then
    if tg_op = 'UPDATE' and old.status = 'closed' then
      -- adjuntar el PDF recien generado es la unica escritura permitida
      if new.status = 'closed' and new.pdf_path is distinct from old.pdf_path then
        return new;
      end if;
      raise exception 'La caja ya esta cerrada.';
    end if;
    return coalesce(new, old);
  else
    select s.status into current_status
    from meeting_sales_sessions s
    where s.id = coalesce(new.session_id, old.session_id);

    if current_status = 'closed' then
      raise exception 'La caja ya esta cerrada: sus ventas no se pueden modificar.';
    end if;
    return coalesce(new, old);
  end if;
end;
$fn$;

create trigger meeting_sales_sessions_guard before update on meeting_sales_sessions
  for each row execute function public.guard_closed_sales_session();
create trigger sales_session_guard before insert or update or delete on sales
  for each row execute function public.guard_closed_sales_session();

-- ---------- RLS ----------
alter table meeting_sales_sessions enable row level security;

create policy sales_sessions_read on meeting_sales_sessions
  for select to authenticated using (public.is_org_member(public.meeting_org(meeting_id)));
create policy sales_sessions_write on meeting_sales_sessions
  for all to authenticated
  using (public.can_write(public.meeting_org(meeting_id)))
  with check (public.can_write(public.meeting_org(meeting_id)));
