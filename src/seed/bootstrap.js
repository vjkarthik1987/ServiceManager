require('dotenv').config();
const mongoose = require('mongoose');
const { connectDb } = require('../config/db');
const { Entity } = require('../modules/entities/entity.model');
const { Tenant } = require('../modules/tenant/tenant.model');
const { User } = require('../modules/users/user.model');
const { ApprovedUser } = require('../modules/users/approved-user.model');
const { Issue } = require('../modules/issues/issue.model');
const { IssueComment } = require('../modules/issues/issue-comment.model');
const { IssueActivity } = require('../modules/issues/issue-activity.model');
const { IssueCounter } = require('../modules/issues/issue-counter.model');
const { AuditLog } = require('../modules/audit/audit.model');
const { UserEntityMembership } = require('../modules/memberships/membership.model');
const { createUserForTenant } = require('../modules/users/user.service');
const { bulkCreateApprovedUsersForTenant } = require('../modules/users/approved-user.service');
const { SupportGroup } = require('../modules/support-groups/support-group.model');
const { RoutingRule } = require('../modules/routing/routing-rule.model');
const { SlaPolicy } = require('../modules/sla/sla-policy.model');

const PASSWORD = 'password';
const STATUSES = ['NEW', 'UNDER_REVIEW', 'APPROVED', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'RESOLVED', 'CLOSED'];
const REQUEST_TYPES = ['BUG', 'CR', 'QUERY'];
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'BLOCKER'];
const CATEGORIES = ['ACCESS', 'OPERATIONS', 'PAYMENTS', 'INTEGRATION', 'GENERAL'];
const PRODUCTS = ['ESOP', 'STP', 'Collections', 'Lending', 'Core'];

function pad(num, size) {
  return String(num).padStart(size, '0');
}

function acronym(prefix, index) {
  const base = `${prefix}${pad(index, 5)}`;
  return base.slice(0, 6).toUpperCase();
}

function pick(arr, index) {
  return arr[index % arr.length];
}

function randomishDate(index, totalDaysBack = 420) {
  const now = new Date();
  const daysBack = index % totalDaysBack;
  const hour = (index * 7) % 24;
  const minute = (index * 13) % 60;
  const date = new Date(now);
  date.setDate(now.getDate() - daysBack);
  date.setHours(hour, minute, 0, 0);
  return date;
}

async function createApprovedPoolEntries({ tenantId, entries = [], createdByUserId = null }) {
  const deduped = [];
  const seen = new Set();
  for (const entry of entries) {
    const name = String(entry?.name || '').trim();
    const email = String(entry?.email || '').trim().toLowerCase();
    if (!name || !email) continue;
    const key = `${email}::${name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push({ name, email });
  }
  if (!deduped.length) return [];
  return bulkCreateApprovedUsersForTenant({ tenantId, entries: deduped, createdByUserId });
}

async function createSeedUsers({ tenantId, parent, subclients, managerIndex, agentOffset, engagementIndex, clientStartIndex, users }) {
  const managerEntityIds = [parent._id.toString(), ...subclients.map((e) => e._id.toString())];

  await createApprovedPoolEntries({
    tenantId,
    createdByUserId: users.superadmins[0]?._id || null,
    entries: [
      { name: `Agent Manager ${managerIndex}`, email: `agentmanager${managerIndex}@local.test` },
      ...Array.from({ length: 2 }).map((_, i) => ({
        name: `Agent User ${agentOffset + i + 1}`,
        email: `agentuser${agentOffset + i + 1}@local.test`
      }))
    ]
  });

  const { user: manager } = await createUserForTenant({
    tenantId,
    name: `Agent Manager ${managerIndex}`,
    email: `agentmanager${managerIndex}@local.test`,
    password: PASSWORD,
    role: 'agent_manager',
    entityIds: managerEntityIds,
    sendProvisioningEmail: false
  });
  users.agentManagers.push(manager);

  for (let i = 0; i < 2; i += 1) {
    const seq = agentOffset + i + 1;
    const scopedSubclient = subclients[i % subclients.length];
    const { user: agentUser } = await createUserForTenant({
      tenantId,
      name: `Agent User ${seq}`,
      email: `agentuser${seq}@local.test`,
      password: PASSWORD,
      role: 'agent_user',
      entityIds: [parent._id.toString(), scopedSubclient._id.toString()],
      sendProvisioningEmail: false
    });
    users.agentUsers.push(agentUser);
  }

  const { user: engagementManager } = await createUserForTenant({
    tenantId,
    name: `Engagement Manager ${engagementIndex}`,
    email: `engagement${engagementIndex}@local.test`,
    password: PASSWORD,
    role: 'engagement_manager',
    entityIds: managerEntityIds,
    sendProvisioningEmail: false
  });
  users.engagementManagers.push(engagementManager);

  for (let i = 0; i < subclients.length; i += 1) {
    const seq = clientStartIndex + i + 1;
    const entity = subclients[i];
    const { user: clientUser } = await createUserForTenant({
      tenantId,
      name: `Client User ${seq}`,
      email: `client${seq}@local.test`,
      password: PASSWORD,
      role: 'client',
      entityId: entity._id.toString(),
      sendProvisioningEmail: false
    });
    users.clientUsers.push(clientUser);
  }
}

async function seedTenant({ tenant, preferredTenantId, isSecondary = false }) {
  const tenantId = tenant._id;
  const parents = [];
  const children = [];
  const supportGroups = [];
  const users = {
    superadmins: [],
    approvedUsers: [],
    agentManagers: [],
    agentUsers: [],
    engagementManagers: [],
    clientUsers: []
  };

  const parentCount = isSecondary ? 6 : 25;
  const childPerParent = isSecondary ? 2 : 3;
  const parentPrefix = isSecondary ? 'A' : 'C';
  const childPrefix = isSecondary ? 'B' : 'S';

  for (let i = 1; i <= parentCount; i += 1) {
    const parent = await Entity.create({
      tenantId,
      name: `${tenant.name} Client ${pad(i, 2)}`,
      acronym: acronym(parentPrefix, i),
      type: 'client',
      path: `${tenant.name} Client ${pad(i, 2)}`,
      metadata: {
        region: i % 2 ? 'MEA' : 'APAC',
        product: pick(PRODUCTS, i),
        slaTier: i % 3 === 0 ? 'Silver' : 'Gold'
      }
    });
    parents.push(parent);

    for (let j = 1; j <= childPerParent; j += 1) {
      const childIndex = ((i - 1) * childPerParent) + j;
      const child = await Entity.create({
        tenantId,
        name: `${parent.name} Sub ${j}`,
        acronym: acronym(childPrefix, childIndex),
        type: 'subclient',
        parentId: parent._id,
        path: `${parent.path} / ${parent.name} Sub ${j}`,
        metadata: {
          region: j % 2 ? 'India' : 'UAE',
          product: pick(PRODUCTS, childIndex),
          slaTier: childIndex % 4 === 0 ? 'Platinum' : 'Gold'
        }
      });
      children.push(child);
    }
  }

  const { user: superadmin } = await createUserForTenant({
    tenantId,
    name: `${tenant.name} Superadmin`,
    email: isSecondary ? 'superadmin@acme.test' : 'superadmin@local.test',
    password: PASSWORD,
    role: 'superadmin',
    sendProvisioningEmail: false
  });
  users.superadmins.push(superadmin);

  const tenantApprovedPoolSize = isSecondary ? 24 : 90;
  const generalApprovedEntries = Array.from({ length: tenantApprovedPoolSize }, (_, index) => ({
    name: `${tenant.name} Approved User ${pad(index + 1, 3)}`,
    email: `${tenant.slug}.approved${index + 1}@local.test`
  }));
  const approvedSeedResults = await createApprovedPoolEntries({
    tenantId,
    entries: generalApprovedEntries,
    createdByUserId: superadmin._id
  });
  users.approvedUsers.push(...approvedSeedResults.map((item) => item.approvedUser));

  let agentOffset = 0;
  let clientOffset = 0;
  for (let i = 0; i < parents.length; i += 1) {
    const parent = parents[i];
    const subclients = children.filter((child) => String(child.parentId) === String(parent._id));
    await createSeedUsers({
      tenantId,
      parent,
      subclients,
      managerIndex: i + 1,
      agentOffset,
      engagementIndex: i + 1,
      clientStartIndex: clientOffset,
      users
    });
    agentOffset += 2;
    clientOffset += subclients.length;
  }

  const groupDefs = isSecondary
    ? [
        ['Acme Access Support', 'ACMACC'],
        ['Acme Ops Desk', 'ACMOPS'],
        ['Acme Platform Core', 'ACMPLT']
      ]
    : [
        ['Access Support', 'ACCESS'],
        ['Operations Desk', 'OPS001'],
        ['Payments L2', 'PAY001'],
        ['Platform Core', 'PLATFM'],
        ['Integrations Desk', 'INTGRT']
      ];

  for (let i = 0; i < groupDefs.length; i += 1) {
    const [name, code] = groupDefs[i];
    const group = await SupportGroup.create({
      tenantId,
      name,
      code,
      description: 'Seeded support group',
      defaultAssigneeUserId: users.agentUsers[i % users.agentUsers.length]._id
    });
    supportGroups.push(group);
  }

  await RoutingRule.insertMany([
    { tenantId, name: 'Access tickets', category: 'ACCESS', priority: 'ANY', supportGroupId: supportGroups[0]._id, defaultAssigneeUserId: users.agentUsers[0]._id, rank: 10 },
    { tenantId, name: 'Operations tickets', category: 'OPERATIONS', priority: 'ANY', supportGroupId: supportGroups[1 % supportGroups.length]._id, defaultAssigneeUserId: users.agentUsers[1 % users.agentUsers.length]._id, rank: 20 },
    { tenantId, name: 'Payments critical', category: 'PAYMENTS', priority: 'CRITICAL', supportGroupId: supportGroups[2 % supportGroups.length]._id, defaultAssigneeUserId: users.agentUsers[2 % users.agentUsers.length]._id, rank: 5 },
    { tenantId, name: 'Integration tickets', category: 'INTEGRATION', priority: 'ANY', supportGroupId: supportGroups[supportGroups.length - 1]._id, defaultAssigneeUserId: users.agentUsers[3 % users.agentUsers.length]._id, rank: 15, executionMode: 'JIRA' },
    { tenantId, name: 'General fallback', category: 'GENERAL', priority: 'ANY', supportGroupId: supportGroups[Math.min(3, supportGroups.length - 1)]._id, defaultAssigneeUserId: users.agentUsers[4 % users.agentUsers.length]._id, rank: 100, executionMode: 'NATIVE' }
  ]);

  await SlaPolicy.insertMany([
    { tenantId, name: 'Global Gold Default', category: 'ANY', priority: 'ANY', executionMode: 'ANY', responseTargetMinutes: 60, resolutionTargetMinutes: 480, warningThresholdPercent: 80, rank: 100, isActive: true },
    { tenantId, name: 'Payments Critical Fast Lane', category: 'PAYMENTS', priority: 'CRITICAL', executionMode: 'ANY', responseTargetMinutes: 15, resolutionTargetMinutes: 120, warningThresholdPercent: 70, rank: 5, isActive: true },
    { tenantId, name: 'Integration Jira Flow', category: 'INTEGRATION', priority: 'ANY', executionMode: 'JIRA', responseTargetMinutes: 30, resolutionTargetMinutes: 240, warningThresholdPercent: 75, rank: 20, isActive: true }
  ]);

  const issueTarget = isSecondary ? 180 : 1000;
  const allEntities = [...parents, ...children];
  const issueDocs = [];
  const activityDocs = [];
  const commentDocs = [];
  const counterMap = new Map();

  for (let i = 0; i < issueTarget; i += 1) {
    const entity = children.length ? children[i % children.length] : parents[i % parents.length];
    const parent = entity.parentId ? parents.find((candidate) => String(candidate._id) === String(entity.parentId)) : entity;
    const creator = users.clientUsers[i % users.clientUsers.length];
    const manager = users.agentManagers[i % users.agentManagers.length];
    const assignee = users.agentUsers[i % users.agentUsers.length];
    const supportGroup = supportGroups[i % supportGroups.length];
    const requestType = pick(REQUEST_TYPES, i);
    const status = pick(STATUSES, i);
    const priority = pick(PRIORITIES, i);
    const category = pick(CATEGORIES, i);
    const executionMode = (i % 5 === 0) ? 'JIRA' : 'NATIVE';
    const createdAt = randomishDate(i, isSecondary ? 240 : 420);
    const resolvedAt = ['RESOLVED', 'CLOSED'].includes(status) ? new Date(createdAt.getTime() + ((i % 12) + 4) * 60 * 60 * 1000) : null;
    const updatedAt = resolvedAt || new Date(createdAt.getTime() + ((i % 8) + 1) * 60 * 60 * 1000);
    const currentSequence = (counterMap.get(String(entity._id)) || 1000) + 1;
    counterMap.set(String(entity._id), currentSequence);
    const issueNumber = `${entity.acronym}-${currentSequence}`;
    const issueId = new mongoose.Types.ObjectId();

    issueDocs.push({
      _id: issueId,
      tenantId,
      entityId: entity._id,
      issueNumber,
      title: `${requestType} ${category} issue ${i + 1} for ${entity.name}`,
      description: `Seeded ${requestType.toLowerCase()} issue ${i + 1} for ${entity.path}.`,
      status,
      priority,
      category,
      product: pick(PRODUCTS, i),
      supportGroupId: supportGroup._id,
      routingStatus: 'ROUTED',
      routingDecision: {
        matched: true,
        reason: 'seed-match',
        evaluatedAt: createdAt,
        trace: [{ rule: category, supportGroup: supportGroup.name }]
      },
      createdByUserId: creator._id,
      lastUpdatedByUserId: ['NEW', 'WAITING_FOR_CLIENT'].includes(status) ? manager._id : assignee._id,
      assignedToUserId: ['NEW'].includes(status) ? null : assignee._id,
      assignmentMode: ['NEW'].includes(status) ? 'UNASSIGNED' : (i % 3 === 0 ? 'PULL' : 'PUSH'),
      assignedByUserId: ['NEW'].includes(status) ? null : manager._id,
      reporterType: 'client_user',
      triageStatus: ['NEW'].includes(status) ? 'NOT_TRIAGED' : 'TRIAGED',
      requestType,
      triageNotes: `Seed triage notes for ${issueNumber}`,
      triagedByUserId: ['NEW'].includes(status) ? null : manager._id,
      triagedAt: ['NEW'].includes(status) ? null : new Date(createdAt.getTime() + 20 * 60 * 1000),
      executionMode,
      executionState: executionMode === 'JIRA' ? (i % 7 === 0 ? 'SYNCED' : 'READY_FOR_EXECUTION') : 'READY_FOR_EXECUTION',
      jira: {
        issueKey: executionMode === 'JIRA' && i % 4 === 0 ? `${isSecondary ? 'ACM' : 'SUN'}-${2000 + i}` : '',
        issueId: executionMode === 'JIRA' && i % 4 === 0 ? String(9000 + i) : '',
        issueUrl: '',
        projectKey: executionMode === 'JIRA' ? (isSecondary ? 'ACM' : 'SUN') : '',
        currentStatusName: executionMode === 'JIRA' ? status : '',
        currentStatusCategory: executionMode === 'JIRA' ? (['RESOLVED', 'CLOSED'].includes(status) ? 'done' : 'in-flight') : '',
        statusLastSyncedAt: executionMode === 'JIRA' ? updatedAt : null,
        pushedAt: executionMode === 'JIRA' ? new Date(createdAt.getTime() + 40 * 60 * 1000) : null,
        pushedByUserId: executionMode === 'JIRA' ? manager._id : null,
        pushStatus: executionMode === 'JIRA' ? 'PUSHED' : 'NOT_PUSHED',
        pushErrorMessage: '',
        outboundRequestKey: executionMode === 'JIRA' ? `seed-${issueNumber}` : '',
        outboundState: executionMode === 'JIRA' ? 'COMPLETED' : 'NOT_REQUESTED',
        outboundAttemptedAt: executionMode === 'JIRA' ? new Date(createdAt.getTime() + 35 * 60 * 1000) : null,
        lastWebhookVerifiedAt: executionMode === 'JIRA' ? updatedAt : null
      },
      sla: {
        hasPolicy: true,
        policyName: priority === 'CRITICAL' ? 'Payments Critical Fast Lane' : 'Global Gold Default',
        severity: priority,
        responseTargetMinutes: priority === 'CRITICAL' ? 15 : 60,
        resolutionTargetMinutes: priority === 'CRITICAL' ? 120 : 480,
        responseDueAt: new Date(createdAt.getTime() + (priority === 'CRITICAL' ? 15 : 60) * 60 * 1000),
        resolutionDueAt: new Date(createdAt.getTime() + (priority === 'CRITICAL' ? 120 : 480) * 60 * 1000),
        firstRespondedAt: new Date(createdAt.getTime() + ((i % 6) + 1) * 10 * 60 * 1000),
        respondedByUserId: manager._id,
        resolvedAt,
        responseStatus: i % 9 === 0 ? 'BREACHED' : 'MET',
        resolutionStatus: ['RESOLVED', 'CLOSED'].includes(status) ? (i % 11 === 0 ? 'BREACHED' : 'MET') : 'ON_TRACK',
        pausedAt: status === 'WAITING_FOR_CLIENT' ? updatedAt : null,
        totalPausedMinutes: status === 'WAITING_FOR_CLIENT' ? 180 + (i % 5) * 60 : 0,
        stageStatus: [
          { status: 'NEW', enteredAt: createdAt, exitedAt: new Date(createdAt.getTime() + 20 * 60 * 1000), durationMinutes: 20, countsTowardsSla: true },
          { status: 'UNDER_REVIEW', enteredAt: new Date(createdAt.getTime() + 20 * 60 * 1000), exitedAt: new Date(createdAt.getTime() + 60 * 60 * 1000), durationMinutes: 40, countsTowardsSla: true },
          ...(status === 'WAITING_FOR_CLIENT' ? [{ status: 'WAITING_FOR_CLIENT', enteredAt: new Date(createdAt.getTime() + 60 * 60 * 1000), exitedAt: updatedAt, durationMinutes: Math.round((updatedAt - new Date(createdAt.getTime() + 60 * 60 * 1000)) / 60000), countsTowardsSla: false }] : [])
        ],
        lastEvaluatedAt: updatedAt
      },
      tags: ['seed', requestType.toLowerCase(), category.toLowerCase()],
      source: 'portal',
      createdAt,
      updatedAt
    });

    activityDocs.push({
      tenantId,
      issueId,
      entityId: entity._id,
      type: 'ISSUE_CREATED',
      metadata: { issueNumber },
      performedByUserId: creator._id,
      performedByRole: 'client_user',
      createdAt
    });

    if (!['NEW'].includes(status)) {
      activityDocs.push({
        tenantId,
        issueId,
        entityId: entity._id,
        type: 'ASSIGNED',
        metadata: { after: { assignedToUserId: assignee._id.toString(), assignedByUserId: manager._id.toString(), assignmentMode: i % 3 === 0 ? 'PULL' : 'PUSH' } },
        performedByUserId: manager._id,
        performedByRole: 'agent',
        createdAt: new Date(createdAt.getTime() + 30 * 60 * 1000)
      });
    }

    if (!['NEW', 'UNDER_REVIEW'].includes(status)) {
      activityDocs.push({
        tenantId,
        issueId,
        entityId: entity._id,
        type: 'STATUS_CHANGED',
        metadata: { before: { status: 'UNDER_REVIEW' }, after: { status } },
        performedByUserId: assignee._id,
        performedByRole: 'agent',
        createdAt: updatedAt
      });
    }

    if (i % 2 === 0) {
      commentDocs.push({
        tenantId,
        issueId,
        entityId: entity._id,
        commentText: `Client follow-up for ${issueNumber}`,
        authorUserId: creator._id,
        authorRole: 'client_user',
        visibility: 'EXTERNAL',
        attachments: [],
        createdAt: new Date(createdAt.getTime() + 90 * 60 * 1000),
        updatedAt: new Date(createdAt.getTime() + 90 * 60 * 1000)
      });
    }

    if (i % 3 === 0) {
      commentDocs.push({
        tenantId,
        issueId,
        entityId: entity._id,
        commentText: `Internal note from delivery for ${issueNumber}`,
        authorUserId: assignee._id,
        authorRole: 'agent',
        visibility: 'INTERNAL',
        attachments: [],
        createdAt: new Date(createdAt.getTime() + 120 * 60 * 1000),
        updatedAt: new Date(createdAt.getTime() + 120 * 60 * 1000)
      });
    }
  }

  await Issue.insertMany(issueDocs, { ordered: false });
  if (commentDocs.length) await IssueComment.insertMany(commentDocs, { ordered: false });
  if (activityDocs.length) await IssueActivity.insertMany(activityDocs, { ordered: false });

  const counterDocs = allEntities.map((entity) => ({
    tenantId,
    entityId: entity._id,
    acronym: entity.acronym,
    sequence: counterMap.get(String(entity._id)) || 1000
  }));
  await IssueCounter.insertMany(counterDocs, { ordered: false });

  return {
    parents,
    children,
    supportGroups,
    users,
    issueCount: issueDocs.length,
    commentCount: commentDocs.length,
    activityCount: activityDocs.length
  };
}

async function run() {
  await connectDb();

  const preferredTenantId = new mongoose.Types.ObjectId('64a000000000000000000001');
  const preferredTenantBId = new mongoose.Types.ObjectId('64a000000000000000000002');
  const primarySlug = process.env.TENANT_SLUG || 'suntec';

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
    ApprovedUser.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
    SupportGroup.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
    RoutingRule.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
    SlaPolicy.deleteMany({ tenantId: { $in: cleanupTenantIds } }),
    Tenant.deleteMany({ slug: { $in: [primarySlug, 'acme'] } })
  ]);

  const tenant = await Tenant.create({ _id: preferredTenantId, name: process.env.TENANT_NAME || 'SunTec', slug: primarySlug, status: 'active' });
  const tenantB = await Tenant.create({ _id: preferredTenantBId, name: 'Acme', slug: 'acme', status: 'active' });

  const primary = await seedTenant({ tenant, preferredTenantId });
  const secondary = await seedTenant({ tenant: tenantB, preferredTenantId: preferredTenantBId, isSecondary: true });

  console.log('Seed complete.');
  console.log(`Database: ${process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/esop_v11'}`);
  console.log('SunTec summary:');
  console.log(`- Clients: ${primary.parents.length}`);
  console.log(`- Subclients: ${primary.children.length}`);
  console.log(`- Approved pool users: ${primary.users.approvedUsers.length + primary.users.agentManagers.length + primary.users.agentUsers.length}`);
  console.log(`- Agent managers: ${primary.users.agentManagers.length}`);
  console.log(`- Agent users: ${primary.users.agentUsers.length}`);
  console.log(`- Engagement managers: ${primary.users.engagementManagers.length}`);
  console.log(`- Client users: ${primary.users.clientUsers.length}`);
  console.log(`- Issues: ${primary.issueCount}`);
  console.log(`- Comments: ${primary.commentCount}`);
  console.log(`- Activities: ${primary.activityCount}`);
  console.log('Acme summary:');
  console.log(`- Clients: ${secondary.parents.length}`);
  console.log(`- Subclients: ${secondary.children.length}`);
  console.log(`- Approved pool users: ${secondary.users.approvedUsers.length + secondary.users.agentManagers.length + secondary.users.agentUsers.length}`);
  console.log(`- Agent managers: ${secondary.users.agentManagers.length}`);
  console.log(`- Agent users: ${secondary.users.agentUsers.length}`);
  console.log(`- Engagement managers: ${secondary.users.engagementManagers.length}`);
  console.log(`- Client users: ${secondary.users.clientUsers.length}`);
  console.log(`- Issues: ${secondary.issueCount}`);
  console.log('Login samples:');
  console.log(`- /${tenant.slug}/login -> superadmin@local.test / ${PASSWORD}`);
  console.log(`- /${tenant.slug}/login -> agentmanager1@local.test / ${PASSWORD}`);
  console.log(`- /${tenant.slug}/login -> agentuser1@local.test / ${PASSWORD}`);
  console.log(`- /${tenant.slug}/login -> engagement1@local.test / ${PASSWORD}`);
  console.log(`- /${tenant.slug}/login -> client1@local.test / ${PASSWORD}`);
  console.log(`- /${tenantB.slug}/login -> superadmin@acme.test / ${PASSWORD}`);
  console.log(`- /${tenantB.slug}/login -> agentmanager1@local.test / ${PASSWORD} (tenant-specific email is separate only if tenant differs)`);

  await mongoose.connection.close();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
