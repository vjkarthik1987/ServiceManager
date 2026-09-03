import test from 'node:test';
import assert from 'node:assert/strict';
import { REQUEST_TAXONOMY, UAT_USERS, taxonomyCounts, validateSeedCatalogue } from '../lib/v23.1.1-seed-catalogue.mjs';

test('v23.1.1 seed catalogue validates', () => {
  const result = validateSeedCatalogue();
  assert.equal(result.ok, true, result.errors.join('\n'));
});

test('Request taxonomy has one family, six issue types and the agreed subtype catalogue', () => {
  const counts = taxonomyCounts();
  assert.deepEqual(counts, { families: 1, issueTypes: 6, subtypes: 38 });
  assert.equal(REQUEST_TAXONOMY.family.name, 'Request');
  assert.deepEqual(REQUEST_TAXONOMY.issueTypes.map((item) => item.name), [
    'Incident', 'Service Request', 'Maintenance Request', 'Problem', 'Change Request', 'Query'
  ]);
});

test('Incident and Service Request use the agreed subtypes', () => {
  const incident = REQUEST_TAXONOMY.issueTypes.find((item) => item.key === 'INCIDENT');
  const serviceRequest = REQUEST_TAXONOMY.issueTypes.find((item) => item.key === 'SERVICE_REQUEST');
  assert.deepEqual(incident.subtypes.map(([name]) => name), ['Application', 'Security', 'Infrastructure', 'Operational']);
  assert.ok(serviceRequest.subtypes.some(([name]) => name === 'AWS User Access'));
  assert.ok(serviceRequest.subtypes.some(([name]) => name === 'DR Drill / BCP'));
  assert.ok(serviceRequest.subtypes.some(([name]) => name === 'Application Container Image Deletion'));
});

test('UAT users cover client, partner, agent, manager and engagement personas', () => {
  const roles = new Set(UAT_USERS.map((item) => item.role));
  for (const role of ['clientUser', 'partnerUser', 'agentUser', 'agentManager', 'engagementManager']) {
    assert.ok(roles.has(role), `Missing role ${role}`);
  }
  assert.ok(UAT_USERS.some((item) => item.email === 'karthikvj@suntecsbs.com' && item.role === 'clientUser'));
  assert.ok(UAT_USERS.some((item) => item.email === 'rajanir@suntecsbs.com' && item.role === 'partnerUser'));
  assert.ok(UAT_USERS.some((item) => item.email === 'rajanir@suntecgroup.com' && item.role === 'agentUser'));
});
