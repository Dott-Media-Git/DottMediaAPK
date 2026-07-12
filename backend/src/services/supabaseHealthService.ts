import axios from 'axios';
import { Client } from 'pg';

type CheckResult = {
  ok: boolean;
  configured: boolean;
  reachable?: boolean;
  schemaReady?: boolean;
  status?: number | null;
  error?: string;
  durationMs?: number;
};

type SupabaseHealth = {
  ok: boolean;
  projectRef: string | null;
  rest: CheckResult;
  database: CheckResult;
};

const SUPABASE_URL = (process.env.SUPABASE_URL ?? '').trim().replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
const SUPABASE_DATABASE_URL = (process.env.SUPABASE_DATABASE_URL ?? '').trim();

const projectRefFromUrl = () => {
  try {
    return SUPABASE_URL ? new URL(SUPABASE_URL).hostname.split('.')[0] || null : null;
  } catch {
    return null;
  }
};

const messageFromError = (error: unknown) => {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const code = error.code;
    return [status ? `status=${status}` : null, code ? `code=${code}` : null, error.message]
      .filter(Boolean)
      .join(' ');
  }
  return error instanceof Error ? error.message : String(error);
};

const checkRest = async (): Promise<CheckResult> => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, configured: false, error: 'SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing' };
  }

  const started = Date.now();
  try {
    const response = await axios.get(`${SUPABASE_URL}/rest/v1/dott_autopost_jobs`, {
      params: { select: 'user_id', limit: 1 },
      headers: {
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        'User-Agent': 'DottMediaBackend/1.0',
      },
      timeout: Number(process.env.SUPABASE_HEALTH_TIMEOUT_MS ?? 10000),
      validateStatus: status => status < 500,
    });
    const schemaMissing =
      response.status === 404 &&
      typeof response.data === 'object' &&
      response.data !== null &&
      (response.data as { code?: string }).code === 'PGRST205';
    return {
      ok: response.status >= 200 && response.status < 300,
      configured: true,
      reachable: response.status < 500,
      schemaReady: !schemaMissing && response.status >= 200 && response.status < 300,
      status: response.status,
      error: schemaMissing ? 'Supabase reachable, migration tables not created yet' : response.status >= 300 ? `REST returned ${response.status}` : undefined,
      durationMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      reachable: false,
      schemaReady: false,
      status: axios.isAxiosError(error) ? error.response?.status ?? null : null,
      error: messageFromError(error),
      durationMs: Date.now() - started,
    };
  }
};

const checkDatabase = async (): Promise<CheckResult> => {
  if (!SUPABASE_DATABASE_URL) {
    return { ok: false, configured: false, error: 'SUPABASE_DATABASE_URL missing' };
  }

  const started = Date.now();
  const client = new Client({
    connectionString: SUPABASE_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: Number(process.env.SUPABASE_HEALTH_TIMEOUT_MS ?? 10000),
  });

  try {
    await client.connect();
    await client.query('select 1');
    return { ok: true, configured: true, durationMs: Date.now() - started };
  } catch (error) {
    return {
      ok: false,
      configured: true,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    };
  } finally {
    await client.end().catch(() => undefined);
  }
};

export const checkSupabaseHealth = async (): Promise<SupabaseHealth> => {
  const [rest, database] = await Promise.all([checkRest(), checkDatabase()]);
  return {
    ok: (rest.ok || rest.reachable === true) && database.ok,
    projectRef: projectRefFromUrl(),
    rest,
    database,
  };
};
