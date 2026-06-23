const target = process.env.LOAD_TEST_URL || 'https://dottmediaapk.onrender.com/healthz';
const concurrency = Math.max(Number(process.env.LOAD_TEST_CONCURRENCY || 20), 1);
const total = Math.max(Number(process.env.LOAD_TEST_REQUESTS || 200), concurrency);

if (process.env.LOAD_TEST_INSECURE_TLS === 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

const results = [];
let next = 0;

async function runOne(index) {
  const started = performance.now();
  try {
    const response = await fetch(target, { headers: { 'x-load-test': '1' } });
    await response.arrayBuffer();
    results[index] = { ok: response.ok, status: response.status, ms: performance.now() - started };
  } catch (error) {
    results[index] = { ok: false, status: 0, ms: performance.now() - started, error: error?.message || 'request_failed' };
  }
}

async function worker() {
  while (next < total) {
    const index = next++;
    await runOne(index);
  }
}

await Promise.all(Array.from({ length: concurrency }, () => worker()));

const sorted = results.map(result => result.ms).sort((a, b) => a - b);
const percentile = value => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * value))] ?? 0;
const ok = results.filter(result => result.ok).length;
const byStatus = results.reduce((acc, result) => {
  acc[result.status] = (acc[result.status] || 0) + 1;
  return acc;
}, {});

console.log(JSON.stringify({
  target,
  total,
  concurrency,
  ok,
  failed: total - ok,
  byStatus,
  latencyMs: {
    p50: Math.round(percentile(0.5)),
    p90: Math.round(percentile(0.9)),
    p95: Math.round(percentile(0.95)),
    p99: Math.round(percentile(0.99)),
    max: Math.round(sorted[sorted.length - 1] ?? 0),
  },
}, null, 2));
