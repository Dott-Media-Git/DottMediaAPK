import '../src/config';
import { checkSupabaseHealth } from '../src/services/supabaseHealthService';

checkSupabaseHealth()
  .then(result => {
    console.info(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  })
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
