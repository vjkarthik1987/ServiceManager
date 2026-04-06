const { Issue } = require('../issues/issue.model');
const { IssueComment } = require('../issues/issue-comment.model');
const { Entity } = require('../entities/entity.model');
const { getAccessibleEntityIdsForUser } = require('../../utils/access');
const { getPagination, buildPager, buildQueryString } = require('../../utils/pagination');
const { getIndicator } = require('../sla/sla.service');
const { getUploadUiConfig } = require('../../config/uploads');

async function getClientBaseFilter(req) {
  const entityIds = await getAccessibleEntityIdsForUser(req.currentUser);
  return {
    tenantId: req.tenant._id,
    entityId: { $in: entityIds.length ? entityIds : [] },
    customerVisibility: 'VISIBLE_TO_CUSTOMER'
  };
}

function mapCustomerStatusLabel(status) {
  if (status === 'WAITING_FOR_CLIENT') return 'Waiting for your input';
  if (status === 'IN_PROGRESS') return 'We are working on it';
  if (status === 'READY_TO_CLOSE') return 'Closed for Review';
  return status;
}

async function clientDashboard(req, res, next) {
  try {
    const baseFilter = await getClientBaseFilter(req);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const focusThreshold = new Date(Date.now() - (3 * 24 * 60 * 60 * 1000));
    const accessibleEntityIds = (baseFilter.entityId && baseFilter.entityId.$in) || [];

    const [
      myOpenIssues,
      waitingForMe,
      resolvedRecently,
      updatedToday,
      inProgress,
      staleOpen,
      entitiesInScope,
      recentIssues
    ] = await Promise.all([
      Issue.countDocuments({ ...baseFilter, status: { $in: ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_CLIENT'] } }),
      Issue.countDocuments({ ...baseFilter, status: 'WAITING_FOR_CLIENT' }),
      Issue.countDocuments({ ...baseFilter, status: { $in: ['RESOLVED', 'CLOSED', 'READY_TO_CLOSE'] } }),
      Issue.countDocuments({ ...baseFilter, updatedAt: { $gte: today } }),
      Issue.countDocuments({ ...baseFilter, status: 'IN_PROGRESS' }),
      Issue.countDocuments({ ...baseFilter, status: { $in: ['NEW', 'OPEN', 'IN_PROGRESS'] }, updatedAt: { $lt: focusThreshold } }),
      Entity.countDocuments({ tenantId: req.tenant._id, _id: { $in: accessibleEntityIds }, isActive: true }),
      Issue.find(baseFilter).populate('entityId assignedToUserId').sort({ updatedAt: -1 }).limit(10).lean()
    ]);

    recentIssues.forEach((issue) => {
      issue.customerStatusLabel = mapCustomerStatusLabel(issue.status);
      issue.isWaitingForClient = issue.status === 'WAITING_FOR_CLIENT';
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
        inProgress,
        staleOpen,
        entitiesInScope
      },
      recentIssues
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
    issues.forEach((issue) => {
      issue.customerStatusLabel = mapCustomerStatusLabel(issue.status);
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
    issue.customerStatusLabel = mapCustomerStatusLabel(issue.status);
    return res.render('client-portal/detail', { title: `${issue.issueNumber} · ${issue.title}`, issue, comments, uploadLimits: getUploadUiConfig() });
  } catch (error) { return next(error); }
}

module.exports = { clientDashboard, listClientIssues, viewClientIssue };
