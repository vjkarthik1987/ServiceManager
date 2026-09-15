/**
 * Service Manager v23.1.4 - UAT master data bootstrap
 *
 * Seeds, idempotently:
 *   - Regions + subregions
 *   - Severities + priorities
 *   - Environments
 *   - Xelerate product + current website capability modules
 *   - Standard Bank + 2 subclients
 *   - Danske Bank + 2 subclients
 *
 * Safety:
 *   - Dry-run is the default.
 *   - Use --apply to write changes.
 *   - Existing unrelated records are preserved.
 *   - Existing Xelerate modules outside the seven selected capabilities are
 *     preserved by default. Use --strict-xelerate to mark them inactive.
 *
 * Usage:
 *   node scripts/seed-uat-master-data.mjs --dry-run
 *   node scripts/seed-uat-master-data.mjs --apply
 *   node scripts/seed-uat-master-data.mjs --workspace=suntecgroup --apply
 *   node scripts/seed-uat-master-data.mjs --workspace=suntecgroup --strict-xelerate --apply
 */

import process from 'node:process';

import { connectDatabase, disconnectDatabase } from '../services/organization-service/src/db.js';
import { Organization } from '../services/organization-service/src/models/Organization.js';
import { Client } from '../services/organization-service/src/models/Client.js';
import { Severity } from '../services/organization-service/src/models/Severity.js';
import { Priority } from '../services/organization-service/src/models/Priority.js';
import { Product } from '../services/organization-service/src/models/Product.js';
import { Module } from '../services/organization-service/src/models/Module.js';
import { Region } from '../services/organization-service/src/models/Region.js';
import { Subregion } from '../services/organization-service/src/models/Subregion.js';
import { Environment } from '../services/organization-service/src/models/Environment.js';

const DEFAULT_WORKSPACE = 'suntecgroup';

const SEVERITIES = [
  {
    code: 'S1',
    name: 'Critical',
    description: 'The system cannot be used; critical impact on production and an immediate solution is required.',
    marker: 'Critical',
    displayOrder: 10
  },
  {
    code: 'S2',
    name: 'Serious',
    description: 'The software is operational under extreme restrictions; a workaround may exist but correction is required as soon as possible.',
    marker: 'High',
    displayOrder: 20
  },
  {
    code: 'S3',
    name: 'Moderate',
    description: 'The software is operational under restrictions; the problem can be avoided or ignored but causes recurring problems.',
    marker: 'Medium',
    displayOrder: 30
  },
  {
    code: 'S4',
    name: 'Minor',
    description: 'Incorrect behaviour with no significant impact on operations.',
    marker: 'Low',
    displayOrder: 40
  }
];

const PRIORITIES = [
  { code: 'P1', name: 'Critical', description: 'Critical request priority requiring immediate attention.', marker: 'Critical', displayOrder: 10 },
  { code: 'P2', name: 'High', description: 'High request priority requiring rapid attention.', marker: 'High', displayOrder: 20 },
  { code: 'P3', name: 'Medium', description: 'Normal operational request priority.', marker: 'Medium', displayOrder: 30 },
  { code: 'P4', name: 'Low', description: 'Low request priority to be handled as capacity permits.', marker: 'Low', displayOrder: 40 }
];

// These match the v23.1.1 operational environment model.
const ENVIRONMENTS = [
  { code: 'BUILD', aliases: ['BLD'], name: 'Build', description: 'Build and early validation environment.', environmentType: 'non_production', slaApplicableByDefault: false, displayOrder: 10 },
  { code: 'SIT', aliases: [], name: 'SIT', description: 'System Integration Testing environment.', environmentType: 'non_production', slaApplicableByDefault: false, displayOrder: 20 },
  { code: 'QUALITY', aliases: ['QA'], name: 'Quality', description: 'Quality assurance environment.', environmentType: 'non_production', slaApplicableByDefault: false, displayOrder: 30 },
  { code: 'STAGE', aliases: ['STG'], name: 'Stage', description: 'Stage validation environment.', environmentType: 'non_production', slaApplicableByDefault: false, displayOrder: 40 },
  { code: 'PREPROD', aliases: ['PREPRODUCTION', 'PRE_PROD'], name: 'Preproduction', description: 'Production-like preproduction environment.', environmentType: 'production_like', slaApplicableByDefault: false, displayOrder: 50 },
  { code: 'PROD', aliases: ['PRODUCTION'], name: 'Production', description: 'Live production environment.', environmentType: 'production', slaApplicableByDefault: true, displayOrder: 60 },
  { code: 'DR', aliases: [], name: 'DR', description: 'Disaster recovery production-grade environment.', environmentType: 'dr', slaApplicableByDefault: true, displayOrder: 70 }
];

const REGIONS = [
  { code: 'AFRICA', name: 'Africa', description: 'Africa operating region.', timezone: 'Africa/Johannesburg' },
  { code: 'EUROPE', name: 'Europe', description: 'Europe operating region.', timezone: 'Europe/Copenhagen' },
  { code: 'INDIA', name: 'India', description: 'India operating region.', timezone: 'Asia/Kolkata' },
  { code: 'MEA', name: 'Middle East', description: 'Middle East operating region.', timezone: 'Asia/Dubai' },
  { code: 'APAC', name: 'APAC', description: 'Asia Pacific operating region.', timezone: 'Asia/Singapore' },
  { code: 'NA', name: 'North America', description: 'North America operating region.', timezone: 'America/New_York' }
];

const SUBREGIONS = [
  { regionCode: 'AFRICA', code: 'SAFRICA', name: 'Southern Africa', description: 'Southern Africa subregion.', timezone: 'Africa/Johannesburg' },
  { regionCode: 'EUROPE', code: 'NEUROPE', name: 'Northern Europe', description: 'Northern Europe subregion.', timezone: 'Europe/Copenhagen' },
  { regionCode: 'INDIA', code: 'INDIA', name: 'India', description: 'India subregion.', timezone: 'Asia/Kolkata' },
  { regionCode: 'MEA', code: 'GULF', name: 'Gulf', description: 'Gulf subregion.', timezone: 'Asia/Dubai' },
  { regionCode: 'APAC', code: 'SEA', name: 'Southeast Asia', description: 'Southeast Asia subregion.', timezone: 'Asia/Singapore' },
  { regionCode: 'NA', code: 'USA', name: 'United States', description: 'United States subregion.', timezone: 'America/New_York' }
];

const XELERATE_PRODUCT = {
  code: 'XELERATE',
  name: 'Xelerate',
  description: 'SunTec Xelerate product suite used as the service-management product catalogue.'
};

// Current SunTec Xelerate homepage offerings, represented with short service-desk labels.
const XELERATE_MODULES = [
  {
    code: 'PRICING',
    name: 'Pricing',
    description: 'SunTec Xelerate Relationship-Based Pricing capability.'
  },
  {
    code: 'BILLING',
    name: 'Billing',
    description: 'SunTec Xelerate enterprise billing and statements capability.'
  },
  {
    code: 'EPC',
    name: 'Product Catalogue',
    description: 'SunTec Xelerate Enterprise Product Catalog capability.'
  },
  {
    code: 'DEALMGMT',
    name: 'Deal Management',
    description: 'SunTec Xelerate Deal Management capability.'
  },
  {
    code: 'ACCOUNT',
    name: 'Account Analysis',
    description: 'SunTec Xelerate Account Analysis capability.'
  },
  {
    code: 'Q2C',
    name: 'Quote-to-Cash Management',
    description: 'SunTec Xelerate Quote-to-Cash Management capability.'
  },
  {
    code: 'TAXATION',
    name: 'Indirect Taxation & e-Invoicing',
    description: 'SunTec Xelerate Indirect Taxation and e-Invoicing capability.'
  }
];

const UAT_BUSINESS_CALENDARS = Object.freeze({
  STDBNK: {
    timezone: 'Africa/Johannesburg',
    workingDays: [1, 2, 3, 4, 5],
    dayStart: '09:00',
    dayEnd: '17:00',
    holidays: [
      { date: '2026-01-01', name: "New Year's Day" },
      { date: '2026-03-21', name: 'Human Rights Day' },
      { date: '2026-04-03', name: 'Good Friday' },
      { date: '2026-04-06', name: 'Family Day' },
      { date: '2026-04-27', name: 'Freedom Day' },
      { date: '2026-05-01', name: "Workers' Day" },
      { date: '2026-06-16', name: 'Youth Day' },
      { date: '2026-08-09', name: "National Women's Day" },
      { date: '2026-08-10', name: "National Women's Day observed" },
      { date: '2026-09-24', name: 'Heritage Day' },
      { date: '2026-12-16', name: 'Day of Reconciliation' },
      { date: '2026-12-25', name: 'Christmas Day' },
      { date: '2026-12-26', name: 'Day of Goodwill' }
    ]
  },
  DANSKE: {
    timezone: 'Europe/Copenhagen',
    workingDays: [1, 2, 3, 4, 5],
    dayStart: '09:00',
    dayEnd: '17:00',
    // UAT client calendar. Admins can amend contractual closing days in Client Configuration.
    holidays: [
      { date: '2026-01-01', name: "New Year's Day" },
      { date: '2026-04-02', name: 'Maundy Thursday' },
      { date: '2026-04-03', name: 'Good Friday' },
      { date: '2026-04-06', name: 'Easter Monday' },
      { date: '2026-05-14', name: 'Ascension Day' },
      { date: '2026-05-25', name: 'Whit Monday' },
      { date: '2026-06-05', name: 'Constitution Day' },
      { date: '2026-12-24', name: 'Christmas Eve' },
      { date: '2026-12-25', name: 'Christmas Day' },
      { date: '2026-12-31', name: "New Year's Eve" }
    ]
  }
});

const CLIENTS = [
  {
    shortCode: 'STDBNK',
    name: 'Standard Bank',
    description: 'Standard Bank UAT client.',
    regionCode: 'AFRICA',
    subregionCode: 'SAFRICA',
    timezone: 'Africa/Johannesburg',
    businessCalendar: UAT_BUSINESS_CALENDARS.STDBNK,
    children: [
      {
        shortCode: 'STBPPB',
        name: 'Personal & Private Banking',
        description: 'Standard Bank Personal & Private Banking UAT subclient.'
      },
      {
        shortCode: 'STBCIB',
        name: 'Corporate & Investment Banking',
        description: 'Standard Bank Corporate & Investment Banking UAT subclient.'
      }
    ]
  },
  {
    shortCode: 'DANSKE',
    name: 'Danske Bank',
    description: 'Danske Bank UAT client.',
    regionCode: 'EUROPE',
    subregionCode: 'NEUROPE',
    timezone: 'Europe/Copenhagen',
    businessCalendar: UAT_BUSINESS_CALENDARS.DANSKE,
    children: [
      {
        shortCode: 'DANPER',
        name: 'Personal Customers',
        description: 'Danske Bank Personal Customers UAT subclient.'
      },
      {
        shortCode: 'DANLCI',
        name: 'Large Corporates & Institutions',
        description: 'Danske Bank Large Corporates & Institutions UAT subclient.'
      }
    ]
  }
];

function parseArgs(argv) {
  const options = {
    workspace: DEFAULT_WORKSPACE,
    apply: false,
    strictXelerate: false,
    help: false
  };

  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--strict-xelerate') options.strictXelerate = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--workspace=')) options.workspace = arg.slice('--workspace='.length).trim().toLowerCase();
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`\nService Manager v23.1.4 - UAT MASTER DATA BOOTSTRAP\n\nUsage:\n  node scripts/seed-uat-master-data.mjs --dry-run\n  node scripts/seed-uat-master-data.mjs --apply\n  node scripts/seed-uat-master-data.mjs --workspace=suntecgroup --apply\n  node scripts/seed-uat-master-data.mjs --workspace=suntecgroup --strict-xelerate --apply\n\nOptions:\n  --workspace=<slug>     Existing organization workspace slug. Default: suntecgroup\n  --dry-run              Preview changes only. This is the default.\n  --apply                Write changes to MongoDB.\n  --strict-xelerate      Mark Xelerate modules outside the selected seven as inactive.\n  --help                 Show this help.\n`);
}

function same(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const left = (a || []).map(String).sort();
    const right = (b || []).map(String).sort();
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return String(a ?? '') === String(b ?? '');
}

function setIfDifferent(doc, field, value) {
  if (same(doc[field], value)) return false;
  doc[field] = value;
  return true;
}

function logAction(action, type, code, name) {
  const symbol = action === 'CREATE' ? '+' : action === 'UPDATE' ? '~' : action === 'DEACTIVATE' ? '!' : '=';
  console.log(`  ${symbol} ${action.padEnd(10)} ${type.padEnd(12)} ${String(code).padEnd(12)} ${name}`);
}

async function saveIfNeeded(doc, changed, apply) {
  if (changed && apply) await doc.save();
  return doc;
}

async function findOrganization(workspace) {
  return Organization.findOne({ workspaceSlug: String(workspace || '').toLowerCase() });
}

async function ensureSeverity(org, def, apply) {
  let doc = await Severity.findOne({ organizationId: org._id, code: def.code });
  if (!doc) {
    doc = new Severity({ organizationId: org._id, ...def, status: 'active' });
    logAction('CREATE', 'Severity', def.code, def.name);
    if (apply) await doc.save();
    return doc;
  }

  let changed = false;
  changed = setIfDifferent(doc, 'name', def.name) || changed;
  changed = setIfDifferent(doc, 'description', def.description) || changed;
  changed = setIfDifferent(doc, 'marker', def.marker) || changed;
  changed = setIfDifferent(doc, 'displayOrder', def.displayOrder) || changed;
  changed = setIfDifferent(doc, 'status', 'active') || changed;
  logAction(changed ? 'UPDATE' : 'UNCHANGED', 'Severity', def.code, def.name);
  return saveIfNeeded(doc, changed, apply);
}

async function ensurePriority(org, def, apply) {
  let doc = await Priority.findOne({ organizationId: org._id, code: def.code });
  if (!doc) {
    doc = new Priority({ organizationId: org._id, ...def, status: 'active' });
    logAction('CREATE', 'Priority', def.code, def.name);
    if (apply) await doc.save();
    return doc;
  }

  let changed = false;
  changed = setIfDifferent(doc, 'name', def.name) || changed;
  changed = setIfDifferent(doc, 'description', def.description) || changed;
  changed = setIfDifferent(doc, 'marker', def.marker) || changed;
  changed = setIfDifferent(doc, 'displayOrder', def.displayOrder) || changed;
  changed = setIfDifferent(doc, 'status', 'active') || changed;
  logAction(changed ? 'UPDATE' : 'UNCHANGED', 'Priority', def.code, def.name);
  return saveIfNeeded(doc, changed, apply);
}

async function ensureEnvironment(org, def, apply) {
  const candidateCodes = [def.code, ...(def.aliases || [])].map((item) => String(item).toUpperCase());
  let doc = await Environment.findOne({ organizationId: org._id, code: { $in: candidateCodes } });
  if (!doc) {
    doc = await Environment.findOne({ organizationId: org._id, name: def.name });
  }

  if (!doc) {
    doc = new Environment({
      organizationId: org._id,
      code: def.code,
      name: def.name,
      description: def.description,
      environmentType: def.environmentType,
      slaApplicableByDefault: def.slaApplicableByDefault,
      displayOrder: def.displayOrder,
      status: 'active'
    });
    logAction('CREATE', 'Environment', def.code, def.name);
    if (apply) await doc.save();
    return doc;
  }

  let changed = false;
  changed = setIfDifferent(doc, 'name', def.name) || changed;
  changed = setIfDifferent(doc, 'description', def.description) || changed;
  changed = setIfDifferent(doc, 'environmentType', def.environmentType) || changed;
  changed = setIfDifferent(doc, 'slaApplicableByDefault', def.slaApplicableByDefault) || changed;
  changed = setIfDifferent(doc, 'displayOrder', def.displayOrder) || changed;
  changed = setIfDifferent(doc, 'status', 'active') || changed;
  logAction(changed ? 'UPDATE' : 'UNCHANGED', 'Environment', doc.code, def.name);
  return saveIfNeeded(doc, changed, apply);
}

async function ensureRegion(org, def, apply) {
  let doc = await Region.findOne({ organizationId: org._id, code: def.code });
  if (!doc) {
    doc = new Region({ organizationId: org._id, ...def, status: 'active' });
    logAction('CREATE', 'Region', def.code, def.name);
    if (apply) await doc.save();
    return doc;
  }

  let changed = false;
  changed = setIfDifferent(doc, 'name', def.name) || changed;
  changed = setIfDifferent(doc, 'description', def.description) || changed;
  changed = setIfDifferent(doc, 'timezone', def.timezone) || changed;
  changed = setIfDifferent(doc, 'status', 'active') || changed;
  logAction(changed ? 'UPDATE' : 'UNCHANGED', 'Region', def.code, def.name);
  return saveIfNeeded(doc, changed, apply);
}

async function ensureSubregion(org, region, def, apply) {
  let doc = await Subregion.findOne({ organizationId: org._id, regionId: region._id, code: def.code });
  if (!doc) {
    doc = new Subregion({
      organizationId: org._id,
      regionId: region._id,
      code: def.code,
      name: def.name,
      description: def.description,
      timezone: def.timezone,
      status: 'active'
    });
    logAction('CREATE', 'Subregion', def.code, `${def.name} (${region.name})`);
    if (apply) await doc.save();
    return doc;
  }

  let changed = false;
  changed = setIfDifferent(doc, 'name', def.name) || changed;
  changed = setIfDifferent(doc, 'description', def.description) || changed;
  changed = setIfDifferent(doc, 'timezone', def.timezone) || changed;
  changed = setIfDifferent(doc, 'status', 'active') || changed;
  logAction(changed ? 'UPDATE' : 'UNCHANGED', 'Subregion', def.code, `${def.name} (${region.name})`);
  return saveIfNeeded(doc, changed, apply);
}

async function ensureProduct(org, def, apply) {
  let doc = await Product.findOne({ organizationId: org._id, code: def.code });
  if (!doc) {
    doc = new Product({ organizationId: org._id, ...def, status: 'active' });
    logAction('CREATE', 'Product', def.code, def.name);
    if (apply) await doc.save();
    return doc;
  }

  let changed = false;
  changed = setIfDifferent(doc, 'name', def.name) || changed;
  changed = setIfDifferent(doc, 'description', def.description) || changed;
  changed = setIfDifferent(doc, 'status', 'active') || changed;
  logAction(changed ? 'UPDATE' : 'UNCHANGED', 'Product', def.code, def.name);
  return saveIfNeeded(doc, changed, apply);
}

async function ensureModule(org, product, def, apply) {
  let doc = await Module.findOne({ organizationId: org._id, productId: product._id, code: def.code });
  if (!doc) {
    doc = new Module({ organizationId: org._id, productId: product._id, ...def, status: 'active' });
    logAction('CREATE', 'Module', def.code, def.name);
    if (apply) await doc.save();
    return doc;
  }

  let changed = false;
  changed = setIfDifferent(doc, 'name', def.name) || changed;
  changed = setIfDifferent(doc, 'description', def.description) || changed;
  changed = setIfDifferent(doc, 'status', 'active') || changed;
  logAction(changed ? 'UPDATE' : 'UNCHANGED', 'Module', def.code, def.name);
  return saveIfNeeded(doc, changed, apply);
}

async function deactivateOtherXelerateModules(org, product, wantedCodes, apply) {
  const extras = await Module.find({
    organizationId: org._id,
    productId: product._id,
    code: { $nin: [...wantedCodes] },
    status: 'active'
  });

  for (const doc of extras) {
    logAction('DEACTIVATE', 'Module', doc.code, doc.name);
    if (apply) {
      doc.status = 'inactive';
      await doc.save();
    }
  }
}

function uniqueIds(values) {
  return [...new Map((values || []).filter(Boolean).map((value) => [String(value), value])).values()];
}

async function ensureClient({
  org,
  def,
  parent = null,
  region,
  subregion,
  product,
  modules,
  environments,
  apply
}) {
  let doc = await Client.findOne({ organizationId: org._id, shortCode: def.shortCode });

  const parentPath = parent ? [...(parent.path || []), parent._id] : [];
  const environmentIds = environments.map((item) => item._id);

  if (!doc) {
    doc = new Client({
      organizationId: org._id,
      parentClientId: parent?._id || null,
      name: def.name,
      shortCode: def.shortCode,
      primaryDomain: '',
      description: def.description,
      notes: 'Provisioned by scripts/seed-uat-master-data.mjs',
      regionId: region?._id || null,
      subregionId: subregion?._id || null,
      timezone: def.timezone || subregion?.timezone || region?.timezone || '',
      businessCalendarMode: parent ? 'inherit' : 'custom',
      businessCalendar: parent ? { timezone: def.timezone || parent.timezone || 'UTC', workingDays: [1,2,3,4,5], dayStart: '09:00', dayEnd: '17:00', holidays: [] } : (def.businessCalendar || { timezone: def.timezone || 'UTC', workingDays: [1,2,3,4,5], dayStart: '09:00', dayEnd: '17:00', holidays: [] }),
      status: 'active',
      depth: parent ? Number(parent.depth || 0) + 1 : 0,
      path: parentPath,
      issueTypeMode: parent ? 'inherit' : 'custom',
      slaMode: parent ? 'inherit' : 'custom',
      productModuleMode: parent ? 'inherit' : 'custom',
      enabledProductIds: parent ? [] : [product._id],
      enabledModuleIds: parent ? [] : modules.map((item) => item._id),
      enabledEnvironmentIds: environmentIds,
      operationalRules: []
    });

    logAction('CREATE', parent ? 'Subclient' : 'Client', def.shortCode, def.name);
    if (apply) await doc.save();
    return doc;
  }

  let changed = false;
  changed = setIfDifferent(doc, 'name', def.name) || changed;
  changed = setIfDifferent(doc, 'description', def.description) || changed;
  changed = setIfDifferent(doc, 'status', 'active') || changed;
  changed = setIfDifferent(doc, 'regionId', region?._id || null) || changed;
  changed = setIfDifferent(doc, 'subregionId', subregion?._id || null) || changed;
  changed = setIfDifferent(doc, 'timezone', def.timezone || subregion?.timezone || region?.timezone || '') || changed;
  changed = setIfDifferent(doc, 'businessCalendarMode', parent ? 'inherit' : 'custom') || changed;
  if (!parent && def.businessCalendar) changed = setIfDifferent(doc, 'businessCalendar', def.businessCalendar) || changed;
  changed = setIfDifferent(doc, 'parentClientId', parent?._id || null) || changed;
  changed = setIfDifferent(doc, 'depth', parent ? Number(parent.depth || 0) + 1 : 0) || changed;
  changed = setIfDifferent(doc, 'path', parentPath) || changed;

  const mergedEnvironmentIds = uniqueIds([...(doc.enabledEnvironmentIds || []), ...environmentIds]);
  changed = setIfDifferent(doc, 'enabledEnvironmentIds', mergedEnvironmentIds) || changed;

  if (parent) {
    changed = setIfDifferent(doc, 'productModuleMode', 'inherit') || changed;
    changed = setIfDifferent(doc, 'enabledProductIds', []) || changed;
    changed = setIfDifferent(doc, 'enabledModuleIds', []) || changed;
  } else {
    changed = setIfDifferent(doc, 'productModuleMode', 'custom') || changed;
    changed = setIfDifferent(doc, 'enabledProductIds', uniqueIds([...(doc.enabledProductIds || []), product._id])) || changed;
    changed = setIfDifferent(doc, 'enabledModuleIds', uniqueIds([...(doc.enabledModuleIds || []), ...modules.map((item) => item._id)])) || changed;
  }

  logAction(changed ? 'UPDATE' : 'UNCHANGED', parent ? 'Subclient' : 'Client', def.shortCode, def.name);
  return saveIfNeeded(doc, changed, apply);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  await connectDatabase();

  try {
    const org = await findOrganization(options.workspace);
    if (!org) {
      throw new Error(`Workspace "${options.workspace}" was not found. Create the organization first, then rerun this script.`);
    }

    console.log('\nService Manager v23.1.4 - UAT MASTER DATA BOOTSTRAP');
    console.log(`Mode       : ${options.apply ? 'APPLY' : 'DRY RUN'}`);
    console.log(`Workspace  : /${org.workspaceSlug} - ${org.name}`);
    console.log(`Xelerate   : ${options.strictXelerate ? 'STRICT 7-module active catalogue' : 'Seed 7 modules; preserve other existing modules'}`);

    console.log('\n1. Severities');
    for (const def of SEVERITIES) await ensureSeverity(org, def, options.apply);

    console.log('\n2. Priorities');
    for (const def of PRIORITIES) await ensurePriority(org, def, options.apply);

    console.log('\n3. Environments');
    const environmentDocs = [];
    for (const def of ENVIRONMENTS) environmentDocs.push(await ensureEnvironment(org, def, options.apply));

    console.log('\n4. Regions');
    const regionMap = new Map();
    for (const def of REGIONS) {
      const doc = await ensureRegion(org, def, options.apply);
      regionMap.set(def.code, doc);
    }

    console.log('\n5. Subregions');
    const subregionMap = new Map();
    for (const def of SUBREGIONS) {
      const region = regionMap.get(def.regionCode);
      if (!region) throw new Error(`Region ${def.regionCode} is missing for subregion ${def.code}.`);
      const doc = await ensureSubregion(org, region, def, options.apply);
      subregionMap.set(`${def.regionCode}:${def.code}`, doc);
    }

    console.log('\n6. Xelerate product');
    const product = await ensureProduct(org, XELERATE_PRODUCT, options.apply);

    console.log('\n7. Xelerate modules');
    const moduleDocs = [];
    for (const def of XELERATE_MODULES) moduleDocs.push(await ensureModule(org, product, def, options.apply));

    if (options.strictXelerate) {
      console.log('\n7b. Legacy Xelerate modules');
      await deactivateOtherXelerateModules(org, product, new Set(XELERATE_MODULES.map((item) => item.code)), options.apply);
    }

    console.log('\n8. Client hierarchy');
    for (const rootDef of CLIENTS) {
      const region = regionMap.get(rootDef.regionCode);
      const subregion = subregionMap.get(`${rootDef.regionCode}:${rootDef.subregionCode}`);
      if (!region || !subregion) throw new Error(`Region mapping is missing for client ${rootDef.shortCode}.`);

      const root = await ensureClient({
        org,
        def: rootDef,
        region,
        subregion,
        product,
        modules: moduleDocs,
        environments: environmentDocs,
        apply: options.apply
      });

      for (const childDef of rootDef.children) {
        await ensureClient({
          org,
          def: { ...childDef, timezone: rootDef.timezone },
          parent: root,
          region,
          subregion,
          product,
          modules: moduleDocs,
          environments: environmentDocs,
          apply: options.apply
        });
      }
    }

    console.log('\nDone.');
    console.log(`  Severities : ${SEVERITIES.length}`);
    console.log(`  Priorities : ${PRIORITIES.length}`);
    console.log(`  Environments: ${ENVIRONMENTS.length}`);
    console.log(`  Regions    : ${REGIONS.length}`);
    console.log(`  Subregions : ${SUBREGIONS.length}`);
    console.log('  Products   : 1 (Xelerate)');
    console.log(`  Modules    : ${XELERATE_MODULES.length}`);
    console.log('  Clients    : 2');
    console.log('  Subclients : 4');

    if (!options.apply) {
      console.log('\nDRY RUN ONLY - no database records were changed.');
      console.log('Run again with --apply after reviewing the output.');
    } else {
      console.log('\nAPPLY COMPLETE - UAT master data is seeded.');
    }
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error) => {
  console.error(`\nSeed failed: ${error.message}`);
  process.exitCode = 1;
});
