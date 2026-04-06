
const state = { counters: {}, timings: {}, lastErrors: [] };
function incMetric(name, value = 1) { state.counters[name] = (state.counters[name] || 0) + value; }
function observeTiming(name, ms) {
  const bucket = state.timings[name] || { count: 0, totalMs: 0, maxMs: 0 };
  bucket.count += 1; bucket.totalMs += Number(ms || 0); bucket.maxMs = Math.max(bucket.maxMs, Number(ms || 0));
  state.timings[name] = bucket;
}
function captureError(error, context = {}) {
  state.lastErrors.unshift({ at: new Date().toISOString(), message: error?.message || String(error), context });
  state.lastErrors = state.lastErrors.slice(0, 25);
  incMetric('errors.total');
}
function getMetricsSnapshot() {
  const timings = Object.fromEntries(Object.entries(state.timings).map(([k, v]) => [k, { ...v, avgMs: v.count ? Math.round(v.totalMs / v.count) : 0 }]));
  return { counters: { ...state.counters }, timings, lastErrors: [...state.lastErrors], generatedAt: new Date().toISOString() };
}
module.exports = { incMetric, observeTiming, captureError, getMetricsSnapshot };
