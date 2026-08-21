// Consulta rapida contra la base. Uso: node scripts/query.mjs "select ..."
import { config } from 'dotenv';
import pg from 'pg';

config({ path: '.env.local', quiet: true });

const sql = process.argv.slice(2).join(' ');
if (!sql) {
  console.error('Uso: node scripts/query.mjs "select 1"');
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  const result = await client.query(sql);
  const results = Array.isArray(result) ? result : [result];
  for (const r of results) {
    if (r.rows?.length) console.table(r.rows);
    else console.log(`${r.command ?? 'OK'} — ${r.rowCount ?? 0} filas`);
  }
} catch (error) {
  console.error('FALLO:', error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
