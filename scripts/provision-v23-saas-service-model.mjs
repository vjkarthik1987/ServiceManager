#!/usr/bin/env node
/**
 * Service Manager v23 — SunTec SaaS service model provisioner.
 *
 * SAFE BY DEFAULT:
 *   node scripts/provision-v23-saas-service-model.mjs --dry-run
 *
 * APPLY SAFE CONFIG ONLY:
 *   node scripts/provision-v23-saas-service-model.mjs --apply
 *
 * APPLY EXPLICIT AMBIGUOUS TYPE BINDINGS AFTER DRY-RUN REVIEW:
 *   node scripts/provision-v23-saas-service-model.mjs --apply --approve-bindings=collection:id,collection:id
 *
 * Ambiguous exact-name matches are NEVER bulk-confirmed. This is deliberate:
 * normal Incident Management must never be inferred as SaaS merely because its
 * subtype happens to share a name such as "Application Incident".
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  V23_SAAS_SERVICE_MODEL_KEY,
  V23_MARKER_FIELD_KEY,
  normalized,
  ensureMarkerCustomField
} from '../lib/v23-saas-core.mjs';
import { resolveMongoTarget, redactMongoUri, printDiscoveryError } from '../lib/v23-db-discovery.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(ROOT, 'config', 'v23-saas');
const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const DRY_RUN = !APPLY || args.has('--dry-run');
const LEGACY_CONFIRM_CATALOGUE = args.has('--confirm-current-saas-catalogue');
const APPROVED_BINDINGS = new Set(String(valueArg('--approve-bindings') || '').split(',').map((item) => item.trim()).filter(Boolean));
const MIGRATE_OPEN = args.has('--migrate-open-saas-requests');
const VERBOSE = args.has('--verbose');
const COLLECTION_OVERRIDE = valueArg('--taxonomy-collection');
const EXPLICIT_MONGO_URI = valueArg('--mongo-uri') || process.env.V23_MONGO_URI || '';
const CONFIG_COLLECTION = process.env.V23_SERVICE_MODEL_COLLECTION || 'v23_service_models';

function valueArg(name) {
  const prefix = `${name}=`;
  const value = process.argv.slice(2).find((item) => item.startsWith(prefix));
  return value ? value.slice(prefix.length) : '';
}

function loadJson(name) {
  return JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, name), 'utf8'));
}

const manifest = loadJson('service-model.json');
const fields = loadJson('field-registry.json');
const formsDoc = loadJson('form-definitions.json');
const workflowsDoc = loadJson('workflows.json');
const mappingDoc = loadJson('subtype-workflow-map.json');
const roles = loadJson('role-capabilities.json');
const approvals = loadJson('approval-policies.json');
const productVersionModel = loadJson('product-version-model.json');

if (manifest.key !== V23_SAAS_SERVICE_MODEL_KEY) throw new Error('Invalid v23 service-model manifest.');

const forms = formsDoc.forms || [];
const exactNames = new Map();
for (const form of forms) {
  for (const name of [form.subtype, ...(form.aliases || [])]) {
    const key = normalizeCatalogueName(name);
    if (key && !isGenericFamilyName(key)) exactNames.set(key, form);
  }
}

function normalizeCatalogueName(value) {
  return normalized(value)
    .replace(/\bcreate modify delete\b/g, '')
    .replace(/\bcreate modify delete select\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGenericFamilyName(value) {
  return ['incident','service request','maintenance request','problem','change request','query'].includes(normalizeCatalogueName(value));
}

function candidateStrings(doc = {}) {
  if (!doc || typeof doc !== 'object') return [];
  // Guarded matching: inspect only the taxonomy document's own identity fields
  // and explicit subtype/type reference objects. Do not recurse into workflow,
  // children, support paths or arbitrary nested configuration where a normal
  // parent document could merely mention a SaaS subtype name.
  const directKeys = ['name','code','title','label','displayName','requestTypeName','subtype','subType','typeName','issueTypeName'];
  const values = directKeys.map((key) => doc[key]).filter((value) => typeof value === 'string');
  for (const key of ['requestType','issueType','level2Type','subtypeRef','subTypeRef']) {
    const value = doc[key];
    if (typeof value === 'string') values.push(value);
    else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const identityKey of ['name','code','label','displayName','typeName']) {
        if (typeof value[identityKey] === 'string') values.push(value[identityKey]);
      }
    }
  }
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function bestFormMatch(doc = {}) {
  for (const candidate of candidateStrings(doc)) {
    const form = exactNames.get(normalizeCatalogueName(candidate));
    if (form) return { form, matchedText: candidate };
  }
  return null;
}

function hasSaasEvidence(doc = {}) {
  if (String(doc.serviceModelKey || '') === V23_SAAS_SERVICE_MODEL_KEY) return true;
  const haystack = JSON.stringify(doc).toLowerCase();
  return haystack.includes('xelerate') || haystack.includes('suntec saas') || haystack.includes('saas_') || haystack.includes('saas ');
}

function idText(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (typeof value.toHexString === 'function') return value.toHexString();
  return String(value);
}

function orgIdFromDoc(doc = {}) {
  return idText(doc.organizationId || doc.orgId || doc.tenantId || doc.organization?._id || doc.organization?.id || '');
}

function explicitBindingKey(collectionName, doc = {}) {
  return `${collectionName}:${idText(doc._id)}`;
}

function backupName() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth()+1)}${pad(d.getUTCDate())}_${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

const BACKUP_DIR = path.resolve(process.cwd(), 'backups', 'v23-pre-migration', backupName());
const stats = { created: 0, updated: 0, unchanged: 0, skipped: 0, ambiguous: 0, errors: 0 };

function print(...items) { console.log(...items); }
function debug(...items) { if (VERBOSE) console.log(...items); }

async function main() {
  let mongoose;
  try {
    const imported = await import('mongoose');
    mongoose = imported.default || imported;
  } catch (error) {
    throw new Error(`mongoose is required by the current Service Manager workspaces. Run npm install first. (${error.message})`);
  }

  print(`Service Manager v23 SaaS provisioner — ${DRY_RUN ? 'DRY RUN' : 'APPLY'}`);
  print(`Service model: ${V23_SAAS_SERVICE_MODEL_KEY}`);
  print('Guard: normal/non-SaaS Incident Management is excluded by exact marker/type binding.');
  if (LEGACY_CONFIRM_CATALOGUE && !APPROVED_BINDINGS.size) {
    throw new Error('--confirm-current-saas-catalogue is intentionally disabled in v23 final. Use --approve-bindings=collection:id after reviewing the dry-run.');
  }
  if (APPLY && !APPROVED_BINDINGS.size) {
    print('Note: ambiguous exact-name matches are skipped. Bind only reviewed SaaS rows with --approve-bindings=collection:id,...');
  }

  let target;
  try {
    target = await resolveMongoTarget({ mongoose, root: process.cwd(), explicitUri: EXPLICIT_MONGO_URI, requireNonEmpty: true });
  } catch (error) {
    printDiscoveryError(error, console.error);
    throw new Error('Database preflight failed. No v23 database writes were attempted.');
  }

  print(`Database: ${target.dbName}`);
  print(`MongoDB: ${redactMongoUri(target.uri)}`);
  print(`Existing collections: ${target.collections.length}`);
  if (DRY_RUN) print('DRY RUN ONLY — no database writes will be performed.');

  await mongoose.connect(target.uri, { serverSelectionTimeoutMS: 8000 });
  try {
    const db = mongoose.connection.db;
    const configCollection = db.collection(CONFIG_COLLECTION);

    const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name);
    const taxonomyCollections = COLLECTION_OVERRIDE
      ? [COLLECTION_OVERRIDE]
      : collections.filter((name) => isTaxonomyCandidateCollection(name));

    const matches = [];
    const ambiguous = [];

    for (const collectionName of taxonomyCollections) {
      const collection = db.collection(collectionName);
      const docs = await collection.find({}).limit(10000).toArray();
      for (const doc of docs) {
        const match = bestFormMatch(doc);
        if (!match) continue;
        if (isGenericFamilyName(match.matchedText)) continue;
        const bindingKey = explicitBindingKey(collectionName, doc);
        const safe = hasSaasEvidence(doc) || APPROVED_BINDINGS.has(bindingKey);
        const row = { collectionName, doc, ...match, safe, bindingKey };
        if (safe) matches.push(row); else ambiguous.push(row);
      }
    }

    // Never allow the generic Incident family into the binding set.
    const unsafeGeneric = matches.filter(({ matchedText }) => isGenericFamilyName(matchedText));
    if (unsafeGeneric.length) throw new Error('Guard violation: a generic request-family type was selected for v23 binding.');

    print(`Taxonomy collections inspected: ${taxonomyCollections.length}`);
    if (!taxonomyCollections.length) {
      print('No taxonomy-like collection name was detected. Existing collection names:');
      for (const name of collections.sort()) print(`  - ${name}`);
      print('If the issue/request-type catalogue is stored under a custom collection name, rerun with --taxonomy-collection=<exact_collection_name>.');
    }
    print(`SaaS subtype matches: ${matches.length}`);
    print(`Ambiguous exact-name matches skipped: ${ambiguous.length}`);
    stats.ambiguous += ambiguous.length;
    for (const row of ambiguous) {
      print(`  ? [${row.bindingKey}] ${row.matchedText} → ${row.form.key}`);
    }
    if (ambiguous.length) {
      print('  Guard note: do not approve a row merely because the subtype name looks correct. Approve only the exact SaaS taxonomy document.');
      print('  Apply selected rows with: --approve-bindings=collection:id,collection:id');
    }

    const snapshot = {
      generatedAt: new Date().toISOString(),
      serviceModelKey: V23_SAAS_SERVICE_MODEL_KEY,
      source: matches.map((row) => ({ collection: row.collectionName, document: row.doc })),
      ambiguous: ambiguous.map((row) => ({ bindingKey: row.bindingKey, collection: row.collectionName, document: row.doc, proposedFormKey: row.form.key }))
    };
    if (APPLY && matches.length) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
      fs.writeFileSync(path.join(BACKUP_DIR, 'taxonomy-before-v23.json'), JSON.stringify(snapshot, null, 2));
    }

    await upsertConfiguration(configCollection);

    for (const row of matches) await bindType(db, configCollection, row);

    if (MIGRATE_OPEN) await migrateOpenSaasRequests(db, configCollection);

    await provisionProductVersionMetadata(db);

    print('');
    if (DRY_RUN) {
      print(`Would create: ${stats.created}`);
      print(`Would update: ${stats.updated}`);
      print(`Would leave unchanged: ${stats.unchanged}`);
      print(`Would skip: ${stats.skipped}`);
    } else {
      print(`Created: ${stats.created}`);
      print(`Updated: ${stats.updated}`);
      print(`Unchanged: ${stats.unchanged}`);
      print(`Skipped: ${stats.skipped}`);
    }
    print(`Ambiguous: ${stats.ambiguous}`);
    print(`Errors: ${stats.errors}`);
    if (APPLY && matches.length) print(`Backup: ${BACKUP_DIR}`);

    if (APPLY && !matches.length) {
      print('No existing issue subtype was tagged. Configuration was still provisioned safely.');
      print('Run the dry-run, copy only the [collection:id] rows that are truly SaaS, and rerun with --approve-bindings=collection:id,...');
    }
  } finally {
    await mongoose.disconnect();
  }
}

function isTaxonomyCandidateCollection(name = '') {
  const n = name.toLowerCase();
  if (/request(s)?$|service_requests|servicerequests|tickets?$|comments|timeline|audit|history/.test(n)) return false;
  return /(taxonomy|issue.*type|request.*type|level.*type|catalog|service.*type|support.*path|workflow)/.test(n);
}

async function upsertConfiguration(collection) {
  const docs = [
    ['manifest', 'manifest', manifest],
    ['field_registry', 'fields', fields],
    ['form_definitions', 'forms', formsDoc],
    ['workflows', 'workflows', workflowsDoc],
    ['subtype_workflow_map', 'bindings', mappingDoc],
    ['role_capabilities', 'roles', roles],
    ['approval_policies', 'approvals', approvals],
    ['product_version_model', 'product_versions', productVersionModel]
  ];
  for (const [kind, key, payload] of docs) {
    const filter = { serviceModelKey: V23_SAAS_SERVICE_MODEL_KEY, kind, key };
    const current = await collection.findOne(filter);
    const next = { ...filter, version: '23.0.0', payload, updatedAt: new Date() };
    if (!APPLY) {
      stats[current ? 'updated' : 'created']++;
      debug(`  ${current ? '~' : '+'} config ${kind}`);
      continue;
    }
    const result = await collection.updateOne(filter, { $set: next, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
    if (result.upsertedCount) stats.created++; else if (result.modifiedCount) stats.updated++; else stats.unchanged++;
  }
}

async function bindType(db, configCollection, row) {
  const { collectionName, doc, form, matchedText } = row;
  const sourceId = idText(doc._id);
  const organizationId = orgIdFromDoc(doc);
  const bindingFilter = {
    serviceModelKey: V23_SAAS_SERVICE_MODEL_KEY,
    kind: 'type_binding',
    sourceCollection: collectionName,
    sourceId
  };
  const binding = {
    ...bindingFilter,
    version: '23.0.0',
    organizationId,
    typeIds: [sourceId],
    matchedName: matchedText,
    family: form.family,
    subtype: form.subtype,
    formKey: form.key,
    workflowKey: form.workflowKey,
    approvalPolicyKey: form.approvalPolicyKey || '',
    allowRaisedOnBehalfOf: Boolean(form.allowRaisedOnBehalfOf),
    clientPrioritySelectable: false,
    updatedAt: new Date()
  };

  if (!APPLY) {
    stats.updated++;
    print(`  ~ ${collectionName}/${sourceId} · ${matchedText} → ${form.workflowKey}`);
    return;
  }

  const typeCollection = db.collection(collectionName);
  const update = {
    $set: {
      serviceModelKey: V23_SAAS_SERVICE_MODEL_KEY,
      v23FormKey: form.key,
      v23WorkflowKey: form.workflowKey,
      v23ApprovalPolicyKey: form.approvalPolicyKey || '',
      v23ConfigVersion: '23.0.0'
    }
  };
  const result = await typeCollection.updateOne({ _id: doc._id }, update);
  if (result.modifiedCount) stats.updated++; else stats.unchanged++;
  const bindingResult = await configCollection.updateOne(bindingFilter, { $set: binding, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  if (bindingResult.upsertedCount) stats.created++; else if (bindingResult.modifiedCount) stats.updated++; else stats.unchanged++;
  print(`  ✓ ${collectionName}/${sourceId} · ${matchedText} → ${form.workflowKey}`);
}

async function migrateOpenSaasRequests(db, configCollection) {
  const bindings = await configCollection.find({ serviceModelKey: V23_SAAS_SERVICE_MODEL_KEY, kind: 'type_binding' }).toArray();
  const ids = new Set(bindings.flatMap((binding) => binding.typeIds || []).map(String));
  if (!ids.size) return;

  const collections = (await db.listCollections({}, { nameOnly: true }).toArray()).map((item) => item.name);
  const requestCollections = collections.filter((name) => /(^|_)(service_?)?requests?$|servicerequests/i.test(name));
  for (const name of requestCollections) {
    const collection = db.collection(name);
    const docs = await collection.find({ lifecycleState: { $nin: ['closed','cancelled'] } }).limit(20000).toArray();
    for (const doc of docs) {
      const refs = [doc.level1Type?.id, doc.level1Type?._id, doc.level2Type?.id, doc.level2Type?._id].map(idText).filter(Boolean);
      if (!refs.some((id) => ids.has(id))) continue;
      const before = doc;
      const customFields = ensureMarkerCustomField(doc.customFields || []);
      if (!APPLY) {
        stats.updated++;
        debug(`  ~ migrate request ${name}/${idText(doc._id)}`);
        continue;
      }
      if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
      const migrationLog = path.join(BACKUP_DIR, 'open-requests-before-v23.ndjson');
      fs.appendFileSync(migrationLog, `${JSON.stringify({ collection: name, document: before })}\n`);
      const result = await collection.updateOne({ _id: doc._id }, { $set: { customFields, v23ConfigVersion: '23.0.0' } });
      if (result.modifiedCount) stats.updated++; else stats.unchanged++;
    }
  }
}

async function provisionProductVersionMetadata(db) {
  const collection = db.collection('v23_product_versions');
  const filter = { serviceModelKey: V23_SAAS_SERVICE_MODEL_KEY, kind: 'schema' };
  if (!APPLY) { stats.updated++; return; }
  const result = await collection.updateOne(filter, { $set: { ...filter, version: '23.0.0', model: productVersionModel, updatedAt: new Date() }, $setOnInsert: { createdAt: new Date() } }, { upsert: true });
  if (result.upsertedCount) stats.created++; else if (result.modifiedCount) stats.updated++; else stats.unchanged++;
}

main().catch((error) => {
  stats.errors++;
  console.error(`v23 provisioner failed: ${error.stack || error.message}`);
  process.exitCode = 1;
});
