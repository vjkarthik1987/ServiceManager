
const mongoose = require('mongoose');
const { Issue } = require('../issues/issue.model');
const { SavedView } = require('../saved-views/saved-view.model');
const { Entity } = require('../entities/entity.model');
const { User } = require('../users/user.model');
const { getAccessibleEntityIdsForUser } = require('../../utils/access');

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function getBaseFilter(req) {
  const filter = { tenantId: req.tenant._id };
  if (req.currentUser.role !== 'superadmin') {
    const entityIds = await getAccessibleEntityIdsForUser(req.currentUser);
    filter.entityId = { $in: entityIds.length ? entityIds : [] };
  }
  return filter;
}

async function getWorkspaceCounts(req, baseFilter = null) {
  const filter = baseFilter || await getBaseFilter(req);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const myOpenFilter = { ...filter, assignedToUserId: req.currentUser._id, status: { $nin: ['RESOLVED', 'CLOSED'] } };
  const unassignedFilter = { ...filter, assignedToUserId: null, status: { $nin: ['RESOLVED', 'CLOSED'] } };
  const triageFilter = { ...filter, triageStatus: 'IN_TRIAGE' };
  const waitingClientFilter = { ...filter, status: 'WAITING_FOR_CLIENT' };
  const jiraPendingFilter = { ...filter, executionMode: 'JIRA', executionState: { $in: ['READY_FOR_EXECUTION', 'FAILED', 'NOT_STARTED'] } };
  const breachedOrRiskFilter = { ...filter, $or: [{ 'sla.responseStatus': { $in: ['BREACHED', 'AT_RISK'] } }, { 'sla.resolutionStatus': { $in: ['BREACHED', 'AT_RISK'] } }] };
  const breachedOnlyFilter = { ...filter, $or: [{ 'sla.responseStatus': 'BREACHED' }, { 'sla.resolutionStatus': 'BREACHED' }] };
  const updatedTodayFilter = { ...filter, updatedAt: { $gte: today } };

  const [myOpenIssues, unassigned, inTriage, waitingForClient, jiraPending, breachedOrRiskSla, breachedOnly, updatedToday, allAccessibleIssues] = await Promise.all([
    Issue.countDocuments(myOpenFilter),
    Issue.countDocuments(unassignedFilter),
    Issue.countDocuments(triageFilter),
    Issue.countDocuments(waitingClientFilter),
    Issue.countDocuments(jiraPendingFilter),
    Issue.countDocuments(breachedOrRiskFilter),
    Issue.countDocuments(breachedOnlyFilter),
    Issue.countDocuments(updatedTodayFilter),
    Issue.countDocuments(filter)
  ]);

  return {
    myOpenIssues,
    unassigned,
    inTriage,
    waitingForClient,
    jiraPending,
    breachedOrRiskSla,
    breachedOnly,
    updatedToday,
    allAccessibleIssues
  };
}

function applyQueueFilter(filter, queue, userId) {
  if (!queue) return filter;
  switch (queue) {
    case 'MY_OPEN':
      filter.assignedToUserId = userId;
      filter.status = { $nin: ['RESOLVED', 'CLOSED'] };
      break;
    case 'UNASSIGNED':
      filter.assignedToUserId = null;
      filter.status = { $nin: ['RESOLVED', 'CLOSED'] };
      break;
    case 'IN_TRIAGE':
      filter.triageStatus = 'IN_TRIAGE';
      break;
    case 'WAITING_FOR_CLIENT':
      filter.status = 'WAITING_FOR_CLIENT';
      break;
    case 'JIRA_PENDING':
      filter.executionMode = 'JIRA';
      filter.executionState = { $in: ['READY_FOR_EXECUTION', 'FAILED', 'NOT_STARTED'] };
      break;
    case 'BREACHED_AT_RISK':
      filter.$or = [{ 'sla.responseStatus': { $in: ['BREACHED', 'AT_RISK'] } }, { 'sla.resolutionStatus': { $in: ['BREACHED', 'AT_RISK'] } }];
      break;
    case 'RECENTLY_UPDATED':
      break;
    case 'ALL':
    default:
      break;
  }
  return filter;
}

async function buildWorkspaceFilter(req) {
  const filter = await getBaseFilter(req);
  const query = { ...(req.query || {}) };

  let savedView = null;
  if (query.savedViewId && mongoose.Types.ObjectId.isValid(query.savedViewId)) {
    savedView = await SavedView.findOne({ _id: query.savedViewId, tenantId: req.tenant._id, userId: req.currentUser._id }).lean();
  }
  const source = savedView?.filters ? { ...savedView.filters, ...query } : query;

  applyQueueFilter(filter, source.queue, req.currentUser._id);

  if (source.entityId) filter.entityId = source.entityId;
  if (source.status) filter.status = source.status;
  if (source.priority) filter.priority = source.priority;
  if (source.triageStatus) filter.triageStatus = source.triageStatus;
  if (source.assignedToUserId) filter.assignedToUserId = source.assignedToUserId;
  if (source.createdByUserId) filter.createdByUserId = source.createdByUserId;
  if (source.executionMode) filter.executionMode = source.executionMode;
  if (source.routingStatus) filter.routingStatus = source.routingStatus;
  if (source.supportGroupId) filter.supportGroupId = source.supportGroupId;
  if (source.slaStatus) {
    filter.$or = [{ 'sla.responseStatus': source.slaStatus }, { 'sla.resolutionStatus': source.slaStatus }];
  }

  const q = String(source.q || '').trim();
  if (q) {
    const startsWithRegex = new RegExp(`^${escapeRegex(q)}`, 'i');
    const containsRegex = new RegExp(escapeRegex(q), 'i');
    const textFilter = [{ issueNumber: startsWithRegex }, { title: containsRegex }, { description: containsRegex }, { tags: containsRegex }];
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, { $or: textFilter }];
      delete filter.$or;
    } else {
      filter.$or = textFilter;
    }
  }

  return { filter, appliedFilters: {
    q: source.q || '',
    entityId: source.entityId || '',
    status: source.status || '',
    priority: source.priority || '',
    triageStatus: source.triageStatus || '',
    assignedToUserId: source.assignedToUserId || '',
    createdByUserId: source.createdByUserId || '',
    executionMode: source.executionMode || '',
    routingStatus: source.routingStatus || '',
    supportGroupId: source.supportGroupId || '',
    slaStatus: source.slaStatus || '',
    queue: source.queue || 'MY_OPEN',
    savedViewId: source.savedViewId || ''
  }, savedView };
}

function getSort(sortValue = '-updatedAt') {
  const whitelist = {
    issueNumber: { issueNumber: 1 },
    '-issueNumber': { issueNumber: -1 },
    title: { title: 1 },
    '-title': { title: -1 },
    status: { status: 1, updatedAt: -1 },
    '-status': { status: -1, updatedAt: -1 },
    priority: { priority: -1, updatedAt: -1 },
    '-priority': { priority: 1, updatedAt: -1 },
    updatedAt: { updatedAt: 1 },
    '-updatedAt': { updatedAt: -1 },
    triageStatus: { triageStatus: 1, updatedAt: -1 },
    '-triageStatus': { triageStatus: -1, updatedAt: -1 }
  };
  return whitelist[sortValue] || { updatedAt: -1 };
}

async function listWorkspaceIssues(req) {
  const { filter, appliedFilters, savedView } = await buildWorkspaceFilter(req);
  const page = Math.max(1, Number(req.query.page || 1));
  const limit = Math.min(100, Math.max(10, Number(req.query.limit || 20)));
  const sort = getSort(req.query.sort || '-updatedAt');

  const [items, total, entities, agents, savedViews, counts] = await Promise.all([
    Issue.find(filter)
      .populate('entityId assignedToUserId createdByUserId supportGroupId')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Issue.countDocuments(filter),
    Entity.find({ tenantId: req.tenant._id, isActive: true }).select('_id name path').sort({ path: 1 }).lean(),
    User.find({ tenantId: req.tenant._id, role: 'agent', isActive: true }).select('_id name email').sort({ name: 1 }).lean(),
    SavedView.find({ tenantId: req.tenant._id, userId: req.currentUser._id }).sort({ isDefault: -1, name: 1 }).lean(),
    getWorkspaceCounts(req)
  ]);

  return {
    items,
    total,
    page,
    limit,
    pages: Math.max(1, Math.ceil(total / limit)),
    filters: appliedFilters,
    sort: req.query.sort || '-updatedAt',
    entities,
    agents,
    savedViews,
    selectedView: savedView,
    counts
  };
}

module.exports = {
  getWorkspaceCounts,
  listWorkspaceIssues,
  buildWorkspaceFilter
};
