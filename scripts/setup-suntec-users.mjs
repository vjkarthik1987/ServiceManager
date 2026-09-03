import crypto from 'node:crypto';
import process from 'node:process';
import mongoose from 'mongoose';

import { connectDatabase, disconnectDatabase } from '../services/organization-service/src/db.js';
import { Organization } from '../services/organization-service/src/models/Organization.js';
import { Client } from '../services/organization-service/src/models/Client.js';
import { ServiceUser } from '../services/identity-service/src/models/ServiceUser.js';
import { hashPassword } from '../services/identity-service/src/password.js';
import { DEFAULT_WORKSPACE, UAT_USERS, validateSeedCatalogue } from '../lib/v23.1.1-seed-catalogue.mjs';

function parseArgs(argv) {
  const options = {
    apply: false,
    workspace: DEFAULT_WORKSPACE,
    client: '',
    resetExistingPasswords: false,
    listClients: false,
    help: false
  };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--reset-existing-passwords') options.resetExistingPasswords = true;
    else if (arg === '--list-clients') options.listClients = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--workspace=')) options.workspace = arg.slice('--workspace='.length).trim().toLowerCase();
    else if (arg.startsWith('--client=')) options.client = arg.slice('--client='.length).trim();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`\nService Manager v23.1.1 · UAT user setup\n\nUsage:\n  node scripts/setup-suntec-users.mjs --workspace=suntecgroup --list-clients\n  node scripts/setup-suntec-users.mjs --workspace=suntecgroup --client=SDSUAT --dry-run\n  node scripts/setup-suntec-users.mjs --workspace=suntecgroup --client=SDSUAT --apply\n\nOptions:\n  --workspace=<slug>              Existing workspace slug. Default: suntecgroup\n  --client=<id|6-letter-code|name> Existing client to which the UAT personas are assigned.\n  --list-clients                  List clients in the workspace and exit.\n  --dry-run                       Preview only (default).\n  --apply                         Create/update users.\n  --reset-existing-passwords      Also replace passwords of existing users with new temporary passwords.\n\nThis script NEVER creates an organization or a client. It preserves assignments to other clients and only replaces the assignment for the selected client.\n`);
}

function canonical(value) {
  return String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

function temporaryPassword() {
  // 22+ printable characters with enough entropy for a one-time password.
  return `SDS-${crypto.randomBytes(15).toString('base64url')}`;
}

function assignmentFor(client, user) {
  return {
    clientId: client._id,
    role: user.role,
    includeChildren: user.includeChildren === true,
    supportLevels: [...user.supportLevels]
  };
}

function assignmentSummary(item) {
  return `${item.role} @ ${item.supportLevels.join('/')} ${item.includeChildren ? '(incl. children)' : ''}`.trim();
}

async function findOrganization(workspace) {
  return Organization.findOne({ workspaceSlug: String(workspace || '').toLowerCase() });
}

async function resolveClient(organizationId, selector) {
  const clients = await Client.find({ organizationId }).sort({ depth: 1, name: 1 });
  const query = String(selector || '').trim();
  if (!query) return { client: null, clients };

  if (mongoose.Types.ObjectId.isValid(query)) {
    const byId = clients.find((item) => String(item._id) === query);
    if (byId) return { client: byId, clients };
  }
  const upper = query.toUpperCase();
  const byCode = clients.find((item) => String(item.shortCode || '').toUpperCase() === upper);
  if (byCode) return { client: byCode, clients };
  const wanted = canonical(query);
  const byName = clients.filter((item) => canonical(item.name) === wanted);
  if (byName.length === 1) return { client: byName[0], clients };
  if (byName.length > 1) throw new Error(`Client name "${query}" is ambiguous. Use the six-letter client code or Mongo ObjectId.`);
  return { client: null, clients };
}

function printClients(clients) {
  if (!clients.length) {
    console.log('  (no clients found)');
    return;
  }
  for (const client of clients) {
    const prefix = '  '.repeat(Number(client.depth || 0));
    console.log(`${prefix}${client.shortCode}  ${client.name}  [${client._id}]  ${client.status}`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) return printHelp();

  const validation = validateSeedCatalogue();
  if (!validation.ok) throw new Error(`Seed catalogue validation failed:\n- ${validation.errors.join('\n- ')}`);

  await connectDatabase();

  const organization = await findOrganization(options.workspace);
  if (!organization) throw new Error(`Workspace "${options.workspace}" was not found. This script does not create organizations.`);

  const { client, clients } = await resolveClient(organization._id, options.client);

  console.log('Service Manager v23.1.1 · USER SETUP');
  console.log(`Mode      : ${options.apply ? 'APPLY' : 'DRY RUN'}`);
  console.log(`Workspace : /${organization.workspaceSlug} · ${organization.name} · ${organization.status}`);

  if (options.listClients || !options.client) {
    console.log('\nAvailable clients:');
    printClients(clients);
    if (!options.client) {
      console.log('\nNo --client was supplied. No changes were made.');
      console.log('Run again with one exact client selector, for example:');
      console.log('  node .\\scripts\\setup-suntec-users.mjs --workspace=suntecgroup --client=ABCDEF --dry-run');
    }
    return;
  }

  if (!client) {
    console.log('\nAvailable clients:');
    printClients(clients);
    throw new Error(`Client "${options.client}" was not found in /${organization.workspaceSlug}. This script does not create clients.`);
  }

  console.log(`Client    : ${client.shortCode} · ${client.name} · ${client._id}`);
  console.log(`Users     : ${UAT_USERS.length}`);

  const results = [];
  const credentials = [];

  for (const definition of UAT_USERS) {
    const email = definition.email.toLowerCase();
    const existing = await ServiceUser.findOne({ organizationId: organization._id, email });
    const desired = assignmentFor(client, definition);

    const preservedAssignments = (existing?.assignments || [])
      .filter((item) => String(item.clientId || '') !== String(client._id))
      .map((item) => item.toObject ? item.toObject() : item);
    const mergedAssignments = [...preservedAssignments, desired];

    if (!existing) {
      results.push({ action: 'CREATE', definition, assignment: desired });
      console.log(`  + ${definition.name.padEnd(22)} ${email.padEnd(34)} ${assignmentSummary(desired)}`);
      if (options.apply) {
        const password = temporaryPassword();
        await ServiceUser.create({
          organizationId: organization._id,
          name: definition.name,
          email,
          assignments: mergedAssignments,
          passwordHash: hashPassword(password),
          mustChangePassword: true,
          status: 'active'
        });
        credentials.push({ name: definition.name, email, password, note: 'new user' });
      }
      continue;
    }

    const currentTarget = (existing.assignments || []).find((item) => String(item.clientId || '') === String(client._id));
    const sameAssignment = currentTarget
      && currentTarget.role === desired.role
      && Boolean(currentTarget.includeChildren) === Boolean(desired.includeChildren)
      && JSON.stringify([...(currentTarget.supportLevels || [])].sort()) === JSON.stringify([...desired.supportLevels].sort());
    const sameName = existing.name === definition.name;
    const sameStatus = existing.status === 'active';
    const needsPasswordReset = options.resetExistingPasswords;

    if (sameAssignment && sameName && sameStatus && !needsPasswordReset) {
      results.push({ action: 'UNCHANGED', definition, assignment: desired });
      console.log(`  = ${definition.name.padEnd(22)} ${email.padEnd(34)} ${assignmentSummary(desired)}`);
      continue;
    }

    results.push({ action: 'UPDATE', definition, assignment: desired });
    console.log(`  ~ ${definition.name.padEnd(22)} ${email.padEnd(34)} ${assignmentSummary(desired)}`);
    if (options.apply) {
      existing.name = definition.name;
      existing.assignments = mergedAssignments;
      existing.status = 'active';
      if (needsPasswordReset) {
        const password = temporaryPassword();
        existing.passwordHash = hashPassword(password);
        existing.mustChangePassword = true;
        credentials.push({ name: definition.name, email, password, note: 'password reset' });
      }
      await existing.save();
    }
  }

  const totals = {
    create: results.filter((item) => item.action === 'CREATE').length,
    update: results.filter((item) => item.action === 'UPDATE').length,
    unchanged: results.filter((item) => item.action === 'UNCHANGED').length
  };

  console.log('\nSummary');
  console.log(`  Create    : ${totals.create}`);
  console.log(`  Update    : ${totals.update}`);
  console.log(`  Unchanged : ${totals.unchanged}`);

  if (!options.apply) {
    console.log('\nDRY RUN ONLY — no user records were changed.');
    console.log('After review, run the same command with --apply.');
  } else if (credentials.length) {
    console.log('\nONE-TIME TEMPORARY PASSWORDS');
    console.log('Store these securely. They are not written to any file by this script.');
    for (const item of credentials) {
      console.log(`  ${item.email}  ${item.password}  (${item.note})`);
    }
  } else {
    console.log('\nApply complete. No passwords were changed.');
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
