const { Issue } = require('../issues/issue.model');
const { IssueComment } = require('../issues/issue-comment.model');
const { Entity } = require('../entities/entity.model');
const { getAccessibleEntityIdsForUser } = require('../../utils/access');
const { getPagination, buildPager, buildQueryString } = require('../../utils/pagination');
const { getIndicator } = require('../sla/sla.service');
const { getUploadUiConfig } = require('../../config/uploads');
const { WorkflowConfig } = require('../workflows/workflow.model');
const { getClientStatusPresentation } = require('../workflows/workflow-visibility.service');

async function getClientBaseFilter(req) {
  const entityIds = await getAccessibleEntityIdsForUser(req.currentUser);
  return {
    tenantId: req.tenant._id,
    $and: [
      {
        $or: [
          ...(entityIds.length ? [{ entityId: { $in: entityIds } }] : []),
          { createdByUserId: req.currentUser._id }
        ]
      },
      {
        $or: [
          { customerVisibility: 'VISIBLE_TO_CUSTOMER' },
          { customerVisibility: { $exists: false } },
          { customerVisibility: null },
          { customerVisibility: '' }
        ]
      }
    ]
  };
}

async function getWorkflowMapForIssues(tenantId, issues = []) {
  const issueTypes = Array.from(new Set((issues || []).map((issue) => String(issue.requestType || 'BUG').toUpperCase())));
  const workflows = await WorkflowConfig.find({ tenantId, issueType: { $in: issueTypes } }).lean();
  return new Map(workflows.map((item) => [String(item.issueType || '').toUpperCase(), item]));
}

function decorateIssueForClient(issue, workflowMap = new Map()) {
  const workflow = workflowMap.get(String(issue.requestType || 'BUG').toUpperCase()) || null;
  const presentation = getClientStatusPresentation(workflow, issue.status);
  issue.customerStatusLabel = presentation.clientLabel;
  issue.clientStatusBucket = presentation.clientBucket;
  issue.clientVisibleStatus = presentation.clientBucket;
  issue.isWaitingForClient = presentation.clientBucket === 'WAITING_FOR_CLIENT';
  return issue;
}

async function clientDashboard(req, res, next) {
  try {
    const baseFilter = await getClientBaseFilter(req);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const focusThreshold = new Date(Date.now() - (3 * 24 * 60 * 60 * 1000));
    const accessibleEntityIds = await getAccessibleEntityIdsForUser(req.currentUser);

    const [
      myOpenIssues,
      waitingForMe,
      resolvedRecently,
      updatedToday,
      slaBreached,
      reopenedIssues,
      inProgress,
      staleOpen,
      entitiesInScope,
      recentIssues
    ] = await Promise.all([
      Issue.countDocuments({ ...baseFilter, status: { $in: ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_CLIENT'] } }),
      Issue.countDocuments({ ...baseFilter, status: 'WAITING_FOR_CLIENT' }),
      Issue.countDocuments({ ...baseFilter, status: { $in: ['RESOLVED', 'CLOSED', 'READY_TO_CLOSE'] } }),
      Issue.countDocuments({ ...baseFilter, updatedAt: { $gte: today } }),
      Issue.countDocuments({ ...baseFilter, 'sla.resolutionStatus': 'BREACHED' }),
      Issue.countDocuments({ ...baseFilter, status: 'REOPENED' }),
      Issue.countDocuments({ ...baseFilter, status: 'IN_PROGRESS' }),
      Issue.countDocuments({ ...baseFilter, status: { $in: ['NEW', 'OPEN', 'IN_PROGRESS'] }, updatedAt: { $lt: focusThreshold } }),
      Entity.countDocuments({ tenantId: req.tenant._id, _id: { $in: accessibleEntityIds }, isActive: true }),
      Issue.find(baseFilter).populate('entityId assignedToUserId').sort({ updatedAt: -1 }).limit(10).lean()
    ]);
    const scopedEntities = accessibleEntityIds.length
      ? await Entity.find({ tenantId: req.tenant._id, _id: { $in: accessibleEntityIds }, isActive: true }).select('name path acronym type').sort({ path: 1 }).lean()
      : [];

    const workflowMap = await getWorkflowMapForIssues(req.tenant._id, recentIssues);
    recentIssues.forEach((issue) => {
      decorateIssueForClient(issue, workflowMap);
      issue.isRecentlyUpdated = issue.updatedAt && new Date(issue.updatedAt) >= today;
      if (issue.sla) {
        issue.sla.responseStatus = getIndicator({ dueAt: issue.sla.responseDueAt, completedAt: issue.sla.firstRespondedAt, warningThresholdPercent: issue.sla.warningThresholdPercent, startedAt: issue.createdAt });
        issue.sla.resolutionStatus = getIndicator({ dueAt: issue.sla.resolutionDueAt, completedAt: issue.sla.resolvedAt, warningThresholdPercent: issue.sla.warningThresholdPercent, startedAt: issue.createdAt });
      }
    });

    return res.render('client-portal/dashboard', {
      title: 'Client Dashboard',
      stats: {
        myOpenIssues,
        waitingForMe,
        resolvedRecently,
        updatedToday,
        slaBreached,
        reopenedIssues,
        healthScore: Math.max(0, 100 - (slaBreached * 12) - (reopenedIssues * 6) - Math.max(0, staleOpen * 2)),
        inProgress,
        staleOpen,
        entitiesInScope
      },
      recentIssues,
      scopedEntities
    });
  } catch (error) { return next(error); }
}

async function listClientIssues(req, res, next) {
  try {
    const baseFilter = await getClientBaseFilter(req);
    const filters = { q: String(req.query.q || '').trim(), status: String(req.query.status || ''), entityId: String(req.query.entityId || '') };
    const filter = { ...baseFilter };
    if (filters.status) {
      if (filters.status === 'OPEN_ONLY') filter.status = { $in: ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_CLIENT'] };
      else filter.status = filters.status;
    }
    if (filters.entityId) filter.entityId = filters.entityId;
    if (filters.q) {
      const q = filters.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [{ issueNumber: new RegExp(`^${q}`, 'i') }, { title: new RegExp(q, 'i') }, { description: new RegExp(q, 'i') }];
    }
    const allowedIds = (baseFilter.entityId && baseFilter.entityId.$in) || [];
    const entities = await Entity.find({ tenantId: req.tenant._id, _id: { $in: allowedIds }, isActive: true }).sort({ path: 1 }).lean();
    const { page, pageSize, skip } = getPagination(req.query, 10);
    const [totalItems, issues] = await Promise.all([
      Issue.countDocuments(filter),
      Issue.find(filter).populate('entityId assignedToUserId').sort({ updatedAt: -1 }).skip(skip).limit(pageSize).lean()
    ]);
    const workflowMap = await getWorkflowMapForIssues(req.tenant._id, issues);
    issues.forEach((issue) => {
      decorateIssueForClient(issue, workflowMap);
    });
    return res.render('client-portal/issues', { title: 'My Issues', issues, entities, filters, pager: buildPager({ totalItems, page, pageSize }), buildQueryString });
  } catch (error) { return next(error); }
}

async function viewClientIssue(req, res, next) {
  try {
    const baseFilter = await getClientBaseFilter(req);
    const issue = await Issue.findOne({ _id: req.params.id, ...baseFilter }).populate('entityId assignedToUserId createdByUserId lastUpdatedByUserId').lean();
    if (!issue) {
      req.session.error = 'Issue not found.';
      return res.redirect(`${req.basePath}/client/issues`);
    }
    const comments = await IssueComment.find({ tenantId: req.tenant._id, issueId: issue._id, visibility: 'EXTERNAL' }).populate('authorUserId', 'name').sort({ createdAt: 1 }).lean();
    const workflowMap = await getWorkflowMapForIssues(req.tenant._id, [issue]);
    decorateIssueForClient(issue, workflowMap);
    return res.render('client-portal/detail', { title: `${issue.issueNumber} · ${issue.title}`, issue, comments, uploadLimits: getUploadUiConfig() });
  } catch (error) { return next(error); }
}

module.exports = { clientDashboard, listClientIssues, viewClientIssue };
