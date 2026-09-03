-- =============================================================
-- Denario v2 — Mas monedas en el catalogo
--
-- Preparacion para campus en otros paises. El catalogo de monedas es del
-- sistema, no de cada iglesia: una moneda existe o no existe, y lo que cada
-- organizacion elige es cual usa por defecto.
--
-- Las denominaciones son los billetes en circulacion, que es lo que se cuenta
-- en el acta de la ofrenda. Sin ellas la moneda se puede elegir para un monto
-- pero no se puede contar, asi que van juntas.
-- =============================================================

insert into currencies (code, name, symbol) values
  ('COP', 'Peso colombiano', '$'),
  ('BRL', 'Real brasileño',  'R$'),
  ('UYU', 'Peso uruguayo',   '$U'),
  ('MXN', 'Peso mexicano',   '$')
on conflict (code) do nothing;

-- El simbolo se repite entre varios pesos a proposito: el formato de la app
-- imprime siempre el codigo al lado ("$ 1.000 COP"), asi que el simbolo solo
-- nunca tiene que desambiguar.

insert into currency_denominations (currency_code, value)
select 'COP', v from unnest(array[100000, 50000, 20000, 10000, 5000, 2000, 1000]::numeric[]) v
on conflict (currency_code, value) do nothing;

insert into currency_denominations (currency_code, value)
select 'BRL', v from unnest(array[200, 100, 50, 20, 10, 5, 2]::numeric[]) v
on conflict (currency_code, value) do nothing;

insert into currency_denominations (currency_code, value)
select 'UYU', v from unnest(array[2000, 1000, 500, 200, 100, 50, 20]::numeric[]) v
on conflict (currency_code, value) do nothing;

insert into currency_denominations (currency_code, value)
select 'MXN', v from unnest(array[1000, 500, 200, 100, 50, 20]::numeric[]) v
on conflict (currency_code, value) do nothing;
