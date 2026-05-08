const DEFAULT_SHUTDOWN_AT = (process.env.BWIN_ACCOUNT_CLOSURE_AT || '2026-05-08T08:00:00+03:00').trim();

function parseDate(value) {
  const parsed = new Date(String(value || '').trim() || DEFAULT_SHUTDOWN_AT);
  if (Number.isFinite(parsed.getTime())) {
    return parsed;
  }
  return new Date(DEFAULT_SHUTDOWN_AT);
}

export function getBwinAccountClosureState(now = new Date()) {
  const enabled = String(process.env.BWIN_ACCOUNT_CLOSURE_ENABLED || 'true').trim().toLowerCase() !== 'false';
  const shutdownAt = parseDate(DEFAULT_SHUTDOWN_AT);
  return {
    enabled,
    shutdownAt,
    status: !enabled ? 'disabled' : now.getTime() >= shutdownAt.getTime() ? 'closed' : 'scheduled',
  };
}

export function isBwinAccountClosureActive(now = new Date()) {
  const state = getBwinAccountClosureState(now);
  return state.enabled && state.status === 'closed';
}

export function assertBwinAutomationOpen(label = 'Bwin automation', now = new Date()) {
  const state = getBwinAccountClosureState(now);
  if (state.enabled && state.status === 'closed') {
    throw new Error(`${label} is paused because the Bwin account closed at ${state.shutdownAt.toISOString()}.`);
  }
  return state;
}
