#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (name) => JSON.parse(fs.readFileSync(path.join(root, 'config/v24-saas', name), 'utf8'));

const manifest = load('service-model.json');
const fieldsDoc = load('field-registry.json');
const formsDoc = load('form-definitions.json');
const workflowsDoc = load('workflows.json');
const bindingsDoc = load('subtype-workflow-map.json');
const pathsDoc = load('support-paths.json');
const rolesDoc = load('role-capabilities.json');
const approvalsDoc = load('approval-policies.json');
const productVersionsDoc = load('product-version-model.json');

const key = 'SUNTEC_SAAS_V24';
const errors = [];
const assert = (condition, message) => { if (!condition) errors.push(message); };

for (const [name, doc] of Object.entries({ manifest, fieldsDoc, formsDoc, workflowsDoc, bindingsDoc, pathsDoc, rolesDoc, approvalsDoc, productVersionsDoc })) {
  assert((doc.key || doc.serviceModelKey) === key, `${name}: wrong service model key`);
}

const fields = new Map(fieldsDoc.fields.map((item) => [item.key, item]));
const forms = new Map(formsDoc.forms.map((item) => [item.key, item]));
const workflows = new Map(workflowsDoc.workflows.map((item) => [item.key, item]));
const paths = new Map(pathsDoc.supportPaths.map((item) => [item.key, item]));

for (const form of forms.values()) {
  assert(workflows.has(form.workflowKey), `${form.key}: missing workflow ${form.workflowKey}`);
  for (const ref of form.fields || []) assert(fields.has(ref.key), `${form.key}: missing field ${ref.key}`);
}

for (const binding of bindingsDoc.bindings || []) {
  assert(forms.has(binding.formKey), `binding ${binding.formKey}: missing form`);
  assert(workflows.has(binding.workflowKey), `binding ${binding.formKey}: missing workflow ${binding.workflowKey}`);
}

for (const workflow of workflows.values()) {
  const statuses = new Set((workflow.statuses || []).map((item) => item.key));
  assert(statuses.has(workflow.startStatus), `${workflow.key}: missing start status ${workflow.startStatus}`);
  for (const transition of workflow.transitions || []) {
    assert(statuses.has(transition.from), `${workflow.key}/${transition.key}: missing from ${transition.from}`);
    assert(statuses.has(transition.to), `${workflow.key}/${transition.key}: missing to ${transition.to}`);
  }
}

for (const supportPath of paths.values()) {
  const levels = new Set((supportPath.levels || []).map((item) => item.localId));
  for (const level of supportPath.levels || []) assert(workflows.has(level.workflowKey), `${supportPath.key}/${level.localId}: missing workflow ${level.workflowKey}`);
  for (const rule of supportPath.movementRules || []) {
    assert(levels.has(rule.fromLevelId), `${supportPath.key}/${rule.localId}: missing source level ${rule.fromLevelId}`);
    assert(levels.has(rule.toLevelId), `${supportPath.key}/${rule.localId}: missing target level ${rule.toLevelId}`);
    const sourceLevel = (supportPath.levels || []).find((item) => item.localId === rule.fromLevelId);
    const wf = workflows.get(sourceLevel?.workflowKey);
    const statuses = new Set((wf?.statuses || []).map((item) => item.key));
    for (const state of rule.allowedFromStatusIds || []) assert(statuses.has(state), `${supportPath.key}/${rule.localId}: missing allowed status ${state}`);
    if (rule.targetStatusId) assert(statuses.has(rule.targetStatusId), `${supportPath.key}/${rule.localId}: missing target status ${rule.targetStatusId}`);
  }
}

const incidentForms = [...forms.values()].filter((item) => item.family === 'INCIDENT');
assert(incidentForms.length === 4, `Expected 4 Incident forms, found ${incidentForms.length}`);
assert(manifest.taxonomy?.furtherClassification === 'form_field_not_taxonomy_level', 'Further Classification must remain a form field');
assert(manifest.sla?.incident?.attachedAt === 'ISSUE_TYPE:INCIDENT', 'Incident SLA must be attached at Issue Type');
assert(manifest.routing?.clientDirectL3 === false, 'Client direct L3 must be disabled');

if (errors.length) {
  console.error(`v24 config validation FAILED (${errors.length})`);
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log('v24 config validation PASS');
console.log(`Fields: ${fields.size}`);
console.log(`Forms: ${forms.size}`);
console.log(`Workflows: ${workflows.size}`);
console.log(`Support paths: ${paths.size}`);
console.log(`Bindings: ${(bindingsDoc.bindings || []).length}`);
