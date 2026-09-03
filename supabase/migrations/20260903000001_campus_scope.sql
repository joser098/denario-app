-- =============================================================
-- Denario v2 — El campus del miembro es una barrera, no un filtro
--
-- Hasta aca `organization_members.campus_id` solo recortaba el selector de
-- campus en la app: todas las policies decidian por organizacion, asi que un
-- tesorero de un campus leia — y escribia — los domingos y las semanas de
-- los otros. El campus pasa a ser parte del permiso.
--
-- Regla: owner y admin ven toda la organizacion. Cualquier otro rol con un
-- campus asignado ve unicamente ese campus. Un miembro sin campus asignado
-- sigue viendo todo, que es como se venia usando para los roles globales.
--
-- Las semanas de nivel organizacion (weeks.campus_id null) quedan del lado
-- de "toda la organizacion": no son de ningun campus, asi que un miembro
-- acotado a uno no las ve. Los egresos de Compras y Presupuestos caen ahi,
-- y esos flujos ya son solo de administradores.
-- =============================================================

-- ---------- El alcance del miembro ----------
-- null = ve toda la organizacion. Un uuid = ve solo ese campus.
create or replace function public.member_campus(org uuid)
returns uuid language sql stable security definer set search_path = public as $fn$
  select case when m.role in ('owner', 'admin') then null else m.campus_id end
  from organization_members m
  where m.organization_id = org and m.user_id = auth.uid();
$fn$;

-- `is not distinct from` para que null = null de un lado: una fila sin campus
-- (la semana de toda la organizacion) solo la ve quien no esta acotado.
-- Devuelve true para un no-miembro, porque siempre va en AND con
-- is_org_member/can_write, que son los que resuelven la pertenencia.
create or replace function public.in_campus(org uuid, campus uuid)
returns boolean language sql stable as $fn$
  select public.member_campus(org) is null
      or public.member_campus(org) is not distinct from campus;
$fn$;

create or replace function public.can_read_campus(org uuid, campus uuid)
returns boolean language sql stable as $fn$
  select public.is_org_member(org) and public.in_campus(org, campus);
$fn$;

create or replace function public.can_write_campus(org uuid, campus uuid)
returns boolean language sql stable as $fn$
  select public.can_write(org) and public.in_campus(org, campus);
$fn$;

-- ---------- De que campus es cada fila ----------
-- Espejo de los helpers *_org: lo que cuelga de una reunion hereda el campus
-- del domingo padre.
create or replace function public.sunday_campus(s_id uuid)
returns uuid language sql stable security definer set search_path = public as $fn$
  select s.campus_id from sundays s where s.id = s_id;
$fn$;

create or replace function public.meeting_campus(meeting uuid)
returns uuid language sql stable security definer set search_path = public as $fn$
  select s.campus_id
  from sunday_meetings m join sundays s on s.id = m.sunday_id
  where m.id = meeting;
$fn$;

create or replace function public.count_campus(count_id uuid)
returns uuid language sql stable security definer set search_path = public as $fn$
  select public.meeting_campus(oc.meeting_id) from offering_counts oc where oc.id = count_id;
$fn$;

create or replace function public.sale_campus(s_id uuid)
returns uuid language sql stable security definer set search_path = public as $fn$
  select public.meeting_campus(s.meeting_id) from sales s where s.id = s_id;
$fn$;

create or replace function public.week_campus(w_id uuid)
returns uuid language sql stable security definer set search_path = public as $fn$
  select w.campus_id from weeks w where w.id = w_id;
$fn$;

-- ---------- Domingos ----------
drop policy if exists meeting_templates_read on meeting_templates;
create policy meeting_templates_read on meeting_templates
  for select to authenticated
  using (public.can_read_campus(organization_id, campus_id));

drop policy if exists sundays_read on sundays;
create policy sundays_read on sundays
  for select to authenticated
  using (public.can_read_campus(organization_id, campus_id));

drop policy if exists sundays_write on sundays;
create policy sundays_write on sundays
  for all to authenticated
  using (public.can_write_campus(organization_id, campus_id))
  with check (public.can_write_campus(organization_id, campus_id));

drop policy if exists sunday_meetings_read on sunday_meetings;
create policy sunday_meetings_read on sunday_meetings
  for select to authenticated
  using (public.can_read_campus(public.sunday_org(sunday_id), public.sunday_campus(sunday_id)));

drop policy if exists sunday_meetings_write on sunday_meetings;
create policy sunday_meetings_write on sunday_meetings
  for all to authenticated
  using (public.can_write_campus(public.sunday_org(sunday_id), public.sunday_campus(sunday_id)))
  with check (public.can_write_campus(public.sunday_org(sunday_id), public.sunday_campus(sunday_id)));

drop policy if exists meeting_incomes_read on meeting_incomes;
create policy meeting_incomes_read on meeting_incomes
  for select to authenticated
  using (public.can_read_campus(public.meeting_org(meeting_id), public.meeting_campus(meeting_id)));

drop policy if exists meeting_incomes_write on meeting_incomes;
create policy meeting_incomes_write on meeting_incomes
  for all to authenticated
  using (public.can_write_campus(public.meeting_org(meeting_id), public.meeting_campus(meeting_id)))
  with check (public.can_write_campus(public.meeting_org(meeting_id), public.meeting_campus(meeting_id)));

drop policy if exists sales_read on sales;
create policy sales_read on sales
  for select to authenticated
  using (public.can_read_campus(public.meeting_org(meeting_id), public.meeting_campus(meeting_id)));

drop policy if exists sales_write on sales;
create policy sales_write on sales
  for all to authenticated
  using (public.can_write_campus(public.meeting_org(meeting_id), public.meeting_campus(meeting_id)))
  with check (public.can_write_campus(public.meeting_org(meeting_id), public.meeting_campus(meeting_id)));

drop policy if exists offering_counts_read on offering_counts;
create policy offering_counts_read on offering_counts
  for select to authenticated
  using (public.can_read_campus(public.meeting_org(meeting_id), public.meeting_campus(meeting_id)));

drop policy if exists offering_counts_write on offering_counts;
create policy offering_counts_write on offering_counts
  for all to authenticated
  using (public.can_write_campus(public.meeting_org(meeting_id), public.meeting_campus(meeting_id)))
  with check (public.can_write_campus(public.meeting_org(meeting_id), public.meeting_campus(meeting_id)));

drop policy if exists offering_count_lines_read on offering_count_lines;
create policy offering_count_lines_read on offering_count_lines
  for select to authenticated
  using (
    public.can_read_campus(
      public.count_org(offering_count_id),
      public.count_campus(offering_count_id)
    )
  );

drop policy if exists offering_count_lines_write on offering_count_lines;
create policy offering_count_lines_write on offering_count_lines
  for all to authenticated
  using (
    public.can_write_campus(
      public.count_org(offering_count_id),
      public.count_campus(offering_count_id)
    )
  )
  with check (
    public.can_write_campus(
      public.count_org(offering_count_id),
      public.count_campus(offering_count_id)
    )
  );

drop policy if exists sale_lines_read on sale_lines;
create policy sale_lines_read on sale_lines
  for select to authenticated
  using (public.can_read_campus(public.sale_org(sale_id), public.sale_campus(sale_id)));

drop policy if exists sale_lines_write on sale_lines;
create policy sale_lines_write on sale_lines
  for all to authenticated
  using (public.can_write_campus(public.sale_org(sale_id), public.sale_campus(sale_id)))
  with check (public.can_write_campus(public.sale_org(sale_id), public.sale_campus(sale_id)));

drop policy if exists sales_sessions_read on meeting_sales_sessions;
create policy sales_sessions_read on meeting_sales_sessions
  for select to authenticated
  using (public.can_read_campus(public.meeting_org(meeting_id), public.meeting_campus(meeting_id)));

drop policy if exists sales_sessions_write on meeting_sales_sessions;
create policy sales_sessions_write on meeting_sales_sessions
  for all to authenticated
  using (public.can_write_campus(public.meeting_org(meeting_id), public.meeting_campus(meeting_id)))
  with check (public.can_write_campus(public.meeting_org(meeting_id), public.meeting_campus(meeting_id)));

-- ---------- Semanal ----------
drop policy if exists weeks_read on weeks;
create policy weeks_read on weeks
  for select to authenticated
  using (public.can_read_campus(organization_id, campus_id));

drop policy if exists weeks_write on weeks;
create policy weeks_write on weeks
  for all to authenticated
  using (public.can_write_campus(organization_id, campus_id))
  with check (public.can_write_campus(organization_id, campus_id));

drop policy if exists week_entries_read on week_entries;
create policy week_entries_read on week_entries
  for select to authenticated
  using (public.can_read_campus(public.week_org(week_id), public.week_campus(week_id)));

drop policy if exists week_entries_write on week_entries;
create policy week_entries_write on week_entries
  for all to authenticated
  using (public.can_write_campus(public.week_org(week_id), public.week_campus(week_id)))
  with check (public.can_write_campus(public.week_org(week_id), public.week_campus(week_id)));

-- ---------- Actas en PDF ----------
-- El path es  <organization_id>/<sunday_id>/<archivo>.pdf : el segundo
-- segmento dice de que domingo — y por lo tanto de que campus — es el acta.
-- Sin un sunday_id valido en el path no hay campus, y solo la ve quien no
-- esta acotado a uno.
create or replace function public.acta_campus(object_name text)
returns uuid language sql stable security definer set search_path = public as $fn$
  select public.sunday_campus((split_part(object_name, '/', 2))::uuid)
  where split_part(object_name, '/', 2) ~ '^[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$';
$fn$;

drop policy if exists actas_read on storage.objects;
create policy actas_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'actas'
    and public.can_read_campus(public.acta_org(name), public.acta_campus(name))
  );

drop policy if exists actas_insert on storage.objects;
create policy actas_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'actas'
    and public.can_write_campus(public.acta_org(name), public.acta_campus(name))
  );

drop policy if exists actas_update on storage.objects;
create policy actas_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'actas'
    and public.can_write_campus(public.acta_org(name), public.acta_campus(name))
  )
  with check (
    bucket_id = 'actas'
    and public.can_write_campus(public.acta_org(name), public.acta_campus(name))
  );

-- ---------- Abrir un domingo ----------
-- El insert ya lo frena la policy de sundays; el chequeo explicito es para
-- que el error diga que pasa en vez de "new row violates row-level security".
create or replace function public.open_sunday(p_campus uuid, p_date date)
returns uuid
language plpgsql as $fn$
declare
  v_org    uuid;
  v_sunday uuid;
begin
  select c.organization_id into v_org from campuses c where c.id = p_campus;
  if v_org is null then
    raise exception 'Ese campus no existe o no lo podés ver.';
  end if;

  if not public.in_campus(v_org, p_campus) then
    raise exception 'Ese campus no es el tuyo.';
  end if;

  insert into sundays (organization_id, campus_id, service_date)
  values (v_org, p_campus, p_date)
  returning id into v_sunday;

  insert into sunday_meetings (sunday_id, label, start_time, sort_order)
  select v_sunday, t.label, t.start_time, t.sort_order
  from meeting_templates t
  where t.campus_id = p_campus and t.is_active;

  return v_sunday;
end;
$fn$;
