import fs from 'node:fs';
import path from 'node:path';

const ENV_KEYS = ['V23_MONGO_URI', 'MONGO_URI', 'MONGODB_URI', 'MONGODB_URL', 'DB_URI', 'DATABASE_URL'];
const SKIP_DIRS = new Set(['node_modules', '.git', '.v22-backup-before-v23', 'backups', '_v23_upgrade', 'Service_Manager_v23_SaaS_Upgrade', 'Service_Manager_v23_Clean_Upgrade']);

export function redactMongoUri(uri = '') {
  const raw = String(uri || '');
  try {
    const u = new URL(raw);
    if (u.password) u.password = '***';
    if (u.username) u.username = '***';
    return u.toString();
  } catch {
    return raw.replace(/(mongodb(?:\+srv)?:\/\/)([^@/]+)@/i, '$1***@');
  }
}

function parseEnvFile(file) {
  const out = [];
  const text = fs.readFileSync(file, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const m = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    if (!ENV_KEYS.includes(key)) continue;
    let value = m[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (value) out.push({ uri: value, source: `${file}:${key}` });
  }
  return out;
}

function walkEnvFiles(root, maxDepth = 3) {
  const files = [];
  const visit = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        visit(path.join(dir, entry.name), depth + 1);
      } else if (/^\.env(?:\..+)?$/i.test(entry.name)) {
        files.push(path.join(dir, entry.name));
      }
    }
  };
  visit(root, 0);
  return files;
}

export function configuredMongoCandidates(root = process.cwd(), explicitUri = '') {
  const candidates = [];
  if (explicitUri) candidates.push({ uri: explicitUri, source: '--mongo-uri / V23_MONGO_URI override' });
  for (const key of ENV_KEYS) {
    if (process.env[key]) candidates.push({ uri: process.env[key], source: `process.env.${key}` });
  }
  for (const file of walkEnvFiles(root)) {
    try { candidates.push(...parseEnvFile(file)); } catch { /* ignore unreadable env files */ }
  }
  const seen = new Set();
  return candidates.filter((c) => {
    const key = String(c.uri || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function inspectMongoUri(mongoose, uri) {
  const conn = mongoose.createConnection(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await conn.asPromise();
    const db = conn.db;
    const collections = await db.listCollections({}, { nameOnly: true }).toArray();
    let databases = [];
    try {
      const admin = db.admin();
      const result = await admin.listDatabases();
      databases = await Promise.all((result.databases || []).filter((d) => !['admin','config','local'].includes(d.name)).map(async (d) => {
        try {
          const cols = await conn.getClient().db(d.name).listCollections({}, { nameOnly: true }).toArray();
          return { name: d.name, collectionCount: cols.length, sizeOnDisk: d.sizeOnDisk || 0 };
        } catch {
          return { name: d.name, collectionCount: null, sizeOnDisk: d.sizeOnDisk || 0 };
        }
      }));
    } catch { /* permissions may block listDatabases */ }
    return { ok: true, uri, dbName: db.databaseName, collections: collections.map((x) => x.name), databases };
  } catch (error) {
    return { ok: false, uri, error: error.message, dbName: '', collections: [], databases: [] };
  } finally {
    try { await conn.close(); } catch { /* ignore */ }
  }
}

export async function resolveMongoTarget({ mongoose, root = process.cwd(), explicitUri = '', requireNonEmpty = true } = {}) {
  const candidates = configuredMongoCandidates(root, explicitUri);
  if (!candidates.length) {
    const fallback = 'mongodb://127.0.0.1:27017/admin';
    const probe = await inspectMongoUri(mongoose, fallback);
    const err = new Error('No MongoDB URI was found in V23_MONGO_URI/MONGO_URI/MONGODB_URI or project .env files.');
    err.code = 'V23_MONGO_URI_NOT_FOUND';
    err.probe = probe;
    throw err;
  }

  const inspected = [];
  for (const candidate of candidates) {
    const info = await inspectMongoUri(mongoose, candidate.uri);
    inspected.push({ ...candidate, ...info });
  }

  const working = inspected.filter((x) => x.ok);
  if (!working.length) {
    const err = new Error('None of the configured MongoDB URIs could be connected to.');
    err.code = 'V23_MONGO_CONNECT_FAILED';
    err.candidates = inspected;
    throw err;
  }

  const nonEmpty = working.filter((x) => x.collections.length > 0);
  if (requireNonEmpty) {
    if (nonEmpty.length === 1) return nonEmpty[0];
    if (nonEmpty.length > 1) {
      const err = new Error('More than one configured MongoDB database contains collections. Select the exact application database with --mongo-uri=<uri> or V23_MONGO_URI.');
      err.code = 'V23_MONGO_AMBIGUOUS';
      err.candidates = nonEmpty;
      throw err;
    }
    const err = new Error(`Configured MongoDB connection(s) succeeded, but the selected database is empty. v23 will not provision an empty database by guess.`);
    err.code = 'V23_MONGO_EMPTY';
    err.candidates = working;
    throw err;
  }

  if (working.length === 1) return working[0];
  const err = new Error('More than one MongoDB URI is configured. Select one explicitly.');
  err.code = 'V23_MONGO_AMBIGUOUS';
  err.candidates = working;
  throw err;
}

export function printDiscoveryError(error, print = console.log) {
  print(`Database preflight: ${error.message}`);
  for (const c of error.candidates || []) {
    print(`  ${c.ok ? '✓' : '✗'} ${redactMongoUri(c.uri)} · source=${c.source || 'unknown'} · db=${c.dbName || '?'} · collections=${c.collections?.length ?? '?'}${c.error ? ` · ${c.error}` : ''}`);
    for (const d of (c.databases || []).filter((d) => d.collectionCount > 0)) {
      print(`      candidate database: ${d.name} (${d.collectionCount} collections)`);
    }
  }
  const probe = error.probe;
  if (probe?.ok) {
    print(`  Local MongoDB is reachable. Databases with collections:`);
    for (const d of (probe.databases || []).filter((d) => d.collectionCount > 0)) print(`      ${d.name} (${d.collectionCount} collections)`);
  }
  print('Set V23_MONGO_URI to the exact application database or pass --mongo-uri=mongodb://host:port/database.');
}
