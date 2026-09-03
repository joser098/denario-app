-- =============================================================
-- Denario v2 — Cotizaciones a dolar, para consolidar la organizacion
--
-- Cada campus carga su Profit & Loss en su moneda, y esta bien que sea asi:
-- el que lo completa cuenta la plata que tiene en la mano. Pero la
-- organizacion necesita un solo numero, y sumar COP con ARS no da nada.
--
-- La cotizacion la carga un administrador, una por moneda y por domingo — el
-- mismo domingo que identifica a los reportes, asi no hay dos calendarios que
-- mantener alineados. Queda guardada: un reporte consolidado de hace tres
-- meses tiene que seguir dando lo mismo aunque el dolar se haya movido.
--
-- El dolar no necesita fila: vale 1 y punto.
-- =============================================================

create table exchange_rates (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  currency_code   text not null references currencies(code),
  -- El domingo del reporte, no una semana abstracta.
  service_date    date not null,

  -- Cuantas unidades de la moneda local equivalen a UN dolar. El nombre dice
  -- la direccion a proposito: "rate" a secas es la mitad de los bugs de
  -- conversion que existen. Para pasar a dolares se divide.
  units_per_usd   numeric(18,6) not null check (units_per_usd > 0),

  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint exchange_rates_is_sunday check (extract(isodow from service_date) = 7),
  -- El dolar no se cotiza contra si mismo.
  constraint exchange_rates_not_usd check (currency_code <> 'USD'),
  unique (organization_id, currency_code, service_date)
);

create index exchange_rates_lookup_idx
  on exchange_rates (organization_id, service_date, currency_code);

create trigger exchange_rates_touch before update on exchange_rates
  for each row execute function public.touch_updated_at();

-- ---------- RLS ----------
-- La lee cualquier miembro (el consolidado la muestra); la carga un
-- administrador: es la que decide cuanto vale el reporte de cada campus.
alter table exchange_rates enable row level security;

create policy exchange_rates_read on exchange_rates
  for select to authenticated using (public.is_org_member(organization_id));

create policy exchange_rates_write on exchange_rates
  for all to authenticated
  using (public.can_admin(organization_id))
  with check (public.can_admin(organization_id));
