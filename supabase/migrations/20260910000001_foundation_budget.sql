-- =============================================================
-- Denario v2 — Foundation Budget en el Profit & Loss
--
-- Una seccion mas del reporte, aparte de ingresos y egresos: el presupuesto
-- de la Fundacion. Arranca de un saldo inicial (O/Bal), le pasan cosas, y
-- cierra en un saldo final (C/Bal).
--
-- Los cinco renglones suman al C/Bal. Todavia no esta definido cual de ellos
-- deberia restar —los "expenses" y el "capital expenditure" son candidatos—
-- asi que por ahora todos suman y las columnas ADMITEN NEGATIVOS: quien
-- carga pone el signo a mano y resta del final.
--
-- Por eso, a proposito, estas cinco columnas no llevan el `check (>= 0)` que
-- si tienen todas las de ingresos y egresos. Cuando se decida cual resta, el
-- cambio es en el calculo del C/Bal, no aca.
--
-- El C/Bal no es columna: es la suma de las cinco. Guardarlo abriria la
-- puerta a que discrepe con sus partes, igual que el resto de los totales
-- del reporte.
-- =============================================================

alter table pl_reports
  add column fnd_opening_balance          numeric(16,2) not null default 0,
  add column fnd_income                   numeric(16,2) not null default 0,
  add column fnd_missional_expenses       numeric(16,2) not null default 0,
  add column fnd_church_operation_support numeric(16,2) not null default 0,
  add column fnd_capital_expenditure      numeric(16,2) not null default 0;
