import process from 'node:process';
import mongoose from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../services/organization-service/src/db.js';
import { Organization } from '../services/organization-service/src/models/Organization.js';
import { Client } from '../services/organization-service/src/models/Client.js';
import { IssueType } from '../services/organization-service/src/models/IssueType.js';
import { DEFAULT_WORKSPACE, REQUEST_TAXONOMY, validateSeedCatalogue } from '../lib/v23.1.1-seed-catalogue.mjs';

function parseArgs(argv) {
  const options = {
    apply: false,
    workspace: DEFAULT_WORKSPACE,
    client: '',
    makeClientCustom: false,
    help: false
  };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--make-client-custom') options.makeClientCustom = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--workspace=')) options.workspace = arg.slice('--workspace='.length).trim().toLowerCase();
    else if (arg.startsWith('--client=')) options.client = arg.slice('--client='.length).trim();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`\nService Manager v23.1.1 · Request taxonomy setup\n\nUsage:\n  node scripts/setup-request-taxonomy.mjs --workspace=suntecgroup --dry-run\n  node scripts/setup-request-taxonomy.mjs --workspace=suntecgroup --apply\n  node scripts/setup-request-taxonomy.mjs --workspace=suntecgroup --client=SDSUAT --dry-run\n  node scripts/setup-request-taxonomy.mjs --workspace=suntecgroup --client=SDSUAT --make-client-custom --apply\n\nThis script creates/updates only the v23.1 hierarchy below the existing workspace:\n  Family: Request\n    Issue Types: Incident, Service Request, Maintenance Request, Problem, Change Request, Query\n    Subtypes: the agreed catalogue under each Issue Type.\n\nIt NEVER creates an organization, client, workflow, SLA, product, or user.\nIf --client is supplied, the Request Family is added to that existing client's enabledFamilyIds without removing other families. An inherited client is changed to custom only when --make-client-custom is explicitly supplied.\n`);
}

function canonical(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

async function findOrganization(workspace) {
  return Organization.findOne({ workspaceSlug: String(workspace || '').toLowerCase() });
}

async function resolveClient(organizationId, selector) {
  if (!selector) return null;
  const clients = await Client.find({ organizationId });
  const query = String(selector).trim();
  if (mongoose.Types.ObjectId.isValid(query)) {
    const byId = clients.find((item) => String(item._id) === query);
    if (byId) return byId;
  }
  const byCode = clients.find((item) => String(item.shortCode || '').toUpperCase() === query.toUpperCase());
  if (byCode) return byCode;
  const matches = clients.filter((item) => canonical(item.name) === canonical(query));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`Client name "${query}" is ambiguous. Use short code or ObjectId.`);
  return null;
}

function fieldsConfig() {
  return { severity: true, priority: true, product: true, module: true, region: true, environment: true };
}

async function existingNode(organizationId, level, parentTypeId, key) {
  const query = { organizationId, level, key };
  if (parentTypeId) query.parentTypeId = parentTypeId;
  else query.parentTypeId = null;
  return IssueType.findOne(query);
}

async function materializeNode({ organizationId, level, parentTypeId = null, name, key, description, icon = '◌', displayOrder = 100, apply }) {
  const found = await existingNode(organizationId, level, parentTypeId, key);
  const desired = {
    organizationId,
    level,
    parentTypeId,
    name,
    key,
    description,
    icon,
    displayOrder,
    status: 'active'
  };
  if (level > 1) desired.fieldsConfig = fieldsConfig();

  if (!found) {
    console.log(`  + L${level} ${name}`);
    if (!apply) return { _id: new mongoose.Types.ObjectId(), ...desired, _preview: true };
    return IssueType.create(desired);
  }

  const changed = found.name !== name
    || found.description !== description
    || found.icon !== icon
    || Number(found.displayOrder || 100) !== Number(displayOrder)
    || found.status !== 'active';

  if (!changed) {
    console.log(`  = L${level} ${name}`);
    return found;
  }

  console.log(`  ~ L${level} ${name}`);
  if (apply) {
    found.name = name;
    found.description = description;
    found.icon = icon;
    found.displayOrder = displayOrder;
    found.status = 'active';
    if (level > 1 && !found.fieldsConfig) found.fieldsConfig = fieldsConfig();
    await found.save();
  }
  return found;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();

  const validation = validateSeedCatalogue();
  if (!validation.ok) throw new Error(`Seed catalogue validation failed:\n- ${validation.errors.join('\n- ')}`);

  await connectDatabase();
  const organization = await findOrganization(options.workspace);
  if (!organization) throw new Error(`Workspace "${options.workspace}" was not found. This script does not create organizations.`);

  const client = options.client ? await resolveClient(organization._id, options.client) : null;
  if (options.client && !client) throw new Error(`Client "${options.client}" was not found in /${organization.workspaceSlug}.`);

  console.log('Service Manager v23.1.1 · REQUEST TAXONOMY SETUP');
  console.log(`Mode      : ${options.apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Workspace : /${organization.workspaceSlug} · ${organization.name} · ${organization.status}`);
  if (client) console.log(`Client    : ${client.shortCode} · ${client.name} · ${client.issueTypeMode}`);
  console.log(`Catalogue : ${validation.counts.families} family · ${validation.counts.issueTypes} issue types · ${validation.counts.subtypes} subtypes`);
  console.log('');

  const family = await materializeNode({
    organizationId: organization._id,
    level: 1,
    parentTypeId: null,
    ...REQUEST_TAXONOMY.family,
    apply: options.apply
  });

  for (const issueTypeDef of REQUEST_TAXONOMY.issueTypes) {
    const issueType = await materializeNode({
      organizationId: organization._id,
      level: 2,
      parentTypeId: family._id,
      name: issueTypeDef.name,
      key: issueTypeDef.key,
      description: issueTypeDef.description,
      icon: '◌',
      displayOrder: issueTypeDef.displayOrder,
      apply: options.apply
    });

    let subtypeOrder = 10;
    for (const [name, key, description] of issueTypeDef.subtypes) {
      await materializeNode({
        organizationId: organization._id,
        level: 3,
        parentTypeId: issueType._id,
        name,
        key,
        description,
        icon: '◌',
        displayOrder: subtypeOrder,
        apply: options.apply
      });
      subtypeOrder += 10;
    }
  }

  if (client) {
    const currentlyEnabled = new Set((client.enabledFamilyIds || []).map(String));
    const hasFamily = currentlyEnabled.has(String(family._id));
    if (client.issueTypeMode === 'inherit' && !options.makeClientCustom) {
      console.log(`\n! Client ${client.shortCode} is in inherit mode. Request Family was NOT assigned.`);
      console.log('  Re-run with --make-client-custom only if you intentionally want this client to use a custom family selection.');
    } else if (!hasFamily || (client.issueTypeMode === 'inherit' && options.makeClientCustom)) {
      console.log(`\n${options.apply ? '~' : '?'} Enable Request Family for client ${client.shortCode}`);
      if (options.apply) {
        client.issueTypeMode = 'custom';
        client.enabledFamilyIds = [...(client.enabledFamilyIds || []), family._id]
          .filter((value, index, array) => array.findIndex((other) => String(other) === String(value)) === index);
        await client.save();
      }
    } else {
      console.log(`\n= Request Family already enabled for client ${client.shortCode}`);
    }
  }

  if (!options.apply) {
    console.log('\nDRY RUN ONLY — no taxonomy records were changed.');
    console.log('After review, run the same command with --apply.');
  } else {
    console.log('\nApply complete. Existing workflows, SLA policies, products and unrelated taxonomy rows were not modified.');
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
