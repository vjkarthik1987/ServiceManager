const router = require('express').Router({ mergeParams: true });
const { WorkflowConfig, WORKFLOW_ISSUE_TYPES } = require('./workflow.model');
const { logAudit } = require('../audit/audit.service');
const { getDefaultClientStatusMeta, normalizeBoolean, normalizeStatusKey, getClientStatusPresentation } = require('./workflow-visibility.service');

const DEFAULT_WORKFLOW_PRESETS = {
  BUG: {
    name: 'Bug workflow',
    statusDefinitions: [
      { statusKey: 'NEW', clientVisible: true, clientBucket: 'NEW', clientLabel: 'Submitted' },
      { statusKey: 'GIVEN_FOR_DEVELOPMENT', clientVisible: false, clientBucket: 'IN_PROGRESS', clientLabel: 'We are working on it' },
      { statusKey: 'IN_PROGRESS', clientVisible: true, clientBucket: 'IN_PROGRESS', clientLabel: 'We are working on it' },
      { statusKey: 'TESTING_DONE', clientVisible: false, clientBucket: 'IN_PROGRESS', clientLabel: 'We are working on it' },
      { statusKey: 'WAITING_FOR_CLIENT', clientVisible: true, clientBucket: 'WAITING_FOR_CLIENT', clientLabel: 'Waiting for your input' },
      { statusKey: 'RESOLVED', clientVisible: true, clientBucket: 'RESOLVED', clientLabel: 'Resolved' },
      { statusKey: 'CLOSED', clientVisible: true, clientBucket: 'CLOSED', clientLabel: 'Closed' }
    ],
    transitions: [
      { fromStatus: 'NEW', toStatus: 'GIVEN_FOR_DEVELOPMENT', rolesAllowed: ['agent', 'superadmin'], requiresApproval: false },
      { fromStatus: 'GIVEN_FOR_DEVELOPMENT', toStatus: 'IN_PROGRESS', rolesAllowed: ['agent', 'superadmin'], requiresApproval: false },
      { fromStatus: 'IN_PROGRESS', toStatus: 'TESTING_DONE', rolesAllowed: ['agent', 'superadmin'], requiresApproval: false },
      { fromStatus: 'TESTING_DONE', toStatus: 'WAITING_FOR_CLIENT', rolesAllowed: ['agent', 'superadmin'], requiresApproval: false },
      { fromStatus: 'WAITING_FOR_CLIENT', toStatus: 'IN_PROGRESS', rolesAllowed: ['client', 'agent', 'superadmin'], requiresApproval: false },
      { fromStatus: 'TESTING_DONE', toStatus: 'RESOLVED', rolesAllowed: ['agent', 'superadmin'], requiresApproval: false },
      { fromStatus: 'RESOLVED', toStatus: 'CLOSED', rolesAllowed: ['superadmin'], requiresApproval: false }
    ]
  },
  CR: {
    name: 'CR workflow',
    statusDefinitions: [
      { statusKey: 'NEW', clientVisible: true, clientBucket: 'NEW', clientLabel: 'Submitted' },
      { statusKey: 'UNDER_REVIEW', clientVisible: false, clientBucket: 'NEW', clientLabel: 'Submitted' },
      { statusKey: 'APPROVED', clientVisible: false, clientBucket: 'IN_PROGRESS', clientLabel: 'We are working on it' },
      { statusKey: 'GIVEN_FOR_DEVELOPMENT', clientVisible: false, clientBucket: 'IN_PROGRESS', clientLabel: 'We are working on it' },
      { statusKey: 'IN_PROGRESS', clientVisible: true, clientBucket: 'IN_PROGRESS', clientLabel: 'We are working on it' },
      { statusKey: 'UAT', clientVisible: false, clientBucket: 'IN_PROGRESS', clientLabel: 'We are working on it' },
      { statusKey: 'WAITING_FOR_CLIENT', clientVisible: true, clientBucket: 'WAITING_FOR_CLIENT', clientLabel: 'Waiting for your input' },
      { statusKey: 'RESOLVED', clientVisible: true, clientBucket: 'RESOLVED', clientLabel: 'Resolved' },
      { statusKey: 'CLOSED', clientVisible: true, clientBucket: 'CLOSED', clientLabel: 'Closed' }
    ],
    transitions: [
      { fromStatus: 'NEW', toStatus: 'UNDER_REVIEW', rolesAllowed: ['agent', 'superadmin'], requiresApproval: false },
      { fromStatus: 'UNDER_REVIEW', toStatus: 'APPROVED', rolesAllowed: ['superadmin'], requiresApproval: false },
      { fromStatus: 'APPROVED', toStatus: 'GIVEN_FOR_DEVELOPMENT', rolesAllowed: ['agent', 'superadmin'], requiresApproval: false },
      { fromStatus: 'GIVEN_FOR_DEVELOPMENT', toStatus: 'IN_PROGRESS', rolesAllowed: ['agent', 'superadmin'], requiresApproval: false },
      { fromStatus: 'IN_PROGRESS', toStatus: 'UAT', rolesAllowed: ['agent', 'superadmin'], requiresApproval: false },
      { fromStatus: 'UAT', toStatus: 'WAITING_FOR_CLIENT', rolesAllowed: ['agent', 'superadmin'], requiresApproval: false },
      { fromStatus: 'WAITING_FOR_CLIENT', toStatus: 'IN_PROGRESS', rolesAllowed: ['client', 'agent', 'superadmin'], requiresApproval: false },
      { fromStatus: 'UAT', toStatus: 'RESOLVED', rolesAllowed: ['agent', 'superadmin'], requiresApproval: false },
      { fromStatus: 'RESOLVED', toStatus: 'CLOSED', rolesAllowed: ['superadmin'], requiresApproval: false }
    ]
  },
  QUERY: {
    name: 'Query workflow',
    statusDefinitions: [
      { statusKey: 'NEW', clientVisible: true, clientBucket: 'NEW', clientLabel: 'Submitted' },
      { statusKey: 'UNDER_REVIEW', clientVisible: false, clientBucket: 'NEW', clientLabel: 'Submitted' },
      { statusKey: 'IN_PROGRESS', clientVisible: true, clientBucket: 'IN_PROGRESS', clientLabel: 'We are working on it' },
      { statusKey: 'WAITING_FOR_CLIENT', clientVisible: true, clientBucket: 'WAITING_FOR_CLIENT', clientLabel: 'Waiting for your input' },
      { statusKey: 'ANSWERED', clientVisible: false, clientBucket: 'RESOLVED', clientLabel: 'Resolved' },
      { statusKey: 'RESOLVED', clientVisible: true, clientBucket: 'RESOLVED', clientLabel: 'Resolved' },
      { statusKey: 'CLOSED', clientVisible: true, clientBucket: 'CLOSED', clientLabel: 'Closed' }
    ],
    transitions: [
      { fromStatus: 'NEW', toStatus: 'UNDER_REVIEW', rolesAllowed: ['agent', 'superadmin'], requiresApproval: false },
      { fromStatus: 'UNDER_REVIEW', toStatus: 'IN_PROGRESS', rolesAllowed: ['agent', 'superadmin'], requiresApproval: false },
      { fromStatus: 'IN_PROGRESS', toStatus: 'WAITING_FOR_CLIENT', rolesAllowed: ['agent', 'superadmin'], requiresApproval: false },
      { fromStatus: 'WAITING_FOR_CLIENT', toStatus: 'IN_PROGRESS', rolesAllowed: ['client', 'agent', 'superadmin'], requiresApproval: false },
      { fromStatus: 'IN_PROGRESS', toStatus: 'ANSWERED', rolesAllowed: ['agent', 'superadmin'], requiresApproval: false },
      { fromStatus: 'ANSWERED', toStatus: 'RESOLVED', rolesAllowed: ['agent', 'superadmin'], requiresApproval: false },
      { fromStatus: 'RESOLVED', toStatus: 'CLOSED', rolesAllowed: ['agent', 'superadmin'], requiresApproval: false }
    ]
  }
};

function toTransitionLines(items = []) {
  return items.map((t) => [t.fromStatus, t.toStatus, (t.rolesAllowed || []).join(','), t.requiresApproval ? 'true' : 'false'].join('|')).join('\n');
}

function toStatusDefinitionLines(items = []) {
  return items.map((item) => [item.statusKey, item.clientVisible ? 'true' : 'false', item.clientBucket || '', item.clientLabel || ''].join('|')).join('\n');
}

function normalizeTransitions(raw = '') {
  return String(raw || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [fromStatus, toStatus, roles, requiresApproval] = line.split('|').map((v) => String(v || '').trim());
      return {
        fromStatus: normalizeStatusKey(fromStatus),
        toStatus: normalizeStatusKey(toStatus),
        rolesAllowed: String(roles || '').split(',').map((v) => v.trim()).filter(Boolean),
        requiresApproval: requiresApproval === 'true'
      };
    })
    .filter((item) => item.fromStatus && item.toStatus);
}

function normalizeStatusDefinitions(raw = '', fallbackStatuses = []) {
  const lines = String(raw || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const definitions = lines.map((line) => {
    const [statusKeyRaw, clientVisibleRaw, clientBucketRaw, clientLabelRaw] = line.split('|').map((v) => String(v || '').trim());
    const statusKey = normalizeStatusKey(statusKeyRaw);
    if (!statusKey) return null;
    const fallback = getDefaultClientStatusMeta(statusKey);
    return {
      statusKey,
      clientVisible: normalizeBoolean(clientVisibleRaw, fallback.clientVisible),
      clientBucket: normalizeStatusKey(clientBucketRaw || fallback.clientBucket),
      clientLabel: String(clientLabelRaw || fallback.clientLabel || '').trim() || fallback.clientLabel
    };
  }).filter(Boolean);

  const byKey = new Map(definitions.map((item) => [item.statusKey, item]));
  (fallbackStatuses || []).forEach((statusKey) => {
    const key = normalizeStatusKey(statusKey);
    if (!key || byKey.has(key)) return;
    byKey.set(key, getDefaultClientStatusMeta(key));
  });
  return Array.from(byKey.values());
}

router.get('/', async (req, res, next) => {
  try {
    const existing = await WorkflowConfig.find({ tenantId: req.tenant._id }).lean();
    const byType = new Map(existing.map((item) => [item.issueType, item]));
    const workflows = WORKFLOW_ISSUE_TYPES.map((issueType) => {
      const preset = DEFAULT_WORKFLOW_PRESETS[issueType];
      const current = byType.get(issueType) || {};
      const defs = (current.statusDefinitions && current.statusDefinitions.length ? current.statusDefinitions : preset.statusDefinitions);
      return {
        issueType,
        name: current.name || preset.name,
        statuses: toStatusDefinitionLines(defs),
        transitions: toTransitionLines((current.transitions || preset.transitions)),
        preview: defs.map((item) => getClientStatusPresentation({ statusDefinitions: defs }, item.statusKey)),
        approvalEnabled: !!current.approvalEnabled
      };
    });
    res.render('workflows/index', { title: 'Workflow Governance', workflows });
  } catch (e) {
    next(e);
  }
});

router.post('/', async (req, res, next) => {
  try {
    for (const issueType of WORKFLOW_ISSUE_TYPES) {
      const before = await WorkflowConfig.findOne({ tenantId: req.tenant._id, issueType }).lean();
      const transitions = normalizeTransitions(req.body[`transitions_${issueType}`]);
      const statuses = Array.from(new Set(transitions.flatMap((item) => [item.fromStatus, item.toStatus]).filter(Boolean)));
      const statusDefinitions = normalizeStatusDefinitions(req.body[`statuses_${issueType}`], statuses);
      const workflow = await WorkflowConfig.findOneAndUpdate(
        { tenantId: req.tenant._id, issueType },
        {
          $set: {
            issueType,
            name: req.body[`name_${issueType}`] || `${issueType} workflow`,
            statuses: statusDefinitions.map((item) => item.statusKey),
            statusDefinitions,
            transitions,
            fieldPermissions: [],
            approvalEnabled: req.body[`approvalEnabled_${issueType}`] === 'true'
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
      await logAudit({
        tenantId: req.tenant._id,
        actorUserId: req.currentUser._id,
        action: 'workflow.updated',
        entityType: 'workflow',
        entityId: workflow._id,
        before,
        after: {
          issueType,
          name: workflow.name,
          statuses: workflow.statuses,
          statusDefinitions: workflow.statusDefinitions,
          transitionsCount: workflow.transitions.length,
          approvalEnabled: workflow.approvalEnabled
        }
      });
    }

    req.session.success = 'Workflow configuration saved.';
    res.redirect(`${req.basePath}/admin/workflows`);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
