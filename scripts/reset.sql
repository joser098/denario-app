-- =============================================================
-- DESTRUCTIVO. Borra el esquema de Denario v1 por completo.
-- No toca auth.users: las cuentas existentes se conservan, simplemente
-- quedan sin organizacion y pasan por el onboarding de nuevo.
--
-- Los buckets de storage se limpian aparte (scripts/reset-storage.mjs):
-- Supabase bloquea el DELETE directo sobre storage.objects.
-- =============================================================

drop schema if exists public cascade;
create schema public;

grant usage on schema public to anon, authenticated, service_role;
grant all on schema public to postgres;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

-- Historial de migraciones de v1: los archivos ya no existen localmente, asi
-- que `supabase db push` se quejaria de un historial que no puede reconciliar.
drop schema if exists supabase_migrations cascade;
