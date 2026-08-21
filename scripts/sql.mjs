// Ejecuta un archivo .sql contra la base de Supabase usando DATABASE_URL.
// Uso: node scripts/sql.mjs <archivo.sql> [...mas archivos]
//
// Existe porque psql no esta instalado en este entorno y porque necesitamos
// correr SQL suelto (reset, seeds de prueba) fuera del flujo de migraciones.
import { readFile } from 'node:fs/promises';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: '.env.local', quiet: true });

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Uso: node scripts/sql.mjs <archivo.sql> [...]');
  process.exit(1);
}

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('Falta DATABASE_URL en .env.local');
  process.exit(1);
}

const client = new pg.Client({
  connectionString,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  for (const file of files) {
    const sql = await readFile(file, 'utf8');
    process.stdout.write(`→ ${file} ... `);
    await client.query(sql);
    console.log('ok');
  }
} catch (error) {
  console.error('\nFALLO:', error.message);
  if (error.position) console.error('  posicion:', error.position);
  process.exitCode = 1;
} finally {
  await client.end();
}
