-- =============================================================
-- Denario v2 — Tipo de documento del campus
--
-- El acta de conteo pasa a dejar un renglon en blanco al lado de cada firma
-- para anotar el documento a mano al momento de firmar. El numero no se
-- guarda en la base: lo que se guarda es como se llama el documento en el
-- pais del campus, que es la etiqueta que se imprime.
--
-- DNI en Argentina, CPF en Brasil, CC en Colombia, CI en Uruguay y CURP en
-- Mexico. La lista vive tambien en lib/documents.ts: al agregar un pais hay
-- que tocar los dos lados.
--
-- Los campus que ya existen quedan en DNI por el default, que es donde esta
-- hoy la operacion. La columna es not null con default, asi que ninguna
-- consulta ni ningun insert de los que ya andan cambia.
-- =============================================================

alter table campuses
  add column document_type text not null default 'DNI'
    constraint campuses_document_type_check
    check (document_type in ('DNI', 'CPF', 'CC', 'CI', 'CURP'));
