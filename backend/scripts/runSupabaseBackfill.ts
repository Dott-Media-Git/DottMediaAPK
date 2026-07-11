import '../src/config';
import { ensureSupabaseFallbackSchema } from '../src/services/supabaseSchemaService';
import { backfillSupabaseFallback } from '../src/services/supabaseBackfillService';

const main = async () => {
  const schemaReady = await ensureSupabaseFallbackSchema();
  if (!schemaReady) {
    throw new Error('Supabase schema initialization failed or is not configured.');
  }
  const backfilled = await backfillSupabaseFallback();
  if (!backfilled) {
    throw new Error('Supabase backfill did not complete.');
  }
  console.info('[supabase-backfill] migration backfill finished');
};

main().catch(error => {
  console.error('[supabase-backfill] migration backfill failed', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
