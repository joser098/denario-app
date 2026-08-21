// DESTRUCTIVO. Vacia y borra los buckets de Denario v1 via la Storage API
// (Supabase no permite DELETE directo sobre storage.objects).
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config({ path: '.env.local', quiet: true });

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const V1_BUCKETS = ['offering-count-actas', 'purchase-attachments', 'org-logos'];

// emptyBucket() no alcanza cuando los archivos estan en subcarpetas: hay que
// recorrer el arbol y borrar por path completo.
async function listAllPaths(bucket, prefix = '') {
  const { data, error } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error || !data) return [];
  const paths = [];
  for (const entry of data) {
    const full = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id === null) paths.push(...(await listAllPaths(bucket, full)));
    else paths.push(full);
  }
  return paths;
}

async function emptyAndDrop(bucket) {
  const paths = await listAllPaths(bucket);
  if (paths.length) {
    const { error } = await admin.storage.from(bucket).remove(paths);
    console.log(`  ${bucket}: ${paths.length} archivos — ${error ? error.message : 'borrados'}`);
  }
  const { error } = await admin.storage.deleteBucket(bucket);
  console.log(`  ${bucket}: ${error ? error.message : 'bucket borrado'}`);
}

const { data: buckets } = await admin.storage.listBuckets();
console.log('Buckets antes:', buckets?.map((b) => b.id).join(', ') || '(ninguno)');

for (const bucket of V1_BUCKETS) await emptyAndDrop(bucket);

const { data: after } = await admin.storage.listBuckets();
console.log('Buckets despues:', after?.map((b) => b.id).join(', ') || '(ninguno)');
