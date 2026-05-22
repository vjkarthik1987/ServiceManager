
function formatLog(level, event, details = {}) {
  return JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    service: 'esop',
    ...details
  });
}
function logInfo(event, details = {}) { console.log(formatLog('INFO', event, details)); }
function logWarn(event, details = {}) { console.warn(formatLog('WARN', event, details)); }
function logError(event, details = {}) { console.error(formatLog('ERROR', event, details)); }
module.exports = { logInfo, logWarn, logError };
