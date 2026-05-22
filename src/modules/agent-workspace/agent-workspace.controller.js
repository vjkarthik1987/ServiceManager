
const { listWorkspaceIssues, getWorkspaceCounts } = require('./agent-workspace.service');
const { IssueComment } = require('../issues/issue-comment.model');

function wantsJson(req) {
  return req.originalUrl.startsWith('/api/') || req.headers.accept === 'application/json';
}

async function decorateSelectedIssue(req, items = []) {
  const selectedId = req.query.selectedIssueId || (items[0] && String(items[0]._id));
  if (!selectedId) return null;
  const selected = items.find((item) => String(item._id) === String(selectedId));
  if (!selected) return null;
  const comments = await IssueComment.find({ tenantId: req.tenant._id, issueId: selected._id })
    .populate('authorUserId')
    .sort({ createdAt: -1 })
    .limit(3)
    .lean();
  return {
    ...selected,
    latestComments: comments,
    attachmentCount: Array.isArray(selected.attachments) ? selected.attachments.length : 0,
    slaDisplay: selected.sla?.responseStatus === 'BREACHED' || selected.sla?.resolutionStatus === 'BREACHED'
      ? 'BREACHED'
      : (selected.sla?.responseStatus === 'AT_RISK' || selected.sla?.resolutionStatus === 'AT_RISK' ? 'AT_RISK' : (selected.sla?.hasPolicy ? 'ON_TRACK' : 'NO_SLA'))
  };
}

async function workspacePage(req, res, next) {
  try {
    const data = await listWorkspaceIssues(req);
    const selectedIssue = await decorateSelectedIssue(req, data.items);
    return res.render('agent-workspace/index', {
      title: 'Agent Workspace',
      workspace: data,
      selectedIssue,
      queueOptions: [
        { key: 'MY_OPEN', label: 'My Open Issues', countKey: 'myOpenIssues' },
        { key: 'UNASSIGNED', label: 'Unassigned', countKey: 'unassigned' },
        { key: 'IN_TRIAGE', label: 'In Triage', countKey: 'inTriage' },
        { key: 'WAITING_FOR_CLIENT', label: 'Waiting for Client', countKey: 'waitingForClient' },
        { key: 'JIRA_PENDING', label: 'Jira Execution Pending', countKey: 'jiraPending' },
        { key: 'BREACHED_AT_RISK', label: 'Breached / At Risk SLA', countKey: 'breachedOrRiskSla' },
        { key: 'RECENTLY_UPDATED', label: 'Recently Updated', countKey: 'updatedToday' },
        { key: 'ALL', label: 'All Accessible Issues', countKey: 'allAccessibleIssues' }
      ]
    });
  } catch (error) {
    return next(error);
  }
}

async function workspaceSummaryApi(req, res, next) {
  try {
    const summary = await getWorkspaceCounts(req);
    return res.json({ item: summary });
  } catch (error) {
    return next(error);
  }
}

async function workspaceIssuesApi(req, res, next) {
  try {
    const data = await listWorkspaceIssues(req);
    const selectedIssue = await decorateSelectedIssue(req, data.items);
    return res.json({
      items: data.items,
      meta: { total: data.total, page: data.page, limit: data.limit, pages: data.pages, sort: data.sort },
      filters: data.filters,
      counts: data.counts,
      selectedIssue,
      savedViews: data.savedViews
    });
  } catch (error) {
    return next(error);
  }
}

module.exports = { workspacePage, workspaceSummaryApi, workspaceIssuesApi };
