
const path = require('path');
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const helmet = require('helmet');
const morgan = require('morgan');
const methodOverride = require('method-override');
const compression = require('compression');
const csrf = require('csurf');
const expressLayouts = require('express-ejs-layouts');

const apiRoutes = require('./modules/api/api.routes');
const authRoutes = require('./modules/auth/auth.routes');
const entityRoutes = require('./modules/entities/entity.routes');
const userRoutes = require('./modules/users/user.routes');
const issueRoutes = require('./modules/issues/issue.routes');
const assignmentRoutes = require('./modules/assignments/assignment.routes');
const jiraRoutes = require('./modules/integrations/jira/jira.routes');
const jiraFieldMappingRoutes = require('./modules/jira-field-mappings/jira-field-mapping.routes');
const slaRoutes = require('./modules/sla/sla.routes');
const productRoutes = require('./modules/products/product.routes');
const { receiveJiraWebhook } = require('./modules/integrations/jira/jira-webhook.controller');
const { JiraConnection } = require('./modules/integrations/jira/jira-connection.model');

const { attachCurrentUser, requireAuth, requireRole } = require('./middleware/auth');
const { attachTenant, requireTenantMatch } = require('./middleware/tenant');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { Issue } = require('./modules/issues/issue.model');
const { getIndicator } = require('./modules/sla/sla.service');
const { Entity } = require('./modules/entities/entity.model');
const { User } = require('./modules/users/user.model');
const { getAccessibleEntityIdsForUser } = require('./utils/access');
const { ensureDefaultTenant } = require('./modules/tenant/tenant.service');
const { observeTiming, incMetric, captureError, getMetricsSnapshot } = require('./utils/metrics');
const { logInfo, logError } = require('./utils/logger');
const opsRoutes = require('./modules/ops/ops.routes');
const notificationPreferenceRoutes = require('./modules/notifications/notification-preference.routes');
const notificationRoutes = require('./modules/notifications/notification.routes');
const auditRoutes = require('./modules/audit/audit.routes');
const routingRuleRoutes = require('./modules/routing/routing.routes');
const savedViewRoutes = require('./modules/saved-views/saved-view.routes');
const agentWorkspaceRoutes = require('./modules/agent-workspace/agent-workspace.routes');
const clientPortalRoutes = require('./modules/client-portal/client-portal.routes');
const adminConsoleRoutes = require('./modules/admin-console/admin-console.routes');
const statusMappingRoutes = require('./modules/status-mappings/status-mapping.routes');
const { adminConsoleSummaryApi } = require('./modules/admin-console/admin-console.controller');
const workflowAdminRoutes = require('./modules/workflows/workflow.routes');
const { Notification } = require('./modules/notifications/notification.model');

function createApp() {
  const app = express();
  const useHttps = String(process.env.USE_HTTPS || 'false') === 'true';
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.use(expressLayouts);
  app.set('layout', 'layouts/main');

  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(compression());
  app.use(morgan('dev'));
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      observeTiming(`http.${req.method}.${req.route?.path || req.path || 'unknown'}`, Date.now() - startedAt);
      incMetric(`http.status.${res.statusCode}`);
      logInfo('http_request', { method: req.method, path: req.originalUrl, statusCode: res.statusCode, tenantSlug: req.params?.tenantSlug || null, userId: req.currentUser?._id ? String(req.currentUser._id) : null });
    });
    next();
  });
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(methodOverride('_method'));
  app.use(express.static(path.join(__dirname, 'public')));

  if (useHttps) app.set('trust proxy', 1);

  app.use(session({
    secret: process.env.SESSION_SECRET || 'dev_secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/esop_v10' }),
    cookie: { httpOnly: true, sameSite: 'lax', secure: useHttps, maxAge: 1000 * 60 * 60 * 8 }
  }));

  app.use((req, res, next) => {
    res.locals.success = req.session.success || null;
    res.locals.error = req.session.error || null;
    delete req.session.success; delete req.session.error; next();
  });

  app.use(attachTenant);
  app.use(attachCurrentUser);

  const csrfProtection = csrf();
  app.use((req, res, next) => {
    const isApiRequest = req.path.startsWith('/api/');
    const bypassForTests = process.env.NODE_ENV === 'test' && req.headers['x-test-bypass-csrf'] === '1';
    const isMultipart = (req.headers['content-type'] || '').includes('multipart/form-data');
    if (isApiRequest || bypassForTests || isMultipart) return next();
    return csrfProtection(req, res, next);
  });

  app.use(async (req, res, next) => {
    res.locals.csrfToken = typeof req.csrfToken === 'function' ? req.csrfToken() : null;
    res.locals.currentUser = req.currentUser || null;
    res.locals.tenant = req.tenant || null;
    res.locals.basePath = req.basePath || (req.tenant ? `/${req.tenant.slug}` : '');
    res.locals.apiBasePath = req.apiBasePath || (req.tenant ? `/api/v1/${req.tenant.slug}` : '/api/v1');
    res.locals.currentPath = req.originalUrl || req.url || '';
    res.locals.unreadNotificationCount = 0;
    res.locals.appVersion = 'v30.0.0';
    try {
      if (req.currentUser && req.tenant) {
        res.locals.unreadNotificationCount = await Notification.countDocuments({ tenantId: req.tenant._id, recipientUserId: req.currentUser._id, channel: 'IN_APP', readAt: null });
      }
    } catch (error) {
      res.locals.unreadNotificationCount = 0;
    res.locals.appVersion = 'v30.0.0';
    }
    next();
  });

  app.get('/health', (req, res) => res.json({ status: 'ok', version: 'v30.0.0', metrics: getMetricsSnapshot() }));

  app.get('/', async (req, res, next) => {
    try {
      const tenant = await ensureDefaultTenant();
      if (!req.currentUser) return res.redirect(`/${tenant.slug}/login`);
      const targetBase = `/${req.session.tenantSlug || tenant.slug}`;
      return res.redirect(req.currentUser.role === 'client' ? `${targetBase}/client/dashboard` : `${targetBase}/dashboard`);
    } catch (error) { return next(error); }
  });

  app.use('/', authRoutes);

  app.get('/:tenantSlug', attachTenant, (req, res) => {
    if (!req.currentUser) return res.redirect(`${req.basePath}/login`);
    return res.redirect(req.currentUser.role === 'client' ? `${req.basePath}/client/dashboard` : `${req.basePath}/dashboard`);
  });

  app.get('/:tenantSlug/dashboard', attachTenant, requireTenantMatch, requireAuth, async (req, res) => {
    if (req.currentUser.role === 'client') return res.redirect(`${req.basePath}/client/dashboard`);
    const issueFilter = { tenantId: req.tenant._id };
    if (req.currentUser.role === 'client' || req.currentUser.role === 'agent') {
      const scopeIds = await getAccessibleEntityIdsForUser(req.currentUser);
      issueFilter.entityId = { $in: scopeIds.length ? scopeIds : [] };
    }

    const [issuesCount, recentIssues, entitiesCount, usersCount, agentsCount, clientsCount, slaBreachedIssues, slaAtRiskIssues, jiraConnection, openIssuesCount, jiraLinkedIssuesCount, jiraQueueCount, updatedTodayCount] = await Promise.all([
      Issue.countDocuments(issueFilter),
      Issue.find(issueFilter).populate('entityId assignedToUserId createdByUserId').sort({ createdAt: -1 }).limit(15),
      req.currentUser.role === 'superadmin' ? Entity.countDocuments({ tenantId: req.tenant._id }) : Promise.resolve(null),
      req.currentUser.role === 'superadmin' ? User.countDocuments({ tenantId: req.tenant._id }) : Promise.resolve(null),
      req.currentUser.role === 'superadmin' ? User.countDocuments({ tenantId: req.tenant._id, role: 'agent' }) : Promise.resolve(null),
      req.currentUser.role === 'superadmin' ? User.countDocuments({ tenantId: req.tenant._id, role: 'client' }) : Promise.resolve(null),
      Issue.countDocuments({ ...issueFilter, $or: [{ 'sla.responseStatus': 'BREACHED' }, { 'sla.resolutionStatus': 'BREACHED' }] }),
      Issue.countDocuments({ ...issueFilter, $or: [{ 'sla.responseStatus': 'AT_RISK' }, { 'sla.resolutionStatus': 'AT_RISK' }] }),
      JiraConnection.findOne({ tenantId: req.tenant._id, isActive: true }).lean(),
      Issue.countDocuments({ ...issueFilter, status: { $in: ['NEW', 'OPEN', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'READY_TO_CLOSE'] } }),
      Issue.countDocuments({ ...issueFilter, 'jira.issueKey': { $exists: true, $ne: '' } }),
      Issue.countDocuments({ ...issueFilter, executionMode: 'JIRA', $or: [{ executionState: 'READY_FOR_EXECUTION' }, { 'jira.outboundState': 'QUEUED' }, { 'jira.pushStatus': 'NOT_PUSHED' }] }),
      Issue.countDocuments({ ...issueFilter, updatedAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } })
    ]);

    recentIssues.forEach((issue) => {
      if (issue.sla) {
        issue.sla.responseStatus = getIndicator({ dueAt: issue.sla.responseDueAt, completedAt: issue.sla.firstRespondedAt, warningThresholdPercent: issue.sla.warningThresholdPercent, startedAt: issue.createdAt });
        issue.sla.resolutionStatus = getIndicator({ dueAt: issue.sla.resolutionDueAt, completedAt: issue.sla.resolvedAt, warningThresholdPercent: issue.sla.warningThresholdPercent, startedAt: issue.createdAt });
      }
    });

    res.render('dashboard/index', {
      title: 'Dashboard',
      stats: { issuesCount, entitiesCount, usersCount, agentsCount, clientsCount, slaBreachedIssues, slaAtRiskIssues, openIssuesCount, jiraLinkedIssuesCount, jiraQueueCount, updatedTodayCount },
      recentIssues,
      jiraConnection
    });
  });

  app.post('/api/v1/:tenantSlug/integrations/jira/webhook', attachTenant, requireTenantMatch, receiveJiraWebhook);
  app.use('/api/v1/:tenantSlug', attachTenant, requireTenantMatch, apiRoutes);
  app.use('/api/v1', attachTenant, requireTenantMatch, apiRoutes);
  app.use('/:tenantSlug/entities', attachTenant, requireTenantMatch, requireAuth, entityRoutes);
  app.use('/:tenantSlug/users', attachTenant, requireTenantMatch, requireAuth, userRoutes);
  app.use('/:tenantSlug/admin/users', attachTenant, requireTenantMatch, requireAuth, requireRole(['superadmin']), userRoutes);
  app.use('/:tenantSlug/admin/entities', attachTenant, requireTenantMatch, requireAuth, requireRole(['superadmin']), entityRoutes);
  app.use('/:tenantSlug/assignments', attachTenant, requireTenantMatch, requireAuth, requireRole(['superadmin']), assignmentRoutes);

  app.use('/:tenantSlug/admin/console', attachTenant, requireTenantMatch, requireAuth, requireRole(['superadmin']), adminConsoleRoutes);
  app.get('/api/v1/:tenantSlug/admin/console/summary', attachTenant, requireTenantMatch, requireAuth, requireRole(['superadmin']), adminConsoleSummaryApi);
  app.use('/:tenantSlug/admin/integrations/jira', attachTenant, requireTenantMatch, requireAuth, requireRole(['superadmin']), jiraRoutes);
  app.use('/:tenantSlug/admin/jira-field-mappings', attachTenant, requireTenantMatch, requireAuth, requireRole(['superadmin']), jiraFieldMappingRoutes);
  app.use('/:tenantSlug/admin/sla-policies', attachTenant, requireTenantMatch, requireAuth, requireRole(['superadmin']), slaRoutes);
  app.use('/:tenantSlug/admin/routing-rules', attachTenant, requireTenantMatch, requireAuth, requireRole(['superadmin']), routingRuleRoutes);
  app.use('/:tenantSlug/admin/products', attachTenant, requireTenantMatch, requireAuth, requireRole(['superadmin']), productRoutes);
  app.use('/:tenantSlug/admin/notification-preferences', attachTenant, requireTenantMatch, requireAuth, notificationPreferenceRoutes);
  app.use('/:tenantSlug/admin/notifications', attachTenant, requireTenantMatch, requireAuth, notificationRoutes);
  app.use('/:tenantSlug/admin/saved-views', attachTenant, requireTenantMatch, requireAuth, savedViewRoutes);
  app.use('/:tenantSlug/admin/workflows', attachTenant, requireTenantMatch, requireAuth, requireRole(['superadmin']), workflowAdminRoutes);
  app.use('/:tenantSlug/admin/audit', attachTenant, requireTenantMatch, requireAuth, requireRole(['superadmin']), auditRoutes);
  app.use('/:tenantSlug/admin/status-mappings', attachTenant, requireTenantMatch, requireAuth, requireRole(['superadmin']), statusMappingRoutes);
  app.use('/:tenantSlug/admin/ops', attachTenant, requireTenantMatch, requireAuth, requireRole(['superadmin']), opsRoutes);
  app.use('/:tenantSlug/agent/workspace', attachTenant, requireTenantMatch, requireAuth, requireRole(['agent', 'superadmin']), agentWorkspaceRoutes);
  app.use('/:tenantSlug/client', attachTenant, requireTenantMatch, requireAuth, requireRole(['client']), clientPortalRoutes);
  app.use('/:tenantSlug/tickets', attachTenant, requireTenantMatch, requireAuth, issueRoutes);

  app.use(notFoundHandler);
  app.use((err, req, res, next) => { captureError(err, { path: req.originalUrl, tenantSlug: req.params?.tenantSlug || null }); logError('unhandled_error', { path: req.originalUrl, message: err.message }); next(err); });
  app.use(errorHandler); return app;
}

module.exports = { createApp };
