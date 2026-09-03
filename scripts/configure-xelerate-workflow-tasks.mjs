import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { connectDatabase, disconnectDatabase } from '../services/organization-service/src/db.js';
import { Organization } from '../services/organization-service/src/models/Organization.js';
import { Workflow } from '../services/organization-service/src/models/Workflow.js';
import { xelerateIncidentTaskCatalog } from './data/xelerate-incident-tasks.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

function parseArgs(argv) {
  const options = { apply: false, workflow: '', organization: '', help: false };
  for (const arg of argv) {
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--workflow=')) options.workflow = arg.slice('--workflow='.length).trim();
    else if (arg.startsWith('--organization=')) options.organization = arg.slice('--organization='.length).trim();
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function canonical(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[–—−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function plain(value) {
  return value?.toObject ? value.toObject({ depopulate: true }) : JSON.parse(JSON.stringify(value));
}

function sameTask(a = {}, b = {}) {
  return a.localId === b.localId
    && a.title === b.title
    && a.description === b.description
    && a.ownerSide === b.ownerSide
    && a.queue === b.queue
    && Boolean(a.isBlocking) === Boolean(b.isBlocking)
    && a.visibility === b.visibility
    && Number(a.displayOrder) === Number(b.displayOrder);
}

function printHelp() {
  console.log(`\nConfigure Xelerate incident workflow task templates\n\nUsage:\n  npm run configure:xelerate-tasks\n  npm run configure:xelerate-tasks -- --apply\n  npm run configure:xelerate-tasks -- --workflow="Application Incident – L1 Bank"\n  npm run configure:xelerate-tasks -- --workflow="Application Incident – L1 Bank" --apply\n  npm run configure:xelerate-tasks -- --organization=SBS --apply\n\nOptions:\n  --dry-run               Preview only. This is the default.\n  --apply                 Write validated changes to MongoDB.\n  --workflow=<name>       Configure one catalogue workflow only.\n  --organization=<value>  Organization short code, workspace slug, name, or Mongo ID.\n  --help                   Show this help.\n`);
}

async function chooseOrganization(selector) {
  const query = { status: 'active' };
  const organizations = await Organization.find(query).sort({ name: 1 });
  if (!organizations.length) throw new Error('No active organization exists. Create the organization before running this importer.');

  if (!selector) {
    if (organizations.length === 1) return organizations[0];
    const choices = organizations.map((item) => `${item.name} [${item.shortCode}] slug=${item.workspaceSlug || '-'}`).join('\n  - ');
    throw new Error(`Multiple active organizations exist. Re-run with --organization=<shortCode|slug|name|id>.\n  - ${choices}`);
  }

  const target = canonical(selector);
  const matches = organizations.filter((item) => [String(item._id), item.shortCode, item.workspaceSlug, item.name].some((value) => canonical(value) === target));
  if (matches.length === 1) return matches[0];
  if (!matches.length) throw new Error(`Organization not found: ${selector}`);
  throw new Error(`Organization selector is ambiguous: ${selector}`);
}

function selectCatalog(workflowSelector) {
  if (!workflowSelector) return xelerateIncidentTaskCatalog;
  const target = canonical(workflowSelector);
  const matches = xelerateIncidentTaskCatalog.filter((item) => canonical(item.workflow) === target);
  if (matches.length !== 1) {
    const available = xelerateIncidentTaskCatalog.map((item) => item.workflow).join('\n  - ');
    throw new Error(`Task catalogue workflow not found: ${workflowSelector}\nAvailable workflows:\n  - ${available}`);
  }
  return matches;
}

function validateCatalog(catalog) {
  const errors = [];
  for (const definition of catalog) {
    const statusNames = new Set();
    for (const statusDefinition of definition.statuses) {
      const statusKey = canonical(statusDefinition.name);
      if (statusNames.has(statusKey)) errors.push(`${definition.workflow}: duplicate status definition ${statusDefinition.name}`);
      statusNames.add(statusKey);
      const taskIds = new Set();
      for (const task of statusDefinition.tasks) {
        if (!task.localId || task.localId.length > 60) errors.push(`${definition.workflow} / ${statusDefinition.name}: invalid localId ${task.localId}`);
        if (taskIds.has(task.localId)) errors.push(`${definition.workflow} / ${statusDefinition.name}: duplicate localId ${task.localId}`);
        taskIds.add(task.localId);
        if (!task.title || task.title.length > 180) errors.push(`${definition.workflow} / ${statusDefinition.name}: invalid title for ${task.localId}`);
        if (!['client', 'partner', 'suntec', 'internal'].includes(task.ownerSide)) errors.push(`${definition.workflow} / ${statusDefinition.name}: invalid ownerSide for ${task.localId}`);
        if (!['client_visible', 'partner_visible', 'internal_only'].includes(task.visibility)) errors.push(`${definition.workflow} / ${statusDefinition.name}: invalid visibility for ${task.localId}`);
      }
    }
  }
  if (errors.length) throw new Error(`Task catalogue validation failed:\n- ${errors.join('\n- ')}`);
}

function buildWorkflowPlan(workflow, definition) {
  const errors = [];
  const changes = [];
  const nextStatuses = workflow.statuses.map((statusItem) => plain(statusItem));
  const statusesByName = new Map(nextStatuses.map((item) => [canonical(item.name), item]));

  for (const statusDefinition of definition.statuses) {
    const targetStatus = statusesByName.get(canonical(statusDefinition.name));
    if (!targetStatus) {
      errors.push(`${workflow.name}: missing status “${statusDefinition.name}”`);
      continue;
    }

    targetStatus.taskTemplates = Array.isArray(targetStatus.taskTemplates) ? targetStatus.taskTemplates : [];
    for (const desired of statusDefinition.tasks) {
      const byId = targetStatus.taskTemplates.filter((item) => item.localId === desired.localId);
      const byTitle = targetStatus.taskTemplates.filter((item) => canonical(item.title) === canonical(desired.title));
      if (byId.length > 1) {
        errors.push(`${workflow.name} / ${targetStatus.name}: duplicate existing task localId ${desired.localId}`);
        continue;
      }
      if (!byId.length && byTitle.length > 1) {
        errors.push(`${workflow.name} / ${targetStatus.name}: multiple existing tasks have title “${desired.title}”`);
        continue;
      }

      const existing = byId[0] || byTitle[0] || null;
      if (!existing) {
        targetStatus.taskTemplates.push({ ...desired });
        changes.push({ action: 'add', status: targetStatus.name, task: desired.title });
        continue;
      }

      const adopted = existing.localId !== desired.localId;
      if (!sameTask(existing, desired)) {
        Object.assign(existing, desired);
        changes.push({ action: adopted ? 'adopt/update' : 'update', status: targetStatus.name, task: desired.title });
      } else {
        changes.push({ action: 'unchanged', status: targetStatus.name, task: desired.title });
      }
    }

    targetStatus.taskTemplates.sort((a, b) => Number(a.displayOrder || 100) - Number(b.displayOrder || 100) || String(a.title).localeCompare(String(b.title)));
  }

  return { workflow, nextStatuses, changes, errors };
}

function printPlan(plan) {
  console.log(`\n${plan.workflow.name}`);
  const grouped = new Map();
  for (const change of plan.changes) {
    if (!grouped.has(change.status)) grouped.set(change.status, []);
    grouped.get(change.status).push(change);
  }
  for (const [statusName, statusChanges] of grouped) {
    console.log(`  ${statusName}`);
    for (const item of statusChanges) {
      const marker = item.action === 'add' ? '+' : item.action === 'unchanged' ? '=' : '~';
      console.log(`    ${marker} ${item.task}${item.action === 'adopt/update' ? ' [adopt existing title]' : item.action === 'update' ? ' [update]' : item.action === 'unchanged' ? ' [unchanged]' : ''}`);
    }
  }
}

async function writeBackup(organization, plans) {
  const backupDirectory = path.join(projectRoot, 'backups', 'workflow-task-imports');
  await fs.mkdir(backupDirectory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(backupDirectory, `xelerate-workflow-tasks-${organization.shortCode}-${stamp}.json`);
  const payload = {
    createdAt: new Date().toISOString(),
    organization: { id: String(organization._id), name: organization.name, shortCode: organization.shortCode, workspaceSlug: organization.workspaceSlug || '' },
    workflows: plans.map((plan) => plain(plan.workflow))
  };
  await fs.writeFile(backupPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return backupPath;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const catalog = selectCatalog(options.workflow);
  validateCatalog(catalog);
  await connectDatabase();

  const organization = await chooseOrganization(options.organization);
  const workflows = await Workflow.find({ organizationId: organization._id }).sort({ name: 1 });
  const workflowsByName = new Map();
  for (const workflow of workflows) {
    const key = canonical(workflow.name);
    if (!workflowsByName.has(key)) workflowsByName.set(key, []);
    workflowsByName.get(key).push(workflow);
  }

  const errors = [];
  const plans = [];
  for (const definition of catalog) {
    const matches = workflowsByName.get(canonical(definition.workflow)) || [];
    if (!matches.length) {
      errors.push(`Missing workflow: “${definition.workflow}”`);
      continue;
    }
    if (matches.length > 1) {
      errors.push(`Multiple workflows match: “${definition.workflow}”`);
      continue;
    }
    const plan = buildWorkflowPlan(matches[0], definition);
    plans.push(plan);
    errors.push(...plan.errors);
  }

  if (errors.length) {
    console.error('\nValidation failed. No changes were written.');
    errors.forEach((error) => console.error(`- ${error}`));
    process.exitCode = 1;
    return;
  }

  console.log(`\nOrganization: ${organization.name} [${organization.shortCode}]`);
  console.log(`Mode: ${options.apply ? 'APPLY' : 'DRY RUN'}`);
  plans.forEach(printPlan);

  const summary = plans.flatMap((plan) => plan.changes).reduce((acc, item) => {
    acc[item.action] = (acc[item.action] || 0) + 1;
    return acc;
  }, {});
  console.log('\nSummary');
  console.log(`  Workflows validated: ${plans.length}`);
  console.log(`  Tasks to add: ${summary.add || 0}`);
  console.log(`  Tasks to update/adopt: ${(summary.update || 0) + (summary['adopt/update'] || 0)}`);
  console.log(`  Tasks unchanged: ${summary.unchanged || 0}`);

  if (!options.apply) {
    console.log('\nNo database changes made. Re-run with --apply after reviewing this output.');
    return;
  }

  const changedPlans = plans.filter((plan) => plan.changes.some((item) => item.action !== 'unchanged'));
  if (!changedPlans.length) {
    console.log('\nNothing to apply. All managed task templates already match the catalogue.');
    return;
  }

  const backupPath = await writeBackup(organization, changedPlans);
  for (const plan of changedPlans) {
    plan.workflow.statuses = plan.nextStatuses;
    await plan.workflow.save();
  }

  console.log(`\nApplied task templates to ${changedPlans.length} workflow(s).`);
  console.log(`Backup written to: ${path.relative(projectRoot, backupPath)}`);
  console.log('Existing request task instances were not changed. New templates apply when a stage enters the corresponding status.');
}

try {
  await main();
} catch (error) {
  console.error(`\nImporter failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  try { await disconnectDatabase(); } catch { /* no-op */ }
}
