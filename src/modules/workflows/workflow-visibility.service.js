
const DEFAULT_CLIENT_STATUS_MAP = {
  NEW: { clientVisible: true, clientBucket: 'NEW', clientLabel: 'Submitted' },
  OPEN: { clientVisible: true, clientBucket: 'NEW', clientLabel: 'Submitted' },
  UNDER_REVIEW: { clientVisible: false, clientBucket: 'NEW', clientLabel: 'Submitted' },
  APPROVED: { clientVisible: false, clientBucket: 'NEW', clientLabel: 'Submitted' },
  GIVEN_FOR_DEVELOPMENT: { clientVisible: false, clientBucket: 'IN_PROGRESS', clientLabel: 'We are working on it' },
  IN_PROGRESS: { clientVisible: true, clientBucket: 'IN_PROGRESS', clientLabel: 'We are working on it' },
  TESTING_DONE: { clientVisible: false, clientBucket: 'IN_PROGRESS', clientLabel: 'We are working on it' },
  UAT: { clientVisible: false, clientBucket: 'IN_PROGRESS', clientLabel: 'We are working on it' },
  WAITING_FOR_CLIENT: { clientVisible: true, clientBucket: 'WAITING_FOR_CLIENT', clientLabel: 'Waiting for your input' },
  ANSWERED: { clientVisible: false, clientBucket: 'IN_PROGRESS', clientLabel: 'We are working on it' },
  RESOLVED: { clientVisible: true, clientBucket: 'RESOLVED', clientLabel: 'Resolved' },
  READY_TO_CLOSE: { clientVisible: false, clientBucket: 'RESOLVED', clientLabel: 'Resolved' },
  CLOSED: { clientVisible: true, clientBucket: 'CLOSED', clientLabel: 'Closed' }
};

function normalizeBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', ''].includes(normalized)) return false;
  return defaultValue;
}

function normalizeStatusKey(value = '') {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '_');
}

function getDefaultClientStatusMeta(statusKey = '') {
  const key = normalizeStatusKey(statusKey);
  const preset = DEFAULT_CLIENT_STATUS_MAP[key];
  if (preset) return { statusKey: key, ...preset };
  return { statusKey: key, clientVisible: false, clientBucket: 'IN_PROGRESS', clientLabel: 'We are working on it' };
}

function getStatusDefinitionMap(workflow = null) {
  const map = new Map();
  const defs = Array.isArray(workflow?.statusDefinitions) ? workflow.statusDefinitions : [];
  defs.forEach((item) => {
    const key = normalizeStatusKey(item?.statusKey || item?.key || item?.status);
    if (!key) return;
    const fallback = getDefaultClientStatusMeta(key);
    map.set(key, {
      statusKey: key,
      clientVisible: normalizeBoolean(item?.clientVisible, fallback.clientVisible),
      clientBucket: normalizeStatusKey(item?.clientBucket || fallback.clientBucket),
      clientLabel: String(item?.clientLabel || fallback.clientLabel || '').trim() || fallback.clientLabel
    });
  });
  return map;
}

function getClientStatusPresentation(workflow = null, status = '') {
  const key = normalizeStatusKey(status);
  const defaultMeta = getDefaultClientStatusMeta(key);
  const fromWorkflow = getStatusDefinitionMap(workflow).get(key);
  const meta = fromWorkflow || defaultMeta;
  const bucket = normalizeStatusKey(meta.clientBucket || defaultMeta.clientBucket);
  const bucketDefault = getDefaultClientStatusMeta(bucket);
  return {
    internalStatus: key,
    clientVisible: normalizeBoolean(meta.clientVisible, defaultMeta.clientVisible),
    clientBucket: bucket,
    clientLabel: String(meta.clientLabel || bucketDefault.clientLabel || defaultMeta.clientLabel || key).trim() || key,
    badgeStatus: bucket || key
  };
}

module.exports = {
  DEFAULT_CLIENT_STATUS_MAP,
  normalizeBoolean,
  normalizeStatusKey,
  getDefaultClientStatusMeta,
  getStatusDefinitionMap,
  getClientStatusPresentation
};
