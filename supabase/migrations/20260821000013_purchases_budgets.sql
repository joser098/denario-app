-- =============================================================
-- Denario v2 — Gastos: Compras y Presupuestos
--
-- Portado del flujo 18 de Denario v1. Quien pide NO tiene cuenta: entra por
-- un link publico de la organizacion y carga la solicitud. Desde la app,
-- un administrador aprueba, rechaza, entrega o paga.
--
--   Compras      pendiente -> aprobada -> entregada   (o rechazada)
--   Presupuestos pendiente -> pagado                  (o rechazado)
--
-- Al cerrar cada flujo se genera el egreso en el libro semanal. Los montos
-- van dos veces: el estimado que declaro quien pide, y el real al cerrar.
-- =============================================================

-- ---------- Equipos ----------
-- Los ministerios/areas que piden. Mismo shape que campuses, pero la gestion
-- es solo de administradores: un tesorero no inventa equipos.
create table teams (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  slug            text not null,
  is_active       boolean not null default true,
  sort_order      smallint not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, slug)
);
create index teams_org_idx on teams (organization_id);
create trigger teams_touch before update on teams
  for each row execute function public.touch_updated_at();

-- ---------- Medios de pago ----------
-- Catalogo propio de cada iglesia: "Transferencia Macro" o "Tarjeta de la
-- comision" son nombres que pone cada una, no un enum del sistema.
create table payment_methods (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name            text not null,
  is_active       boolean not null default true,
  sort_order      smallint not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, name)
);
create index payment_methods_org_idx on payment_methods (organization_id);
create trigger payment_methods_touch before update on payment_methods
  for each row execute function public.touch_updated_at();

insert into payment_methods (organization_id, name, sort_order)
select o.id, m.name, m.sort_order
from organizations o
cross join (values ('Efectivo', 10), ('Transferencia', 20), ('MercadoPago', 30)) as m(name, sort_order);

-- ---------- Link publico de la organizacion ----------
-- Uno solo por organizacion, compartible y regenerable si se filtra. A
-- diferencia del token de invitacion, no identifica a una persona.
alter table organizations add column public_request_token text;

update organizations
set public_request_token = encode(gen_random_bytes(16), 'hex')
where public_request_token is null;

alter table organizations
  alter column public_request_token set not null,
  alter column public_request_token set default encode(gen_random_bytes(16), 'hex'),
  add constraint organizations_public_request_token_key unique (public_request_token);

-- ---------- Compras ----------
create type purchase_status as enum ('pending', 'approved', 'rejected', 'delivered');

create table purchase_requests (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  team_id            uuid not null references teams(id),
  requester_name     text not null,
  requester_email    text,
  requester_phone    text,
  estimated_amount   numeric(14,2),
  estimated_currency text references currencies(code),
  status             purchase_status not null default 'pending',
  rejection_reason   text,
  actual_amount      numeric(14,2),
  actual_currency    text references currencies(code),
  -- Para que quien pidio siga su solicitud sin cuenta.
  public_token       text not null unique default encode(gen_random_bytes(16), 'hex'),
  decided_by         uuid references auth.users(id) on delete set null,
  decided_at         timestamptz,
  delivered_by       uuid references auth.users(id) on delete set null,
  delivered_at       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index purchase_requests_org_status_idx on purchase_requests (organization_id, status);
create index purchase_requests_org_team_idx on purchase_requests (organization_id, team_id);
create trigger purchase_requests_touch before update on purchase_requests
  for each row execute function public.touch_updated_at();

-- Lo que se pide, en items. Se crean junto a la solicitud y no se tocan
-- despues: si el pedido cambia, se rechaza y se hace otro.
create table purchase_request_items (
  id                  uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references purchase_requests(id) on delete cascade,
  name                text not null,
  quantity            numeric(12,2) not null check (quantity > 0),
  unit                text
);
create index purchase_request_items_request_idx on purchase_request_items (purchase_request_id);

-- ---------- Presupuestos ----------
-- Pedido extraordinario: una descripcion y un monto, sin lista de items.
-- Aprobar y pagar son un solo paso.
create type budget_status as enum ('pending', 'rejected', 'paid');

create table budget_requests (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid not null references organizations(id) on delete cascade,
  team_id            uuid references teams(id),
  requester_name     text not null,
  requester_email    text,
  requester_phone    text,
  description        text not null,
  estimated_amount   numeric(14,2) not null check (estimated_amount > 0),
  estimated_currency text references currencies(code),
  status             budget_status not null default 'pending',
  rejection_reason   text,
  payment_method_id  uuid references payment_methods(id) on delete set null,
  actual_amount      numeric(14,2),
  actual_currency    text references currencies(code),
  public_token       text not null unique default encode(gen_random_bytes(16), 'hex'),
  decided_by         uuid references auth.users(id) on delete set null,
  decided_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index budget_requests_org_status_idx on budget_requests (organization_id, status);
create trigger budget_requests_touch before update on budget_requests
  for each row execute function public.touch_updated_at();

-- ---------- Adjuntos ----------
-- Polimorfica a proposito: hoy cuelga de compras y presupuestos, mañana de
-- lo que haga falta, sin una tabla nueva por cada cosa.
create table attachments (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references organizations(id) on delete cascade,
  attachable_type   text not null,
  attachable_id     uuid not null,
  kind              text not null,
  storage_path      text not null,
  original_filename text not null,
  content_type      text not null,
  uploaded_by       uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);
create index attachments_attachable_idx on attachments (attachable_type, attachable_id);
create index attachments_org_idx on attachments (organization_id);

insert into storage.buckets (id, name, public, file_size_limit)
values ('adjuntos', 'adjuntos', false, 10485760)
on conflict (id) do nothing;

create policy adjuntos_read on storage.objects
  for select to authenticated
  using (bucket_id = 'adjuntos' and public.is_org_member(public.acta_org(name)));

-- ---------- RLS ----------
alter table teams                  enable row level security;
alter table payment_methods        enable row level security;
alter table purchase_requests      enable row level security;
alter table purchase_request_items enable row level security;
alter table budget_requests        enable row level security;
alter table attachments            enable row level security;

create policy teams_read on teams
  for select to authenticated using (public.is_org_member(organization_id));
create policy teams_write on teams
  for all to authenticated
  using (public.can_admin(organization_id)) with check (public.can_admin(organization_id));

create policy payment_methods_read on payment_methods
  for select to authenticated using (public.is_org_member(organization_id));
create policy payment_methods_write on payment_methods
  for all to authenticated
  using (public.can_admin(organization_id)) with check (public.can_admin(organization_id));

-- Sin policy de INSERT: las solicitudes nacen SIEMPRE por el link publico,
-- que corre con service-role porque no hay auth.uid(). Desde la app solo se
-- leen y se deciden.
create policy purchase_requests_read on purchase_requests
  for select to authenticated using (public.is_org_member(organization_id));
create policy purchase_requests_decide on purchase_requests
  for update to authenticated
  using (public.can_admin(organization_id)) with check (public.can_admin(organization_id));

create policy purchase_request_items_read on purchase_request_items
  for select to authenticated
  using (
    exists (
      select 1 from purchase_requests r
      where r.id = purchase_request_id and public.is_org_member(r.organization_id)
    )
  );

create policy budget_requests_read on budget_requests
  for select to authenticated using (public.is_org_member(organization_id));
create policy budget_requests_decide on budget_requests
  for update to authenticated
  using (public.can_admin(organization_id)) with check (public.can_admin(organization_id));

create policy attachments_read on attachments
  for select to authenticated using (public.is_org_member(organization_id));
create policy attachments_write on attachments
  for all to authenticated
  using (public.can_write(organization_id)) with check (public.can_write(organization_id));
