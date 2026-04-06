require('dotenv').config();
const mongoose = require('mongoose');
const { connectDb } = require('../config/db');
const { Entity } = require('../modules/entities/entity.model');
const { Tenant } = require('../modules/tenant/tenant.model');
const { User } = require('../modules/users/user.model');
const { Issue } = require('../modules/issues/issue.model');
const { IssueComment } = require('../modules/issues/issue-comment.model');
const { IssueActivity } = require('../modules/issues/issue-activity.model');
const { IssueCounter } = require('../modules/issues/issue-counter.model');
const { AuditLog } = require('../modules/audit/audit.model');
const { UserEntityMembership } = require('../modules/memberships/membership.model');
const { createUserForTenant } = require('../modules/users/user.service');
const { createIssueActivity } = require('../modules/issues/issue.service');
const { SupportGroup } = require('../modules/support-groups/support-group.model');
const { RoutingRule } = require('../modules/routing/routing-rule.model');
const { SlaPolicy } = require('../modules/sla/sla-policy.model');

async function run() {
  await connectDb();

  const preferredTenantId = new mongoose.Types.ObjectId('64a000000000000000000001');
  const preferredTenantBId = new mongoose.Types.ObjectId('64a000000000000000000002');
  const primarySlug = process.env.TENANT_SLUG || 'suntec';
  const password = 'password';

  const existingTenants = await Tenant.find({ slug: { $in: [primarySlug, 'acme'] } }).lean();
  const existingTenantIds = existingTenants.map((tenant) => tenant._id);
  const cleanupTenantIds = [...existingTenantIds, preferredTenantId, preferredTenantBId];

  await Promise.all([
    Entity.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
    User.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
    UserEntityMembership.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
    Issue.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
    IssueComment.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
    IssueActivity.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
    IssueCounter.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
    AuditLog.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
    SupportGroup.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
    RoutingRule.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
    SlaPolicy.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
    Tenant.deleteMany({ slug: { $in: [primarySlug, 'acme'] } })
  ]);

  const tenant = await Tenant.create({ _id: preferredTenantId, name: process.env.TENANT_NAME || 'SunTec', slug: primarySlug, status: 'active' });
  const tenantB = await Tenant.create({ _id: preferredTenantBId, name: 'Acme', slug: 'acme', status: 'active' });
  const tenantId = tenant._id;
  const tenantBId = tenantB._id;

  const parents = [];
  const children = [];
  for (let i = 1; i <= 10; i += 1) {
    const parent = await Entity.create({
      tenantId,
      name: `Client ${String(i).padStart(2, '0')}`,
      acronym: `C${String(i).padStart(3, '0')}`,
      type: 'client',
      path: `Client ${String(i).padStart(2, '0')}`,
      metadata: { region: i % 2 ? 'Africa' : 'MEA', product: 'ESOP', slaTier: i % 3 === 0 ? 'Silver' : 'Gold' }
    });
    parents.push(parent);
  }

  let childIndex = 1;
  for (const parent of parents) {
    for (let j = 1; j <= 2; j += 1) {
      const child = await Entity.create({
        tenantId,
        name: `${parent.name} Sub ${j}`,
        acronym: `S${String(childIndex).padStart(3, '0')}`,
        type: 'subclient',
        parentId: parent._id,
        path: `${parent.path} / ${parent.name} Sub ${j}`,
        metadata: { region: j % 2 ? 'Zimbabwe' : 'UAE', product: 'ESOP', slaTier: 'Gold' }
      });
      children.push(child);
      childIndex += 1;
    }
  }

  const { user: superadmin } = await createUserForTenant({
    tenantId,
    name: 'ESOP Superadmin',
    email: 'superadmin@local.test',
    password,
    role: 'superadmin',
    sendProvisioningEmail: false
  });

  const agents = [];
  for (let i = 1; i <= 12; i += 1) {
    const entityIds = [parents[(i - 1) % parents.length]._id.toString(), children[(i - 1) % children.length]._id.toString()];
    const { user: agent } = await createUserForTenant({
      tenantId,
      name: `Agent ${i}`,
      email: `agent${i}@local.test`,
      password,
      role: 'agent',
      entityIds
    });
    agents.push(agent);
  }

  const supportGroups = [];

  const clients = [];
  for (let i = 1; i <= 40; i += 1) {
    const entity = children[(i - 1) % children.length];
    const { user: client } = await createUserForTenant({
      tenantId,
      name: `Client User ${i}`,
      email: `client${i}@local.test`,
      password,
      role: 'client',
      entityId: entity._id.toString()
    });
    clients.push(client);
  }

  for (let i = 1; i <= 4; i += 1) {
    const group = await SupportGroup.create({
      tenantId,
      name: ['Access Support', 'Operations Desk', 'Payments L2', 'Platform Core'][i - 1],
      code: ['ACCESS', 'OPS', 'PAY', 'PLATFORM'][i - 1],
      description: 'Seeded support group',
      defaultAssigneeUserId: agents[i - 1]._id
    });
    supportGroups.push(group);
  }

  await RoutingRule.insertMany([
    { tenantId, name: 'Access tickets', category: 'ACCESS', priority: 'ANY', supportGroupId: supportGroups[0]._id, defaultAssigneeUserId: agents[0]._id, rank: 10 },
    { tenantId, name: 'Operations tickets', category: 'OPERATIONS', priority: 'ANY', supportGroupId: supportGroups[1]._id, defaultAssigneeUserId: agents[1]._id, rank: 10 },
    { tenantId, name: 'Payments critical', category: 'PAYMENTS', priority: 'CRITICAL', supportGroupId: supportGroups[2]._id, defaultAssigneeUserId: agents[2]._id, rank: 5 },
    { tenantId, name: 'General fallback', category: 'GENERAL', priority: 'ANY', supportGroupId: supportGroups[3]._id, defaultAssigneeUserId: agents[3]._id, rank: 100, executionMode: 'NATIVE' },
    { tenantId, name: 'Integration tickets', category: 'INTEGRATION', priority: 'ANY', supportGroupId: supportGroups[3]._id, defaultAssigneeUserId: agents[3]._id, rank: 20, executionMode: 'JIRA' }
  ]);

  await SlaPolicy.insertMany([
    { tenantId, name: 'Global Gold Default', category: 'ANY', priority: 'ANY', executionMode: 'ANY', responseTargetMinutes: 60, resolutionTargetMinutes: 480, warningThresholdPercent: 80, rank: 100, isActive: true },
    { tenantId, name: 'Payments Critical Fast Lane', category: 'PAYMENTS', priority: 'CRITICAL', executionMode: 'ANY', responseTargetMinutes: 15, resolutionTargetMinutes: 120, warningThresholdPercent: 70, rank: 5, isActive: true },
    { tenantId, name: 'Integration Jira Flow', category: 'INTEGRATION', priority: 'ANY', executionMode: 'JIRA', responseTargetMinutes: 30, resolutionTargetMinutes: 240, warningThresholdPercent: 75, rank: 20, isActive: true }
  ]);

  let sequence = 0;
  const issues = [];
  for (let i = 0; i < 60; i += 1) {
    sequence += 1;
    const entity = i % 2 === 0 ? children[i % children.length] : parents[i % parents.length];
    const creator = clients[i % clients.length];
    const assignee = agents[i % agents.length];
    const issue = await Issue.create({
      tenantId,
      entityId: entity._id,
      issueNumber: `${entity.acronym}-${1000 + sequence}`,
      title: `Seed issue ${sequence}`,
      description: `Seeded issue ${sequence} for ${entity.name}`,
      status: i % 4 === 0 ? 'IN_PROGRESS' : 'OPEN',
      priority: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'][i % 4],
      category: i % 2 === 0 ? 'Access' : 'Operations',
      supportGroupId: i % 2 === 0 ? supportGroups[0]._id : supportGroups[1]._id,
      routingStatus: 'ROUTED',
      createdByUserId: creator._id,
      lastUpdatedByUserId: assignee._id,
      assignedToUserId: assignee._id,
      reporterType: 'client_user',
      executionMode: i % 5 === 0 ? 'JIRA' : 'NATIVE',
      executionState: 'READY_FOR_EXECUTION',
      attachments: [],
      tags: ['seed'],
      source: 'portal'
    });
    issues.push(issue);

    await createIssueActivity({ tenantId, issueId: issue._id, entityId: entity._id, type: 'ISSUE_CREATED', metadata: { issueNumber: issue.issueNumber }, performedByUserId: creator._id, performedByRole: 'client_user' });
    await createIssueActivity({ tenantId, issueId: issue._id, entityId: entity._id, type: 'ISSUE_EXECUTION_MODE_SET', metadata: { source: 'SEED', after: { executionMode: issue.executionMode, executionState: issue.executionState } }, performedByUserId: superadmin._id, performedByRole: 'superadmin' });
    await createIssueActivity({ tenantId, issueId: issue._id, entityId: entity._id, type: 'ASSIGNED', metadata: { after: { assignedToUserId: assignee._id.toString() } }, performedByUserId: superadmin._id, performedByRole: 'superadmin' });
    if (issue.status !== 'OPEN') {
      await createIssueActivity({ tenantId, issueId: issue._id, entityId: entity._id, type: 'STATUS_CHANGED', metadata: { before: { status: 'OPEN' }, after: { status: issue.status } }, performedByUserId: assignee._id, performedByRole: 'agent' });
    }

    await IssueComment.create({ tenantId, issueId: issue._id, entityId: entity._id, commentText: `External update on ${issue.issueNumber}`, authorUserId: creator._id, authorRole: 'client_user', visibility: 'EXTERNAL', attachments: [] });
    await createIssueActivity({ tenantId, issueId: issue._id, entityId: entity._id, type: 'COMMENT_ADDED', metadata: { visibility: 'EXTERNAL' }, performedByUserId: creator._id, performedByRole: 'client_user' });
    await IssueComment.create({ tenantId, issueId: issue._id, entityId: entity._id, commentText: `Internal note on ${issue.issueNumber}`, authorUserId: assignee._id, authorRole: 'agent', visibility: 'INTERNAL', attachments: [] });
    await createIssueActivity({ tenantId, issueId: issue._id, entityId: entity._id, type: 'COMMENT_ADDED', metadata: { visibility: 'INTERNAL' }, performedByUserId: assignee._id, performedByRole: 'agent' });
  }

  for (const entity of [...parents, ...children]) {
    await IssueCounter.create({ tenantId, entityId: entity._id, acronym: entity.acronym, sequence: 1000 });
  }

  const acmeClient = await Entity.create({
    tenantId: tenantBId,
    name: 'Acme Client',
    acronym: 'ACME',
    type: 'client',
    path: 'Acme Client',
    metadata: { region: 'Global', product: 'ESOP', slaTier: 'Gold' }
  });
  const acmeSubclient = await Entity.create({
    tenantId: tenantBId,
    name: 'Acme Client Sub 1',
    acronym: 'ACM1',
    type: 'subclient',
    parentId: acmeClient._id,
    path: 'Acme Client / Acme Client Sub 1',
    metadata: { region: 'Global', product: 'ESOP', slaTier: 'Gold' }
  });

  const { user: acmeSuperadmin } = await createUserForTenant({
    tenantId: tenantBId,
    name: 'Acme Superadmin',
    email: 'superadmin@acme.test',
    password,
    role: 'superadmin',
    sendProvisioningEmail: false
  });

  const { user: acmeAgent } = await createUserForTenant({
    tenantId: tenantBId,
    name: 'Acme Agent 1',
    email: 'agent1@acme.test',
    password,
    role: 'agent',
    entityIds: [acmeClient._id.toString(), acmeSubclient._id.toString()]
  });

  const { user: acmeUser } = await createUserForTenant({
    tenantId: tenantBId,
    name: 'Acme Client User 1',
    email: 'client1@acme.test',
    password,
    role: 'client',
    entityId: acmeSubclient._id.toString()
  });

  const acmeSupportGroup = await SupportGroup.create({
    tenantId: tenantBId,
    name: 'Acme Support',
    code: 'ACME-OPS',
    description: 'Seeded support group for Acme',
    defaultAssigneeUserId: acmeAgent._id
  });

  await RoutingRule.create({
    tenantId: tenantBId,
    name: 'Acme general fallback',
    category: 'GENERAL',
    priority: 'ANY',
    supportGroupId: acmeSupportGroup._id,
    defaultAssigneeUserId: acmeAgent._id,
    rank: 100
  });

  await IssueCounter.create({ tenantId: tenantBId, entityId: acmeSubclient._id, acronym: acmeSubclient.acronym, sequence: 1000 });

  const acmeIssue = await Issue.create({
    tenantId: tenantBId,
    entityId: acmeSubclient._id,
    issueNumber: 'ACM1-1001',
    title: 'Seed issue 1',
    description: 'Seeded issue for Acme tenant',
    status: 'OPEN',
    priority: 'MEDIUM',
    category: 'GENERAL',
    supportGroupId: acmeSupportGroup._id,
    routingStatus: 'ROUTED',
    createdByUserId: acmeUser._id,
    lastUpdatedByUserId: acmeAgent._id,
    assignedToUserId: acmeAgent._id,
    reporterType: 'client_user',
    executionMode: 'NATIVE',
    executionState: 'READY_FOR_EXECUTION',
    attachments: [],
    tags: ['seed'],
    source: 'portal'
  });

  await createIssueActivity({ tenantId: tenantBId, issueId: acmeIssue._id, entityId: acmeSubclient._id, type: 'ISSUE_CREATED', metadata: { issueNumber: acmeIssue.issueNumber }, performedByUserId: acmeUser._id, performedByRole: 'client_user' });
  await createIssueActivity({ tenantId: tenantBId, issueId: acmeIssue._id, entityId: acmeSubclient._id, type: 'ISSUE_EXECUTION_MODE_SET', metadata: { source: 'SEED', after: { executionMode: acmeIssue.executionMode, executionState: acmeIssue.executionState } }, performedByUserId: acmeSuperadmin._id, performedByRole: 'superadmin' });
  await createIssueActivity({ tenantId: tenantBId, issueId: acmeIssue._id, entityId: acmeSubclient._id, type: 'ASSIGNED', metadata: { after: { assignedToUserId: acmeAgent._id.toString() } }, performedByUserId: acmeSuperadmin._id, performedByRole: 'superadmin' });
  await IssueComment.create({ tenantId: tenantBId, issueId: acmeIssue._id, entityId: acmeSubclient._id, commentText: 'External update on ACM1-1001', authorUserId: acmeUser._id, authorRole: 'client_user', visibility: 'EXTERNAL', attachments: [] });

  console.log('Seed complete.');
  console.log(`Database: ${process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/esop_v11'}`);
  console.log(`Entities: ${parents.length}`);
  console.log(`Subclients: ${children.length}`);
  console.log(`Agents: ${agents.length}`);
  console.log(`Client users: ${clients.length}`);
  console.log(`Issues: ${issues.length}`);
  console.log(`Comments (SunTec): ${await IssueComment.countDocuments({ tenantId })}`);
  console.log(`Comments (Acme): ${await IssueComment.countDocuments({ tenantId: tenantBId })}`);
  console.log('Login samples:');
  console.log(`- /suntec/login -> superadmin@local.test / ${password}`);
  console.log(`- /suntec/login -> agent1@local.test / ${password}`);
  console.log(`- /suntec/login -> client1@local.test / ${password}`);
  console.log(`- /acme/login -> superadmin@acme.test / ${password}`);
  console.log(`- /acme/login -> agent1@acme.test / ${password}`);
  console.log(`- /acme/login -> client1@acme.test / ${password}`);

  await mongoose.connection.close();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
