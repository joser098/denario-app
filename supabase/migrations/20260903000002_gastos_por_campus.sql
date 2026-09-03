-- =============================================================
-- Denario v2 — Gastos por campus, y Presupuestos deja de ser un flujo
--
-- Tres cambios que van juntos porque se pisan entre si:
--
-- 1. Gastos pasa a ser del campus, no de la organizacion. El link publico
--    deja de ser uno por iglesia y pasa a ser uno por campus: el link dice
--    de que campus es el pedido, asi que quien pide no elige nada.
--
-- 2. "Presupuestos" cambia de significado. Lo que hasta hoy se llamaba asi
--    —pedir plata, que un administrador apruebe y pague— pasa a llamarse
--    "Pagos y transferencias", que es lo que siempre fue. El nombre queda
--    libre para lo que ahora si es un presupuesto: una cotizacion que se
--    presenta y queda documentada. Sin estados, sin aprobacion, sin plata.
--
-- 3. Aparece "Pagos en efectivo": un registro interno que genera un recibo
--    para imprimir y que el acreedor firma. No entra por link publico.
--
-- Y decidir sobre un gasto deja de ser solo de administradores: el tesorero
-- decide sobre su campus, que es la plata que ya venia manejando.
-- =============================================================

-- ---------- 1. El link publico es del campus ----------
alter table campuses add column public_request_token text;

create or replace function public.new_request_token()
returns text language plpgsql volatile as $fn$
declare candidate text;
begin
  loop
    candidate := public.gen_public_id(6);
    exit when not exists (
      select 1 from campuses where public_request_token = candidate
    );
  end loop;
  return candidate;
end;
$fn$;

-- Fila por fila: dentro de un UPDATE masivo cada llamada no veria los tokens
-- que asignaron las filas anteriores.
do $backfill$
declare r record;
begin
  for r in select id from campuses loop
    update campuses set public_request_token = public.new_request_token() where id = r.id;
  end loop;
end;
$backfill$;

alter table campuses
  alter column public_request_token set not null,
  alter column public_request_token set default public.new_request_token(),
  add constraint campuses_public_request_token_key unique (public_request_token);

-- El de la organizacion ya no se usa: un link = un campus.
alter table organizations
  drop constraint if exists organizations_public_request_token_key,
  drop column public_request_token;

-- ---------- 2. Compras: de que campus es el pedido ----------
alter table purchase_requests
  add column campus_id uuid references campuses(id) on delete cascade;

-- Lo que ya estaba cargado va al campus mas viejo de su organizacion: es el
-- unico criterio disponible y en una iglesia de un solo campus es exacto.
update purchase_requests p
set campus_id = (
  select c.id from campuses c
  where c.organization_id = p.organization_id
  order by c.created_at, c.id
  limit 1
)
where p.campus_id is null;

alter table purchase_requests alter column campus_id set not null;
create index purchase_requests_campus_idx on purchase_requests (campus_id, status);

-- ---------- 3. Presupuestos pasa a ser Pagos y transferencias ----------
-- Se renombra, no se copia: son las mismas solicitudes con el mismo estado,
-- solo que ahora se llaman por lo que hacen.
alter type budget_status rename to payment_status;
alter table budget_requests rename to payment_requests;

alter index budget_requests_org_status_idx rename to payment_requests_org_status_idx;
alter trigger budget_requests_touch on payment_requests rename to payment_requests_touch;

alter table payment_requests
  add column campus_id uuid references campuses(id) on delete cascade;

update payment_requests p
set campus_id = (
  select c.id from campuses c
  where c.organization_id = p.organization_id
  order by c.created_at, c.id
  limit 1
)
where p.campus_id is null;

alter table payment_requests alter column campus_id set not null;
create index payment_requests_campus_idx on payment_requests (campus_id, status);

-- Los nombres que viajan como texto tambien cambian: el movimiento del libro
-- semanal y los adjuntos apuntan a la tabla por su nombre.
update week_entries set source_type = 'payment_request' where source_type = 'budget_request';
update attachments   set attachable_type = 'payment_request' where attachable_type = 'budget_request';

-- ---------- 4. Presupuestos, ahora si ----------
-- Una cotizacion que alguien presenta y queda archivada. No tiene estado
-- porque no hay nada que decidir: si hay que pagarla, sale de aca una
-- solicitud de pago y las dos quedan enlazadas.
create table budgets (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  campus_id          uuid not null references campuses(id) on delete cascade,
  team_id            uuid references teams(id),
  requester_name     text not null,
  requester_email    text,
  requester_phone    text,
  description        text not null,
  estimated_amount   numeric(14,2) not null check (estimated_amount > 0),
  estimated_currency text references currencies(code),
  -- Se llena cuando alguien genera la solicitud de pago desde este
  -- presupuesto. Null = todavia es solo documentacion.
  payment_request_id uuid references payment_requests(id) on delete set null,
  public_token       text not null unique default encode(gen_random_bytes(16), 'hex'),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index budgets_campus_idx on budgets (campus_id, created_at desc);
create trigger budgets_touch before update on budgets
  for each row execute function public.touch_updated_at();

-- ---------- 5. Pagos en efectivo ----------
-- Interno: lo carga la tesoreria, no entra por link. Lo que se imprime es un
-- recibo, y el numero es lo que lo identifica en papel — correlativo por
-- campus, porque cada campus lleva su propia caja.
create table cash_payments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  campus_id       uuid not null references campuses(id) on delete cascade,
  receipt_number  integer not null,
  payee_name      text not null,
  payee_document  text,
  concept         text not null,
  team_id         uuid references teams(id),
  amount          numeric(14,2) not null check (amount > 0),
  currency_code   text not null references currencies(code),
  paid_on         date not null,
  notes           text,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (campus_id, receipt_number)
);
create index cash_payments_campus_idx on cash_payments (campus_id, created_at desc);
create trigger cash_payments_touch before update on cash_payments
  for each row execute function public.touch_updated_at();

create or replace function public.assign_receipt_number()
returns trigger language plpgsql as $fn$
begin
  if new.receipt_number is null then
    -- Sin el lock, dos recibos simultaneos del mismo campus leerian el mismo
    -- maximo y uno de los dos chocaria contra el unique. Se suelta solo al
    -- terminar la transaccion.
    perform pg_advisory_xact_lock(hashtext(new.campus_id::text));
    select coalesce(max(receipt_number), 0) + 1 into new.receipt_number
    from cash_payments where campus_id = new.campus_id;
  end if;
  return new;
end;
$fn$;

create trigger cash_payments_number before insert on cash_payments
  for each row execute function public.assign_receipt_number();

-- ---------- 6. Los adjuntos tambien son de un campus ----------
alter table attachments
  add column campus_id uuid references campuses(id) on delete cascade;

update attachments a
set campus_id = coalesce(
  (select p.campus_id from purchase_requests p
    where a.attachable_type = 'purchase_request' and p.id = a.attachable_id),
  (select r.campus_id from payment_requests r
    where a.attachable_type = 'payment_request' and r.id = a.attachable_id)
)
where a.campus_id is null;

create index attachments_campus_idx on attachments (campus_id);

-- ---------- 7. Conceptos del libro semanal ----------
-- El concepto que se llamaba "presupuestos" es el de las solicitudes que
-- ahora son pagos y transferencias: se renombra con ellas. El efectivo lleva
-- concepto propio para que en el Semanal se vea de donde salio cada peso.
update week_concepts
set code = 'pagos', name = 'Pagos y transferencias'
where code = 'presupuestos';

insert into week_concepts (organization_id, code, name, allowed_currencies, kind, sort_order)
values (null, 'pagos-efectivo', 'Pagos en efectivo', array['ARS','USD'], 'expense', 130);

insert into week_concepts (
  organization_id, code, name, allowed_currencies, has_movement_count, kind, sort_order
)
select o.id, t.code, t.name, t.allowed_currencies, t.has_movement_count, t.kind, t.sort_order
from organizations o
cross join week_concepts t
where t.organization_id is null
  and t.code = 'pagos-efectivo'
  and not exists (
    select 1 from week_concepts c where c.organization_id = o.id and c.code = t.code
  );

-- ---------- 8. Bootstrap de organizaciones nuevas ----------
-- Igual que antes, salvo que el campus ya nace con su token (default) y los
-- conceptos clonados incluyen el de efectivo.
create or replace function public.create_organization(
  p_name     text,
  p_slug     text,
  p_timezone text default 'America/Argentina/Buenos_Aires',
  p_currency text default 'ARS'
) returns uuid
language plpgsql security definer set search_path = public as $fn$
declare
  v_org    uuid;
  v_campus uuid;
  v_user   uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Necesitas una sesion activa para crear una organizacion.';
  end if;

  insert into organizations (name, slug, timezone, default_currency)
  values (p_name, p_slug, p_timezone, p_currency)
  returning id into v_org;

  insert into organization_members (organization_id, user_id, role)
  values (v_org, v_user, 'owner');

  insert into campuses (organization_id, name, slug, default_currency, timezone)
  values (v_org, 'Campus Principal', 'campus-principal', p_currency, p_timezone)
  returning id into v_campus;

  insert into meeting_templates (organization_id, campus_id, label, start_time, sort_order) values
    (v_org, v_campus, 'Reunion 1', '10:30', 10),
    (v_org, v_campus, 'Reunion 2', '12:30', 20),
    (v_org, v_campus, 'Reunion 3', '17:30', 30),
    (v_org, v_campus, 'Reunion 4', '20:00', 40);

  insert into week_concepts (
    organization_id, code, name, allowed_currencies, has_movement_count, kind, sort_order
  )
  select v_org, code, name, allowed_currencies, has_movement_count, kind, sort_order
  from week_concepts where organization_id is null;

  return v_org;
end;
$fn$;

-- ---------- 9. RLS ----------
-- Todo Gastos pasa a decidirse por campus, y con can_write en vez de
-- can_admin: el tesorero decide sobre los gastos de su campus.
--
-- Ninguna tabla que nace por link publico tiene policy de INSERT para
-- authenticated, salvo payment_requests: desde un presupuesto se puede
-- generar la solicitud de pago, y eso si lo hace alguien con sesion.

alter table budgets       enable row level security;
alter table cash_payments enable row level security;

drop policy if exists purchase_requests_read on purchase_requests;
create policy purchase_requests_read on purchase_requests
  for select to authenticated
  using (public.can_read_campus(organization_id, campus_id));

drop policy if exists purchase_requests_decide on purchase_requests;
create policy purchase_requests_decide on purchase_requests
  for update to authenticated
  using (public.can_write_campus(organization_id, campus_id))
  with check (public.can_write_campus(organization_id, campus_id));

drop policy if exists purchase_request_items_read on purchase_request_items;
create policy purchase_request_items_read on purchase_request_items
  for select to authenticated
  using (
    exists (
      select 1 from purchase_requests r
      where r.id = purchase_request_id
        and public.can_read_campus(r.organization_id, r.campus_id)
    )
  );

drop policy if exists budget_requests_read on payment_requests;
create policy payment_requests_read on payment_requests
  for select to authenticated
  using (public.can_read_campus(organization_id, campus_id));

drop policy if exists budget_requests_decide on payment_requests;
create policy payment_requests_decide on payment_requests
  for update to authenticated
  using (public.can_write_campus(organization_id, campus_id))
  with check (public.can_write_campus(organization_id, campus_id));

create policy payment_requests_insert on payment_requests
  for insert to authenticated
  with check (public.can_write_campus(organization_id, campus_id));

create policy budgets_read on budgets
  for select to authenticated
  using (public.can_read_campus(organization_id, campus_id));
create policy budgets_write on budgets
  for all to authenticated
  using (public.can_write_campus(organization_id, campus_id))
  with check (public.can_write_campus(organization_id, campus_id));

create policy cash_payments_read on cash_payments
  for select to authenticated
  using (public.can_read_campus(organization_id, campus_id));
create policy cash_payments_write on cash_payments
  for all to authenticated
  using (public.can_write_campus(organization_id, campus_id))
  with check (public.can_write_campus(organization_id, campus_id));

drop policy if exists attachments_read on attachments;
create policy attachments_read on attachments
  for select to authenticated
  using (public.can_read_campus(organization_id, campus_id));

drop policy if exists attachments_write on attachments;
create policy attachments_write on attachments
  for all to authenticated
  using (public.can_write_campus(organization_id, campus_id))
  with check (public.can_write_campus(organization_id, campus_id));

-- ---------- 10. Adjuntos en el bucket privado ----------
-- El path es  <organization_id>/<tipo>/<id>/<archivo> . El campus sale de la
-- fila a la que cuelga, no de la de attachments: al subir el archivo esa fila
-- todavia no existe, asi que mirarla no serviria para el insert.
create or replace function public.adjunto_campus(object_name text)
returns uuid language sql stable security definer set search_path = public as $fn$
  select case split_part(object_name, '/', 2)
    when 'purchase_request' then
      (select p.campus_id from purchase_requests p
        where p.id = (split_part(object_name, '/', 3))::uuid)
    when 'payment_request' then
      (select r.campus_id from payment_requests r
        where r.id = (split_part(object_name, '/', 3))::uuid)
    when 'budget' then
      (select b.campus_id from budgets b
        where b.id = (split_part(object_name, '/', 3))::uuid)
    when 'cash_payment' then
      (select cp.campus_id from cash_payments cp
        where cp.id = (split_part(object_name, '/', 3))::uuid)
  end
  where split_part(object_name, '/', 3) ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$';
$fn$;

drop policy if exists adjuntos_read on storage.objects;
create policy adjuntos_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'adjuntos'
    and public.can_read_campus(public.acta_org(name), public.adjunto_campus(name))
  );

drop policy if exists adjuntos_insert on storage.objects;
create policy adjuntos_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'adjuntos'
    and public.can_write_campus(public.acta_org(name), public.adjunto_campus(name))
  );
