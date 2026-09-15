/**
 * Service Manager v23.1.4 - UAT users + SunTec SLA policy seed
 *
 * Prerequisite:
 *   Run seed-uat-master-data.mjs first so that these records exist:
 *     - Standard Bank [STDBNK]
 *     - Danske Bank [DANSKE]
 *     - Severities S1-S4
 *     - Environments PROD and DR
 *
 * Seeds idempotently:
 *   1) UAT users, separated across Standard Bank / Danske Bank
 *   2) Silver, Gold and Platinum SLA policies from the
 *      "SunTec Annexure Support Model - Feb 2021" SLA table
 *
 * Password policy for this UAT seed:
 *   Every seeded user is set to password: password
 *   mustChangePassword is set to false.
 *
 * Safety:
 *   - Dry-run is the default.
 *   - Use --apply to write changes.
 *   - Assignments to clients other than STDBNK and DANSKE are preserved.
 *   - Within STDBNK/DANSKE, the script enforces the mappings below.
 *   - SLA policies are created/updated but are NOT assigned to either bank.
 *
 * Usage:
 *   node scripts/seed-uat-users-slas.mjs --dry-run
 *   node scripts/seed-uat-users-slas.mjs --workspace=suntecgroup --dry-run
 *   node scripts/seed-uat-users-slas.mjs --workspace=suntecgroup --apply
 */

import process from 'node:process';

import { connectDatabase, disconnectDatabase } from '../services/organization-service/src/db.js';
import { Organization } from '../services/organization-service/src/models/Organization.js';
import { Client } from '../services/organization-service/src/models/Client.js';
import { Severity } from '../services/organization-service/src/models/Severity.js';
import { Environment } from '../services/organization-service/src/models/Environment.js';
import { SlaPolicy } from '../services/organization-service/src/models/SlaPolicy.js';
import { ServiceUser } from '../services/identity-service/src/models/ServiceUser.js';
import { hashPassword } from '../services/identity-service/src/password.js';

const DEFAULT_WORKSPACE = 'suntecgroup';
const UAT_PASSWORD = 'password';

const UAT_CLIENT_CODES = Object.freeze({
  standard: 'STDBNK',
  danske: 'DANSKE'
});

/**
 * We assign users at the root client and use includeChildren=true so they also
 * receive the intended scope over the two subclients created by the master seed.
 *
 * Tina's earlier UAT catalogue contained the typo @suntecgrou.com. For a clean
 * UAT login this seed uses @suntecgroup.com. If the typo record already exists,
 * the script treats it as a legacy email and migrates it to the corrected email.
 */
const UAT_USERS = Object.freeze([
  {
    name: 'Karthik V J',
    email: 'karthikvj@suntecsbs.com',
    role: 'clientUser',
    supportLevels: ['L1'],
    clientCodes: [UAT_CLIENT_CODES.standard]
  },
  {
    name: 'Deepesh C',
    email: 'deepeshc@suntecgroup.com',
    role: 'agentManager',
    supportLevels: ['L1', 'L2', 'L3'],
    clientCodes: [UAT_CLIENT_CODES.standard]
  },
  {
    name: 'Nisha Rathinamani',
    email: 'nishar@suntecgroup.com',
    role: 'agentUser',
    supportLevels: ['L3'],
    clientCodes: [UAT_CLIENT_CODES.standard]
  },
  {
    name: 'Anitha K P',
    email: 'anithakp@suntecgroup.com',
    role: 'agentUser',
    supportLevels: ['L3'],
    clientCodes: [UAT_CLIENT_CODES.standard]
  },
  {
    name: 'Subramoni A',
    email: 'subramonia@suntecgroup.com',
    role: 'agentUser',
    supportLevels: ['L3'],
    clientCodes: [UAT_CLIENT_CODES.standard]
  },
  {
    name: 'Tina K',
    email: 'tinak@suntecgroup.com',
    legacyEmails: ['tinak@suntecgrou.com'],
    role: 'clientUser',
    supportLevels: ['L1'],
    clientCodes: [UAT_CLIENT_CODES.danske]
  },
  {
    name: 'Jisha S',
    email: 'jisha@suntecgroup.com',
    role: 'agentManager',
    supportLevels: ['L1', 'L2', 'L3'],
    clientCodes: [UAT_CLIENT_CODES.danske]
  },
  {
    name: 'Rajani Ramakrishnan',
    email: 'rajanir@suntecsbs.com',
    role: 'partnerUser',
    supportLevels: ['L2'],
    clientCodes: [UAT_CLIENT_CODES.danske]
  },
  {
    name: 'Rajani Ramakrishnan',
    email: 'rajanir@suntecgroup.com',
    role: 'agentUser',
    supportLevels: ['L3'],
    clientCodes: [UAT_CLIENT_CODES.danske]
  },
  {
    name: 'Sudheer Padiyar',
    email: 'padiyars@suntecgroup.com',
    role: 'engagementManager',
    supportLevels: ['L1', 'L2', 'L3'],
    clientCodes: [UAT_CLIENT_CODES.standard, UAT_CLIENT_CODES.danske]
  },
  {
    name: 'Madhu M',
    email: 'madhu@suntecgroup.com',
    role: 'engagementManager',
    supportLevels: ['L1', 'L2', 'L3'],
    clientCodes: [UAT_CLIENT_CODES.standard, UAT_CLIENT_CODES.danske]
  }
]);

/**
 * SLA source: SunTec Annexure Support Model - Feb 2021, section 3.3,
 * page 8: Silver / Gold / Platinum indicative SLA tables.
 *
 * Applicability follows the support model represented in the application:
 *   - L2 and L3 support stages
 *   - PROD and DR
 *   - SLA starts after severity is selected
 *
 * No bank is assigned a default SLA in this script.
 */
const SLA_DEFINITIONS = Object.freeze([
  {
    key: 'SLA_SUNTEC_SILVER',
    name: 'Silver – Standard SLA',
    description: 'SunTec Silver standard support SLA for L2/L3 production and DR incidents.',
    supportWindow: 'business_hours',
    clockStartTrigger: 'severity_selected',
    applicableIssueLevelCodes: ['L2', 'L3'],
    applicableEnvironmentCodes: ['PROD', 'DR'],
    rules: [
      {
        severityCode: 'S1',
        responseTimeValue: 2,
        responseTimeUnit: 'business_hours',
        resolutionTimeValue: 48,
        resolutionTimeUnit: 'hours',
        updateFrequencyValue: 1,
        updateFrequencyUnit: 'daily',
        clockType: 'working_hours',
        notes: 'Daily status update.'
      },
      {
        severityCode: 'S2',
        responseTimeValue: 4,
        responseTimeUnit: 'business_hours',
        resolutionTimeValue: 96,
        resolutionTimeUnit: 'hours',
        updateFrequencyValue: 1,
        updateFrequencyUnit: 'daily',
        clockType: 'working_hours',
        notes: 'Daily status update.'
      },
      {
        severityCode: 'S3',
        responseTimeValue: 3,
        responseTimeUnit: 'business_days',
        resolutionTimeValue: 12,
        resolutionTimeUnit: 'business_days',
        updateFrequencyValue: null,
        updateFrequencyUnit: 'periodic',
        clockType: 'working_hours',
        notes: 'Through periodic project update.'
      },
      {
        severityCode: 'S4',
        responseTimeValue: 10,
        responseTimeUnit: 'business_days',
        resolutionTimeValue: null,
        resolutionTimeUnit: 'none',
        updateFrequencyValue: null,
        updateFrequencyUnit: 'periodic',
        clockType: 'working_hours',
        notes: 'No committed incident-resolution target; periodic project update.'
      }
    ]
  },
  {
    key: 'SLA_SUNTEC_GOLD',
    name: 'Gold – Expedited SLA',
    description: 'SunTec Gold expedited support SLA for L2/L3 production and DR incidents; S1 receives 24x7 support.',
    supportWindow: 'mixed',
    clockStartTrigger: 'severity_selected',
    applicableIssueLevelCodes: ['L2', 'L3'],
    applicableEnvironmentCodes: ['PROD', 'DR'],
    rules: [
      {
        severityCode: 'S1',
        responseTimeValue: 1,
        responseTimeUnit: 'hours',
        resolutionTimeValue: 24,
        resolutionTimeUnit: 'hours',
        updateFrequencyValue: 4,
        updateFrequencyUnit: 'hours',
        clockType: 'calendar',
        notes: 'Status update every 4 hours, if required.'
      },
      {
        severityCode: 'S2',
        responseTimeValue: 2,
        responseTimeUnit: 'business_hours',
        resolutionTimeValue: 72,
        resolutionTimeUnit: 'hours',
        updateFrequencyValue: 1,
        updateFrequencyUnit: 'daily',
        clockType: 'working_hours',
        notes: 'Daily status update.'
      },
      {
        severityCode: 'S3',
        responseTimeValue: 2,
        responseTimeUnit: 'business_days',
        resolutionTimeValue: 10,
        resolutionTimeUnit: 'business_days',
        updateFrequencyValue: null,
        updateFrequencyUnit: 'periodic',
        clockType: 'working_hours',
        notes: 'Through periodic project update.'
      },
      {
        severityCode: 'S4',
        responseTimeValue: 8,
        responseTimeUnit: 'business_days',
        resolutionTimeValue: null,
        resolutionTimeUnit: 'none',
        updateFrequencyValue: null,
        updateFrequencyUnit: 'periodic',
        clockType: 'working_hours',
        notes: 'No committed incident-resolution target; periodic project update.'
      }
    ]
  },
  {
    key: 'SLA_SUNTEC_PLATINUM',
    name: 'Platinum – Expedited SLA',
    description: 'SunTec Platinum expedited support SLA for L2/L3 production and DR incidents; S1 and S2 receive 24x7 support.',
    supportWindow: 'mixed',
    clockStartTrigger: 'severity_selected',
    applicableIssueLevelCodes: ['L2', 'L3'],
    applicableEnvironmentCodes: ['PROD', 'DR'],
    rules: [
      {
        severityCode: 'S1',
        responseTimeValue: 0.5,
        responseTimeUnit: 'hours',
        resolutionTimeValue: 12,
        resolutionTimeUnit: 'hours',
        updateFrequencyValue: 2,
        updateFrequencyUnit: 'hours',
        clockType: 'calendar',
        notes: 'Status update every 2 hours, if required.'
      },
      {
        severityCode: 'S2',
        responseTimeValue: 1,
        responseTimeUnit: 'hours',
        resolutionTimeValue: 48,
        resolutionTimeUnit: 'hours',
        updateFrequencyValue: 2,
        updateFrequencyUnit: 'twice_daily',
        clockType: 'calendar',
        notes: 'Status update twice a day.'
      },
      {
        severityCode: 'S3',
        responseTimeValue: 1,
        responseTimeUnit: 'business_days',
        resolutionTimeValue: 8,
        resolutionTimeUnit: 'business_days',
        updateFrequencyValue: null,
        updateFrequencyUnit: 'periodic',
        clockType: 'working_hours',
        notes: 'Through periodic project update.'
      },
      {
        severityCode: 'S4',
        responseTimeValue: 6,
        responseTimeUnit: 'business_days',
        resolutionTimeValue: null,
        resolutionTimeUnit: 'none',
        updateFrequencyValue: null,
        updateFrequencyUnit: 'periodic',
        clockType: 'working_hours',
        notes: 'No committed incident-resolution target; periodic project update.'
      }
    ]
  }
]);

function parseArgs(argv) {
  const options = {
    workspace: DEFAULT_WORKSPACE,
    apply: false,
    help: false
  };

  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--workspace=')) options.workspace = arg.slice('--workspace='.length).trim().toLowerCase();
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp() {
  console.log(`\nService Manager v23.1.4 - UAT USERS + SLA SEED\n\nUsage:\n  node scripts/seed-uat-users-slas.mjs --dry-run\n  node scripts/seed-uat-users-slas.mjs --workspace=suntecgroup --dry-run\n  node scripts/seed-uat-users-slas.mjs --workspace=suntecgroup --apply\n\nOptions:\n  --workspace=<slug>  Existing organization workspace slug. Default: suntecgroup\n  --dry-run           Preview only. This is the default.\n  --apply             Create/update users and SLA policies.\n  --help              Show this help.\n\nNotes:\n  - The UAT password for every seeded user is: password\n  - mustChangePassword is set to false.\n  - SLA policies are seeded but not assigned to Standard Bank or Danske Bank.\n`);
}

function id(value) {
  return String(value?._id || value || '');
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function normalizeAssignment(item) {
  return {
    clientId: id(item.clientId),
    role: String(item.role || ''),
    includeChildren: Boolean(item.includeChildren),
    supportLevels: [...(item.supportLevels || [])].map(String).sort()
  };
}

function assignmentsEquivalent(a, b) {
  const left = (a || []).map(normalizeAssignment).sort((x, y) => `${x.clientId}:${x.role}`.localeCompare(`${y.clientId}:${y.role}`));
  const right = (b || []).map(normalizeAssignment).sort((x, y) => `${x.clientId}:${x.role}`.localeCompare(`${y.clientId}:${y.role}`));
  return sameValue(left, right);
}

function validateUserCatalogue() {
  const allowedRoles = new Set(['clientUser', 'partnerUser', 'agentUser', 'agentManager', 'engagementManager']);
  const allowedLevels = new Set(['L1', 'L2', 'L3']);
  const emails = new Set();
  const errors = [];

  for (const user of UAT_USERS) {
    const email = String(user.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) errors.push(`Invalid email for ${user.name}`);
    if (emails.has(email)) errors.push(`Duplicate user email: ${email}`);
    emails.add(email);
    if (!allowedRoles.has(user.role)) errors.push(`Invalid role for ${email}: ${user.role}`);
    if (!Array.isArray(user.supportLevels) || !user.supportLevels.length || user.supportLevels.some((x) => !allowedLevels.has(x))) {
      errors.push(`Invalid support levels for ${email}`);
    }
    if (!Array.isArray(user.clientCodes) || !user.clientCodes.length) errors.push(`No client mapping for ${email}`);
  }

  return errors;
}

async function requireOrganization(workspace) {
  const organization = await Organization.findOne({ workspaceSlug: String(workspace || '').toLowerCase() });
  if (!organization) throw new Error(`Workspace "${workspace}" was not found. Run the master-data seed against the correct workspace first.`);
  return organization;
}

async function loadRequiredClients(organizationId) {
  const requiredCodes = Object.values(UAT_CLIENT_CODES);
  const docs = await Client.find({ organizationId, shortCode: { $in: requiredCodes } });
  const map = new Map(docs.map((doc) => [String(doc.shortCode).toUpperCase(), doc]));
  const missing = requiredCodes.filter((code) => !map.has(code));
  if (missing.length) throw new Error(`Required UAT client(s) missing: ${missing.join(', ')}. Run seed-uat-master-data.mjs first.`);
  return map;
}

async function loadRequiredSeverities(organizationId) {
  const codes = ['S1', 'S2', 'S3', 'S4'];
  const docs = await Severity.find({ organizationId, code: { $in: codes } });
  const map = new Map(docs.map((doc) => [String(doc.code).toUpperCase(), doc]));
  const missing = codes.filter((code) => !map.has(code));
  if (missing.length) throw new Error(`Required severity record(s) missing: ${missing.join(', ')}. Run seed-uat-master-data.mjs first.`);
  return map;
}

async function loadRequiredEnvironments(organizationId) {
  const codes = ['PROD', 'DR'];
  const docs = await Environment.find({ organizationId, code: { $in: codes } });
  const map = new Map(docs.map((doc) => [String(doc.code).toUpperCase(), doc]));
  const missing = codes.filter((code) => !map.has(code));
  if (missing.length) throw new Error(`Required environment record(s) missing: ${missing.join(', ')}. Run seed-uat-master-data.mjs first.`);
  return map;
}

function desiredAssignmentsForUser(user, clientMap) {
  return user.clientCodes.map((code) => {
    const client = clientMap.get(code);
    return {
      clientId: client._id,
      role: user.role,
      includeChildren: true,
      supportLevels: [...user.supportLevels]
    };
  });
}

async function findUserByDefinition(organizationId, definition) {
  const desiredEmail = definition.email.toLowerCase();
  let user = await ServiceUser.findOne({ organizationId, email: desiredEmail });
  if (user) return { user, matchedEmail: desiredEmail, legacyMatch: false };

  for (const legacyEmail of definition.legacyEmails || []) {
    const normalized = String(legacyEmail || '').trim().toLowerCase();
    if (!normalized) continue;
    user = await ServiceUser.findOne({ organizationId, email: normalized });
    if (user) return { user, matchedEmail: normalized, legacyMatch: true };
  }

  return { user: null, matchedEmail: '', legacyMatch: false };
}

async function seedUsers(organization, clientMap, apply) {
  const managedClientIds = new Set([...clientMap.values()].map((client) => id(client)));
  const results = [];

  console.log('\nUSERS');

  for (const definition of UAT_USERS) {
    const email = definition.email.toLowerCase();
    const found = await findUserByDefinition(organization._id, definition);
    const desiredAssignments = desiredAssignmentsForUser(definition, clientMap);

    if (!found.user) {
      console.log(`  + CREATE  ${definition.name.padEnd(22)} ${email}`);
      console.log(`            ${definition.clientCodes.join(' + ')} · ${definition.role} · ${definition.supportLevels.join('/')}`);
      results.push('create');

      if (apply) {
        await ServiceUser.create({
          organizationId: organization._id,
          name: definition.name,
          email,
          assignments: desiredAssignments,
          passwordHash: hashPassword(UAT_PASSWORD),
          mustChangePassword: false,
          status: 'active'
        });
      }
      continue;
    }

    const existing = found.user;
    const preservedAssignments = (existing.assignments || [])
      .filter((assignment) => !managedClientIds.has(id(assignment.clientId)))
      .map((assignment) => assignment.toObject ? assignment.toObject() : assignment);
    const nextAssignments = [...preservedAssignments, ...desiredAssignments];

    const identityChanged = existing.name !== definition.name
      || existing.email !== email
      || existing.status !== 'active'
      || existing.mustChangePassword !== false
      || !assignmentsEquivalent(existing.assignments || [], nextAssignments)
      || found.legacyMatch;

    // Password is deliberately reset on every --apply run so the known UAT
    // credential remains deterministic even if someone changed it previously.
    const action = identityChanged ? 'UPDATE' : 'RESET';
    console.log(`  ~ ${action.padEnd(6)} ${definition.name.padEnd(22)} ${email}`);
    console.log(`            ${definition.clientCodes.join(' + ')} · ${definition.role} · ${definition.supportLevels.join('/')}${found.legacyMatch ? ` · migrate ${found.matchedEmail}` : ''}`);
    results.push('update');

    if (apply) {
      existing.name = definition.name;
      existing.email = email;
      existing.assignments = nextAssignments;
      existing.passwordHash = hashPassword(UAT_PASSWORD);
      existing.mustChangePassword = false;
      existing.status = 'active';
      await existing.save();
    }
  }

  return results;
}

function buildSlaRules(definition, severityMap) {
  return definition.rules.map((rule) => ({
    ruleBasis: 'severity',
    severityId: severityMap.get(rule.severityCode)._id,
    priorityId: null,
    responseTimeValue: rule.responseTimeValue,
    responseTimeUnit: rule.responseTimeUnit,
    resolutionTimeValue: rule.resolutionTimeValue,
    resolutionTimeUnit: rule.resolutionTimeUnit,
    updateFrequencyValue: rule.updateFrequencyValue,
    updateFrequencyUnit: rule.updateFrequencyUnit,
    clockType: rule.clockType,
    notes: rule.notes
  }));
}

function normalizeRule(rule) {
  return {
    ruleBasis: String(rule.ruleBasis || ''),
    severityId: id(rule.severityId),
    priorityId: rule.priorityId ? id(rule.priorityId) : '',
    responseTimeValue: rule.responseTimeValue ?? null,
    responseTimeUnit: String(rule.responseTimeUnit || ''),
    resolutionTimeValue: rule.resolutionTimeValue ?? null,
    resolutionTimeUnit: String(rule.resolutionTimeUnit || ''),
    updateFrequencyValue: rule.updateFrequencyValue ?? null,
    updateFrequencyUnit: String(rule.updateFrequencyUnit || ''),
    clockType: String(rule.clockType || ''),
    notes: String(rule.notes || '')
  };
}

function policyEquivalent(existing, desired) {
  const existingApplicability = {
    applyOnlyWhenSeveritySelected: Boolean(existing.applicability?.applyOnlyWhenSeveritySelected),
    applicableEnvironmentIds: [...(existing.applicability?.applicableEnvironmentIds || [])].map(id).sort(),
    applicableIssueLevelCodes: [...(existing.applicability?.applicableIssueLevelCodes || [])].map(String).sort()
  };

  const desiredApplicability = {
    applyOnlyWhenSeveritySelected: Boolean(desired.applicability.applyOnlyWhenSeveritySelected),
    applicableEnvironmentIds: [...desired.applicability.applicableEnvironmentIds].map(id).sort(),
    applicableIssueLevelCodes: [...desired.applicability.applicableIssueLevelCodes].map(String).sort()
  };

  return existing.name === desired.name
    && existing.key === desired.key
    && existing.description === desired.description
    && existing.supportWindow === desired.supportWindow
    && existing.clockStartTrigger === desired.clockStartTrigger
    && existing.status === 'active'
    && sameValue((existing.rules || []).map(normalizeRule), desired.rules.map(normalizeRule))
    && sameValue(existingApplicability, desiredApplicability);
}

async function seedSlaPolicies(organization, severityMap, environmentMap, apply) {
  const results = [];

  console.log('\nSLA POLICIES');

  for (const definition of SLA_DEFINITIONS) {
    const rules = buildSlaRules(definition, severityMap);
    const applicability = {
      applyOnlyWhenSeveritySelected: true,
      applicableEnvironmentIds: definition.applicableEnvironmentCodes.map((code) => environmentMap.get(code)._id),
      applicableIssueLevelCodes: [...definition.applicableIssueLevelCodes]
    };

    const desired = {
      organizationId: organization._id,
      name: definition.name,
      key: definition.key,
      description: definition.description,
      supportWindow: definition.supportWindow,
      clockStartTrigger: definition.clockStartTrigger,
      rules,
      applicability,
      status: 'active'
    };

    let existing = await SlaPolicy.findOne({ organizationId: organization._id, key: definition.key });
    if (!existing) existing = await SlaPolicy.findOne({ organizationId: organization._id, name: definition.name });

    if (!existing) {
      console.log(`  + CREATE    ${definition.key.padEnd(24)} ${definition.name}`);
      results.push('create');
      if (apply) await SlaPolicy.create(desired);
      continue;
    }

    if (policyEquivalent(existing, desired)) {
      console.log(`  = UNCHANGED ${definition.key.padEnd(24)} ${definition.name}`);
      results.push('unchanged');
      continue;
    }

    console.log(`  ~ UPDATE    ${definition.key.padEnd(24)} ${definition.name}`);
    results.push('update');
    if (apply) {
      existing.name = desired.name;
      existing.key = desired.key;
      existing.description = desired.description;
      existing.supportWindow = desired.supportWindow;
      existing.clockStartTrigger = desired.clockStartTrigger;
      existing.rules = desired.rules;
      existing.applicability = desired.applicability;
      existing.status = 'active';
      await existing.save();
    }
  }

  return results;
}

function printSlaMatrix() {
  console.log('\nSLA MATRIX SEEDED');
  console.log('  Silver   S1 2 business hours / 48 hours     · S2 4 business hours / 96 hours');
  console.log('           S3 3 business days  / 12 business days · S4 10 business days / N/A');
  console.log('  Gold     S1 1 hour          / 24 hours      · S2 2 business hours / 72 hours');
  console.log('           S3 2 business days / 10 business days · S4 8 business days / N/A');
  console.log('  Platinum S1 0.5 hour        / 12 hours      · S2 1 hour / 48 hours');
  console.log('           S3 1 business day  / 8 business days  · S4 6 business days / N/A');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();

  const validationErrors = validateUserCatalogue();
  if (validationErrors.length) throw new Error(`User catalogue validation failed:\n- ${validationErrors.join('\n- ')}`);

  await connectDatabase();

  const organization = await requireOrganization(options.workspace);
  const clientMap = await loadRequiredClients(organization._id);
  const severityMap = await loadRequiredSeverities(organization._id);
  const environmentMap = await loadRequiredEnvironments(organization._id);

  console.log('Service Manager v23.1.4 · UAT USERS + SLA SEED');
  console.log(`Mode      : ${options.apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Workspace : /${organization.workspaceSlug} · ${organization.name}`);
  console.log(`Clients   : ${UAT_CLIENT_CODES.standard} Standard Bank · ${UAT_CLIENT_CODES.danske} Danske Bank`);
  console.log('Password  : password');
  console.log('SLA scope : L2/L3 · PROD/DR · severity-selected · policies not assigned to clients');

  const userResults = await seedUsers(organization, clientMap, options.apply);
  const slaResults = await seedSlaPolicies(organization, severityMap, environmentMap, options.apply);

  printSlaMatrix();

  console.log('\nSUMMARY');
  console.log(`  Users       : ${userResults.length}`);
  console.log(`  SLA policies: ${slaResults.length}`);
  console.log(`  Writes      : ${options.apply ? 'completed' : 'NONE (dry run)'}`);

  if (!options.apply) {
    console.log('\nDRY RUN ONLY — no database records were changed.');
    console.log('Run again with --apply after reviewing the output.');
  } else {
    console.log('\nDONE. Every seeded UAT user now has password "password" and mustChangePassword=false.');
    console.log('Silver, Gold and Platinum are present as reusable SLA policies; neither bank has been assigned a plan by this script.');
  }
}

main()
  .catch((error) => {
    console.error(`\nFAILED: ${error.message || error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectDatabase().catch(() => {});
  });
