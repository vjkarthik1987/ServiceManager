import express from 'express';
import session from 'express-session';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import {
  addWorkflowStatus,
  applyIssueTypePreset,
  applyWorkflowPreset,
  assignWorkflowToIssueTypes,
  assignWorkflowToLevel2,
  assignSupportPathToLevel2,
  addIssueTypeCustomField,
  updateIssueTypeCustomField,
  createAdminUser,
  createClient,
  createLevel1IssueType,
  createLevel2IssueType,
  createLevel3IssueType,
  updateTaxonomyBehavior,
  updateIssueType,
  createOrganization,
  deletePendingOrganization,
  activateOrganization,
  createWorkflow,
  updateWorkflow,
  getClient,
  getLatestOrganization,
  getOrganization,
  getOrganizationSummary,
  getWorkflow,
  healthSummary,
  listAdmins,
  checkAccountEmailAvailability,
  requestAdminEmailChange,
  requestUserEmailChange,
  validateAdminEmailChange,
  completeAdminEmailChange,
  listClients,
  listIssueTypes,
  listWorkflows,
  updateClientAvailability,
  updateWorkflowTransitions,
  updateWorkflowStatus,
  addWorkflowStatusTask,
  getOperationalConfig,
  seedOperationalConfig,
  createSeverity,
  createPriority,
  createProduct,
  createModule,
  createModulesBulk,
  createRegion,
  createSubregion,
  createEnvironment,
  listSlaPolicies,
  getSlaPolicy,
  createSlaPolicy,
  applySlaPreset,
  addSlaRule,
  assignClientSlaPolicy,
  assignClientFamilySlaPolicy,
  suggestClientCode,
  updateClient,
  deleteClient,
  updateClientProducts,
  updateClientContext,
  addClientOperationalRule,
  getOrganizationByWorkspace,
  listUsers,
  createUser,
  updateUser,
  loginActor,
  validateActivationToken,
  completeActivation,
  requestPasswordReset,
  validatePasswordResetToken,
  completePasswordReset,
  listRequests,
  getClientRequestUsage,
  createServiceRequest,
  getServiceRequest,
  listSupportPaths,
  getSupportPath,
  createSupportPath,
  applySupportPathPreset,
  addSupportPathLevel,
  addSupportPathRule,
  updateSupportPathLevel,
  assignWorkflowToSupportLevel,
  updateSupportPath,
  updateSlaPolicy,
  updateSeverity,
  updatePriority,
  updateProduct,
  updateModule,
  updateRegion,
  updateSubregion,
  updateEnvironment,
  changeRequestStatus,
  updateRequestClassification,
  clientRequestAction,
  claimSlaNotifications,
  getV23SaasFormDefinition,
  moveRequestSupportLevel,
  assignRequestStage,
  updateRequestTaskStatus,
  listRequestTasks,
  getRequestTask,
  addRequestTaskComment,
  closeRequest,
  acknowledgeRequest,
  addRequestComment,
  returnRequest,
  listSavedFilters,
  saveSunFilter,
  updateSunFilterVisibility,
  deleteSunFilter,
  listAuditLogs,
  createAuditLog
} from './services/apiClient.js';
import { sendServiceMail, mailStatus } from './services/mailService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const knownSlaOrganizations = new Set();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.max(1, config.cloudinary.maxUploadMb) * 1024 * 1024, files: 5 }
});

const cloudinaryReady = Boolean(config.cloudinary.cloudName && config.cloudinary.apiKey && config.cloudinary.apiSecret);

function signCloudinaryParams(params, apiSecret) {
  const toSign = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && String(value).length)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  return crypto.createHash('sha1').update(`${toSign}${apiSecret}`).digest('hex');
}

async function uploadToCloudinary(file) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signedParams = {
    folder: config.cloudinary.folder || 'service-desk',
    timestamp
  };
  const signature = signCloudinaryParams(signedParams, config.cloudinary.apiSecret);

  const form = new FormData();
  form.append('file', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  form.append('api_key', config.cloudinary.apiKey);
  form.append('timestamp', String(timestamp));
  form.append('folder', signedParams.folder);
  form.append('signature', signature);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${config.cloudinary.cloudName}/auto/upload`, {
    method: 'POST',
    body: form
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error?.message || 'Cloudinary upload failed');
  }

  return result;
}

async function uploadCommentFiles(files = [], actor = {}) {
  if (!files.length) return [];
  if (!cloudinaryReady) {
    return files.map((file) => ({
      fileName: file.originalname,
      note: 'Cloudinary not configured; metadata stored only.',
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedBy: actor
    }));
  }

  const uploaded = [];
  for (const file of files) {
    const result = await uploadToCloudinary(file);
    uploaded.push({
      fileName: file.originalname,
      fileUrl: result.secure_url,
      publicId: result.public_id,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      uploadedBy: actor
    });
  }
  return uploaded;
}


app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(
  session({
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

function uiProfileFromSession(session = {}) {
  if (session.portal === 'admin' || session.actorType === 'organizationAdmin') return 'tenantAdmin';
  const roles = new Set((Array.isArray(session.assignments) ? session.assignments : [])
    .filter((item) => item && item.status !== 'inactive')
    .map((item) => String(item.role || '').trim())
    .filter(Boolean));
  if (roles.has('agentManager')) return 'agentManager';
  if (roles.has('engagementManager')) return 'engagementManager';
  if (roles.has('agentUser')) return 'agentUser';
  if (roles.has('partnerUser')) return 'partnerUser';
  return 'clientUser';
}

const UI_PROFILE_LABELS = {
  tenantAdmin: 'Tenant Admin',
  clientUser: 'Client User',
  partnerUser: 'Partner · L2',
  agentUser: 'SunTec Agent · L3',
  agentManager: 'Agent Manager',
  engagementManager: 'Engagement Manager'
};

app.use((req, res, next) => {
  res.locals.appName = 'Service Desk';
  res.locals.currentPath = req.path;
  res.locals.session = req.session;
  res.locals.uiProfile = uiProfileFromSession(req.session || {});
  res.locals.uiProfileLabel = UI_PROFILE_LABELS[res.locals.uiProfile] || 'Service Desk User';
  res.locals.globalFormError = req.session?.globalFormError || '';
  res.locals.globalFormNotice = req.session?.globalFormNotice || '';
  if (req.session) {
    delete req.session.globalFormError;
    delete req.session.globalFormNotice;
  }
  if (req.session?.organizationId) knownSlaOrganizations.add(String(req.session.organizationId));
  next();
});

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function wantsJsonResponse(req) {
  return String(req.get('accept') || '').includes('application/json')
    || String(req.get('x-requested-with') || '').toLowerCase() === 'fetch';
}

function userFormError(req, res, next, error) {
  if (wantsJsonResponse(req)) {
    return res.status(Number(error?.status) || 400).json({
      message: error?.message || 'Unable to save the user.'
    });
  }
  return next(error);
}

function assignmentsFromForm(body, validClientIds) {
  const selectedIds = toArray(body.assignmentClientIds).map(String).filter((id) => validClientIds.has(id));
  const includeChildren = new Set(toArray(body.includeChildrenIds).map(String));
  const roleByClient = body.assignmentRole || {};
  const levelsByClient = body.assignmentSupportLevels || {};
  return selectedIds.map((clientId) => {
    const role = String(roleByClient[clientId] || 'clientUser');
    const levels = toArray(levelsByClient[clientId]).filter((level) => ['L1', 'L2', 'L3'].includes(level));
    return {
      clientId,
      role,
      includeChildren: includeChildren.has(clientId),
      supportLevels: levels.length ? levels : defaultSupportLevels(role)
    };
  });
}

async function ensureWorkspace(req, res) {
  if (!req.session.organizationId || req.session.portal !== 'admin' || req.session.actorType !== 'organizationAdmin') {
    return null;
  }
  const { organization } = await getOrganization(req.session.organizationId);
  setOrganizationSession(req, organization);
  return organization;
}

function makeClientMap(clients = []) {
  return new Map((clients || []).map((client) => [String(client._id), client]));
}

function resolveEffectiveLevel1Ids(client, clientsById, seen = new Set()) {
  if (!client) return [];
  const clientId = String(client._id || '');
  if (seen.has(clientId)) return [];
  seen.add(clientId);

  if (client.issueTypeMode === 'inherit' && client.parentClientId) {
    return resolveEffectiveLevel1Ids(clientsById.get(String(client.parentClientId)), clientsById, seen);
  }
  return (client.enabledFamilyIds || []).map(String);
}

function resolveEffectiveSlaPolicyId(client, clientsById, level1TypeId = '', seen = new Set(), fromChild = false) {
  if (!client) return '';
  const clientId = String(client._id || '');
  if (seen.has(clientId)) return '';
  seen.add(clientId);

  const familyId = String(level1TypeId || '');
  if (familyId) {
    const assignment = (client.familySlaAssignments || []).find((item) =>
      item.isActive !== false
      && String(item.level1TypeId || '') === familyId
      && (!fromChild || item.inheritToChildren !== false)
    );
    if (assignment?.slaPolicyId) return String(assignment.slaPolicyId);
  }

  if (client.parentClientId) {
    const inherited = resolveEffectiveSlaPolicyId(clientsById.get(String(client.parentClientId)), clientsById, familyId, seen, true);
    if (inherited) return inherited;
  }

  if (client.slaMode === 'inherit' && client.parentClientId) return '';
  return String(client.defaultSlaPolicyId || '');
}

function resolveEffectiveProductConfig(client, clientsById, seen = new Set()) {
  if (!client) return { productIds: [], moduleIds: [] };
  const clientId = String(client._id || '');
  if (seen.has(clientId)) return { productIds: [], moduleIds: [] };
  seen.add(clientId);

  if ((client.productModuleMode || 'custom') === 'inherit' && client.parentClientId) {
    return resolveEffectiveProductConfig(clientsById.get(String(client.parentClientId)), clientsById, seen);
  }

  return {
    productIds: (client.enabledProductIds || []).map(String),
    moduleIds: (client.enabledModuleIds || []).map(String)
  };
}


function resolveEffectiveEnvironmentIds(client, clientsById, seen = new Set()) {
  if (!client) return [];
  const clientId = String(client._id || '');
  if (seen.has(clientId)) return [];
  seen.add(clientId);
  if ((client.environmentMode || 'custom') === 'inherit' && client.parentClientId) {
    return resolveEffectiveEnvironmentIds(clientsById.get(String(client.parentClientId)), clientsById, seen);
  }
  return (client.enabledEnvironmentIds || []).map(String);
}

function normalizeCalendarSnapshot(value = {}, fallbackTimezone = 'UTC') {
  const workingDays = [...new Set((Array.isArray(value?.workingDays) ? value.workingDays : [1, 2, 3, 4, 5])
    .map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))].sort((a, b) => a - b);
  const clock = (input, fallback) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(input || '').trim()) ? String(input).trim() : fallback;
  const dayStart = clock(value?.dayStart, '09:00');
  const dayEndCandidate = clock(value?.dayEnd, '17:00');
  const dayEnd = dayEndCandidate > dayStart ? dayEndCandidate : '17:00';
  const holidays = (Array.isArray(value?.holidays) ? value.holidays : [])
    .map((item) => typeof item === 'string' ? { date: item.trim(), name: '' } : { date: String(item?.date || '').trim(), name: String(item?.name || '').trim().slice(0, 120) })
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date));
  return {
    timeZone: String(value?.timezone || value?.timeZone || fallbackTimezone || 'UTC').trim() || 'UTC',
    workingDays: workingDays.length ? workingDays : [1, 2, 3, 4, 5],
    dayStart,
    dayEnd,
    holidays: [...new Map(holidays.map((item) => [item.date, item])).values()]
  };
}

function resolveEffectiveBusinessCalendar(client, clientsById, seen = new Set()) {
  if (!client) return normalizeCalendarSnapshot({}, 'UTC');
  const clientId = String(client._id || '');
  if (seen.has(clientId)) return normalizeCalendarSnapshot(client.businessCalendar || {}, client.timezone || 'UTC');
  seen.add(clientId);
  if ((client.businessCalendarMode || 'custom') === 'inherit' && client.parentClientId) {
    return resolveEffectiveBusinessCalendar(clientsById.get(String(client.parentClientId)), clientsById, seen);
  }
  return normalizeCalendarSnapshot(client.businessCalendar || {}, client.timezone || 'UTC');
}

function activeTreeForClient(tree, client, clients = []) {
  const clientsById = makeClientMap(clients);
  const enabledLevel1Ids = new Set(resolveEffectiveLevel1Ids(client, clientsById));

  return tree
    .map((parent) => {
      if (!enabledLevel1Ids.has(String(parent._id))) return null;
      return { ...parent, children: parent.children || [] };
    })
    .filter(Boolean);
}

function effectiveTaxonomyNode(issueType = {}, subtype = null) {
  if (!subtype) return issueType || {};
  const childFields = subtype.fieldsConfig && Object.keys(subtype.fieldsConfig).length ? subtype.fieldsConfig : issueType.fieldsConfig;
  const childCustom = Array.isArray(subtype.customFields) && subtype.customFields.length ? subtype.customFields : issueType.customFields;
  return {
    ...issueType,
    ...subtype,
    workflowId: subtype.workflowId || issueType.workflowId || null,
    workflow: subtype.workflow || issueType.workflow || null,
    supportPathId: subtype.supportPathId || issueType.supportPathId || null,
    supportPath: subtype.supportPath || issueType.supportPath || null,
    slaApplicable: subtype.slaApplicable === null || subtype.slaApplicable === undefined ? issueType.slaApplicable : subtype.slaApplicable,
    slaPolicyId: subtype.slaPolicyId || issueType.slaPolicyId || null,
    slaPolicy: subtype.slaPolicy || issueType.slaPolicy || null,
    formDefinitionKey: subtype.formDefinitionKey || issueType.formDefinitionKey || '',
    approvalPolicyKey: subtype.approvalPolicyKey || issueType.approvalPolicyKey || '',
    notificationPolicyKey: subtype.notificationPolicyKey || issueType.notificationPolicyKey || '',
    fieldsConfig: childFields || {},
    customFields: childCustom || []
  };
}

function flattenClientTree(nodes = [], output = [], level = 0) {
  nodes.forEach((node) => {
    output.push({ ...node, depth: Number(node.depth ?? level), childCount: (node.children || []).length });
    flattenClientTree(node.children || [], output, level + 1);
  });
  return output;
}


function portalName(portal) {
  if (portal === 'client') return 'Client Portal';
  if (portal === 'agent') return 'Agent Portal';
  return 'Admin Portal';
}

function organizationSlug(organization = {}) {
  return String(organization.workspaceSlug || organization.shortCode || organization.name || 'workspace')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'workspace';
}

function portalLoginPath(portal = 'admin', tenantSlug = '') {
  if (portal === 'admin') return '/admin/login';
  return tenantSlug ? `/${tenantSlug}/login` : '/';
}

function portalHomePath(portal = 'admin', tenantSlug = '') {
  if (portal === 'admin') return '/admin/home';
  return tenantSlug ? `/${tenantSlug}/home` : '/';
}

function setOrganizationSession(req, organization) {
  req.session.organizationId = organization._id;
  req.session.organizationName = organization.name;
  req.session.tenantSlug = organizationSlug(organization);
}

function setActorSession(req, organization, actor, portal) {
  setOrganizationSession(req, organization);
  req.session.actorId = actor._id;
  req.session.actorName = actor.name;
  req.session.actorEmail = actor.email;
  req.session.actorType = actor.userType;
  req.session.portal = portal;
  req.session.assignments = actor.assignments || [];
  req.session.clientScopes = actor.clientScopes || [];
  req.session.adminId = actor.userType === 'organizationAdmin' ? actor._id : null;
  req.session.adminName = actor.userType === 'organizationAdmin' ? actor.name : null;
  req.session.adminEmail = actor.userType === 'organizationAdmin' ? actor.email : null;
}

const CLIENT_PORTAL_ROLES = new Set(['clientUser']);
const AGENT_PORTAL_ROLES = new Set(['partnerUser', 'agentUser', 'agentManager', 'engagementManager']);
const ROLE_LABELS = {
  clientUser: 'Client user',
  partnerUser: 'Partner user',
  agentUser: 'Agent user',
  agentManager: 'Agent manager',
  engagementManager: 'Engagement manager'
};

function helpRoleForActor(portal, actor = {}) {
  if (portal === 'admin') return 'admin';
  const roles = new Set(normalizedAssignments(actor).map((item) => item.role));
  if (roles.has('agentManager')) return 'agentManager';
  if (roles.has('engagementManager')) return 'engagementManager';
  if (roles.has('agentUser')) return 'agentUser';
  if (roles.has('partnerUser')) return 'partnerUser';
  return 'clientUser';
}

function faqItemsForRole(role) {
  const startHere = [
    { category: 'Start here', q: 'What is the Service Desk model?', a: 'Every request belongs to a Client, an Issue Family, and a subtype. The client decides which Issue Families are available. The subtype then selects the configured workflow, support path, fields, tasks and routing rules.' },
    { category: 'Start here', q: 'Why do different clients see different request kinds?', a: 'Issue Families are enabled per client. A Product Support client may have only Ticket, while a SaaS managed-support client may have Incident, Maintenance Request and Service Request. Child clients can inherit the parent service model.' },
    { category: 'Start here', q: 'What happens if a client has only one Issue Family?', a: 'The Service Desk selects that family automatically and moves directly to Specifics. The user does not need to click an unnecessary Kind step.' },
    { category: 'Start here', q: 'What is the difference between Ticket and Incident?', a: 'Ticket is the regular Product Support family. Ticket has subtypes Incident, Service Request, Change Request and Query. The separate top-level Incident family is the SaaS Incident process used by Bank, Partner and SunTec SaaS Support.' },
    { category: 'Start here', q: 'What is a Query?', a: 'Query is intentionally simple. It is used for straightforward information or guidance and normally follows New → Assigned → Response Provided → Closed. If analysis shows that it is really an Incident, Service Request or Change Request, it should be reclassified.' },
    { category: 'Start here', q: 'Why does my sidebar look different from another user?', a: 'The workspace adapts to your operating profile. Client, Partner, SunTec Agent, Agent Manager, Engagement Manager and Tenant Admin profiles get different navigation emphasis and accent colours while using the same underlying Service Desk.' },
    { category: 'Start here', q: 'How is the request workbench organised?', a: 'The left sidebar is navigation. The main pane keeps the issue itself readable: prominent key/title, support journey, description, compact task summary, conversation and history. The Jira-like right control tower contains internal workflow status, customer-facing status, ownership, visual SLA, support routing and issue details.' },
    { category: 'Start here', q: 'What does direct-to-L3 support mean?', a: 'A client can be configured so a customer raises the request but SunTec L3 owns it immediately. The customer remains the requester and can comment or provide information, but no customer operational task stage is created.' },
    { category: 'Start here', q: 'How are Standard Bank and Danske Bank configured in the UAT baseline?', a: 'Standard Bank is the normal-support model: Ticket only, with Ticket subtypes routed directly to SunTec L3. Danske Bank is the SaaS model: Incident, Maintenance Request and Service Request using the documented Bank/Partner/SunTec support paths.' },
    { category: 'Start here', q: 'What are Xelerate modules in Service Desk?', a: 'Xelerate is configured as a Product. Modules are service-desk capability areas such as Enterprise Product Catalog, Pricing, Billing, Deal Management, Offer Management, Loyalty, Taxation and E-Invoicing so requests can identify the affected area.' }
  ];

  const serviceModel = [
    { category: 'Service model', q: 'What is an issue?', a: 'An issue is the operational record for something that needs attention or action. Depending on the process and screen, users may also call it a request or ticket.' },
    { category: 'Service model', q: 'What is an Issue Family?', a: 'An Issue Family is the top-level operating process enabled for a client. The standard model contains Ticket, Incident, Maintenance Request and Service Request.' },
    { category: 'Service model', q: 'What is a subtype?', a: 'A subtype is the specific process inside an Issue Family. Ticket has Incident, Service Request, Change Request and Query. SaaS Incident has Application, Security, Operational and Infrastructure.' },
    { category: 'Service model', q: 'What is Ticket → Incident?', a: 'This is the regular Product Support incident process. It can move through Client L1, Client Application Support L2 and SunTec Product Support L3 depending on who can resolve the issue.' },
    { category: 'Service model', q: 'What is SaaS Incident → Application?', a: 'This is a SaaS-managed Application incident. Bank is L1, Partner is L2 and SunTec Support is L3. S1/S2 Production or DR incidents can start Partner and SunTec work in parallel when the client rule is configured that way.' },
    { category: 'Service model', q: 'When should I use Maintenance Request?', a: 'Use Maintenance Request for planned or controlled SaaS maintenance such as Scheduled, Proactive or Emergency Maintenance, Vulnerability Run, Penetration Test Run and Actual DR.' },
    { category: 'Service model', q: 'When should I use Service Request?', a: 'Use the SaaS Service Request family for controlled fulfilment or access activities such as user access, privileged access, reports, DB extracts, DR drills, temporary environment windows and configuration requests.' },
    { category: 'Service model', q: 'What is a Change Request under Ticket?', a: 'It is the regular Product Support controlled-change process. It covers assessment, impact analysis, approval, scheduling, implementation, verification and rollback when needed.' }
  ];

  const workflow = [
    { category: 'Workflow & routing', q: 'What do L1, L2 and L3 mean?', a: 'L1, L2 and L3 are support stages. In regular Product Support, L1/L2 are client-side support and L3 is SunTec Product Support. In SaaS support, L1 is Bank, L2 is Partner and L3 is SunTec Support.' },
    { category: 'Workflow & routing', q: 'What is a workflow?', a: 'A workflow defines the statuses, allowed transitions and task templates inside one support stage. It answers what that stage can do next.' },
    { category: 'Workflow & routing', q: 'What is a status?', a: 'A status describes the current step inside a workflow, such as New, Analysis, Resolution, On Hold, Bank to Verify or Closed.' },
    { category: 'Workflow & routing', q: 'What is a transition?', a: 'A transition is an allowed move from one workflow status to another. If a move is not configured, the UI should not offer it to an operational user.' },
    { category: 'Workflow & routing', q: 'What is a support path?', a: 'A support path connects support stages and assigns a workflow to each stage. It also defines whether movement is sequential or parallel.' },
    { category: 'Workflow & routing', q: 'What does sequential support mean?', a: 'Sequential means the next support stage starts after movement from the current stage, for example L1 → L2 → L3.' },
    { category: 'Workflow & routing', q: 'What does parallel L2/L3 support mean?', a: 'Parallel means more than one support stage is active at the same time. For example, an S1 SaaS Application incident can start Partner L2 and SunTec L3 together while keeping one stage as primary.' },
    { category: 'Workflow & routing', q: 'What is a task?', a: 'A task is a concrete piece of work created from a workflow status. It has its own task ID, owner, visibility, comments and activity.' },
    { category: 'Working a request', q: 'Who can assign an owner?', a: 'Any user who is eligible for the active support stage can assign the request to themselves or another eligible peer for that client. L1 lists customer users, L2 lists Partner users, and L3 lists SunTec support users. Tenant Admin can override when necessary.' },
    { category: 'Working a request', q: 'Where are comments and history?', a: 'Comments & updates and the Audit trail share one Activity area. Use the tabs to switch between the conversation and the system history without scrolling through both.' },
    { category: 'Working a request', q: 'Where do I route the request to another support level?', a: 'Support-routing buttons sit with Current Workflow in the right control rail. Status changes move within a workflow; routing actions move or send work back between support levels.' },
    { category: 'Workflow & routing', q: 'What is a blocking task?', a: 'A blocking task must be completed before progression or closure where the workflow requires it. Blocking work is shown on the request and task pages.' },
    { category: 'Workflow & routing', q: 'What does Bank to Verify mean?', a: 'Bank to Verify is an Application Incident status used when the Bank must validate a support change or resolution. The verification required should be described clearly before handing the request to the Bank.' },
    { category: 'Workflow & routing', q: 'What do Deferred, On Hold and Under Monitoring mean?', a: 'They are temporary control states. The intended SaaS rule is that the incident resumes only to the immediately preceding workflow status.' },
    { category: 'Workflow & routing', q: 'Who can own L1, L2 and L3 work?', a: 'Ownership is stage-specific. L1 is assigned to an eligible customer user for that client, L2 to an eligible Partner user, and L3 to eligible SunTec agents/managers. Unassigned eligible users can Take ownership; Tenant Admin and Agent Manager can assign or reassign where permitted.' },
    { category: 'Workflow & routing', q: 'Can support send work backwards?', a: 'Yes, when the support path contains a return movement rule. Examples include L2 → L1 for more customer information, L3 → L2 for Partner deployment/validation, and L3 → L1 when an L1 stage exists. Forward and return moves both require the configured reason/comment.' },
    { category: 'Workflow & routing', q: 'What is the difference between internal status and customer status?', a: 'Internal workflow status describes what the support team is actually doing. Customer status is a simpler mapped label shown to the customer. The workbench displays them separately so a status dropdown never mixes the two concepts.' },
    { category: 'Workflow & routing', q: 'Where did the workflow tasks go?', a: 'The main issue pane shows only a compact task summary. Open tasks to use the right-side task drawer. This keeps the issue readable while retaining task IDs, blocking flags, owners and task history.' },
    { category: 'Workflow & routing', q: 'Do I need a note to complete a task?', a: 'Yes. Completing or cancelling a task requires a completion note of at least 3 characters. The note is retained for auditability and is visible in task/request history according to visibility rules.' }
  ];

  const sla = [
    { category: 'SLA, severity & closure', q: 'What is an SLA?', a: 'SLA means Service Level Agreement. It represents customer-facing commitments such as response, update and resolution times. Applicability can depend on client, family, severity, environment and support stage.' },
    { category: 'SLA, severity & closure', q: 'How do I read the visual SLA strip on a request?', a: 'The compact SLA strip separates Response, Next update and Resolution. Green means healthy or met, amber means at risk, red means breached and grey means waiting or not applicable. The text beside each bar is the authoritative due-time or time-left value.' },
    { category: 'SLA, severity & closure', q: 'What is an OLA?', a: 'OLA means Operational Level Agreement. It is an internal commitment between teams or support layers used to help achieve the customer SLA.' },
    { category: 'SLA, severity & closure', q: 'When does a SaaS Incident SLA start?', a: 'The intended SaaS model starts SLA when severity is assigned and the request is in an SLA-applicable L2/L3 stage and environment. Production and DR are normally the default SLA environments.' },
    { category: 'SLA, severity & closure', q: 'Why might an SLA show as not active?', a: 'The request may be L1, have no severity yet, be in a non-SLA environment, use a family without Incident SLA, or have no applicable SLA policy configured for the client.' },
    { category: 'SLA, severity & closure', q: 'Severity vs priority — what is the difference?', a: 'Severity represents business or service impact, such as S1 Critical. Priority represents handling urgency or ordering. They are related but are not the same field.' },
    { category: 'SLA, severity & closure', q: 'What is RCA?', a: 'RCA means Root Cause Analysis. It captures why the issue happened, the root cause, corrective action and preventive action. In SaaS Incident, RCA can be customer-visible and required before closure.' },
    { category: 'SLA, severity & closure', q: 'What is closure approval?', a: 'Closure approval is the governance step before final closure. Where configured, blocking tasks and RCA must be complete before an authorized approver approves the request to close.' }
  ];

  const common = [
    { category: 'Using Service Desk', q: 'How do I raise a request?', a: 'Use Raise Request, choose the client, then choose only from the Issue Families enabled for that client. If only one family is enabled, the system selects it automatically.' },
    { category: 'Using Service Desk', q: 'How do I find a request quickly?', a: 'Use Requests, search, Filters, Saved Filters, or search by request number. Task pages link back to their parent request.' },
    { category: 'Using Service Desk', q: 'What does Requests assigned to me do?', a: 'It filters Requests to active support stages whose current owner matches your signed-in user identity. It is a fast personal queue; clearing it returns to all requests in your permitted scope.' },
    { category: 'Using Service Desk', q: 'What do the dashboard daily, weekly and monthly counts mean?', a: 'Raised today counts requests created since the start of today, This week counts requests created since Monday, and This month counts requests created since the first day of the current month. These are volume indicators and sit alongside open-work and SLA views.' },
    { category: 'Using Service Desk', q: 'Why can’t I change a status?', a: 'The current workflow may not permit that transition, your role may not act at that support stage, or blocking work/approval may still be incomplete.' },
    { category: 'Using Service Desk', q: 'Why can’t I see an Issue Family for a client?', a: 'That family is not enabled for the selected client, or the child client is inheriting a parent configuration that does not include it. Tenant admins can review the client Configuration tab.' },
    { category: 'Using Service Desk', q: 'What does the SLA card mean?', a: 'It shows SLA state and milestone timing such as response and resolution. A milestone can remain inactive when the SLA does not apply.' },
    { category: 'Using Service Desk', q: 'How do Filters and Requests work together?', a: 'Build or run a filter on the Filters page, then use See filtered requests. The Requests table shows the active filter above the results until you clear it, so you always know why those rows are being shown.' },
    { category: 'Using Service Desk', q: 'What does an active filter banner mean?', a: 'It records the filter that brought you to the Requests table. Pagination preserves it. Clear filter returns to your full permitted request scope.' },
    { category: 'Using Service Desk', q: 'Can I save a filter for my team?', a: 'Yes. Expand Save this filter and choose Only me, My team or Everyone. Use team or tenant-wide visibility only for filters that are genuinely useful to others.' },
    { category: 'Using Service Desk', q: 'Why do some historical requests show different statuses and SLA colours?', a: 'The UAT baseline intentionally includes a year of varied request history across open, resolved, waiting, at-risk and breached cases. It exists so dashboards, filters, engagement-manager views and SLA reporting can be exercised realistically.' },
    { category: 'SLA, severity & closure', q: 'Can different Issue Families on one client use different SLA policies?', a: 'Yes. V21 supports client + Issue Family SLA assignment. A client can use an Incident SLA while leaving Service Request or Maintenance Request without that Incident SLA.' },
    { category: 'SLA, severity & closure', q: 'Which SLA is used for Standard Bank and Danske Bank in the UAT baseline?', a: 'Standard Bank Ticket uses Gold – Expedited SLA. Danske Bank SaaS Incident uses the Xelerate SaaS Sample Incident SLA. Danske Service Request and Maintenance Request do not inherit the Incident SLA.' },
    { category: 'Troubleshooting', q: 'Why is my SLA grey?', a: 'Grey can mean the SLA is not applicable at the current support level or environment, severity has not triggered the policy yet, no family SLA is configured, or the request is already stopped/closed.' },
    { category: 'Troubleshooting', q: 'Why can I see a request but not act on it?', a: 'Visibility and action permission are different. You may be able to read a request because of client scope or engagement responsibility while another support stage owns the work.' },
    { category: 'Troubleshooting', q: 'Why is someone missing from the Assign owner list?', a: 'Assignment eligibility is contextual. The user must have the right role, client scope and support level for the active stage. Inactive users and users outside the client hierarchy are intentionally excluded.' }
  ];

  const scenarios = [
    { category: 'Common scenarios', q: 'A Standard Bank customer has raised an Incident. Who works it first?', a: 'In the V21 UAT baseline Standard Bank uses Ticket-only direct-to-L3 support. The customer creates the Ticket/Incident, but SunTec L3 Operations becomes the operational stage immediately. No customer workflow-task checklist is created.' },
    { category: 'Common scenarios', q: 'A Standard Bank L3 engineer needs more information. What should happen?', a: 'Use the configured return-to-customer route and add a clear client-visible explanation. The customer supplies the information through Comments & updates; the request then returns to the configured SunTec L3 flow without pretending that the customer is an operational support team.' },
    { category: 'Common scenarios', q: 'A Danske Application Incident is S1 in Production. What should happen?', a: 'The critical SaaS routing rule can activate Partner L2 and SunTec L3 in parallel after the Bank/L1 handoff. Each active stage has its own workflow status, owner and tasks while one stage remains primary.' },
    { category: 'Common scenarios', q: 'A Danske Application Incident is S3. Does L3 start immediately?', a: 'Normally no. The baseline uses the sequential SaaS path for non-critical cases: L1 Bank → L2 Partner → L3 SunTec when L2 needs product/support escalation.' },
    { category: 'Common scenarios', q: 'What should I do if a Query turns out to be a defect?', a: 'A Query is intended for straightforward information. If investigation proves that a defect or controlled change is required, reclassify or raise the appropriate Incident/Change Request rather than stretching the Query workflow into engineering work.' },
    { category: 'Common scenarios', q: 'Why does a client user sometimes have no tasks?', a: 'Tasks belong to operational workflow stages. A requester can participate through comments, verification and customer-facing actions without owning support tasks. Standard Bank direct-to-L3 is deliberately configured this way.' },
    { category: 'Common scenarios', q: 'Can Partner L2 ask the customer for information?', a: 'Yes when the support path contains a configured L2 → L1 return movement. The Partner records the reason and customer-visible information request, then the customer can respond before work returns to Partner.' },
    { category: 'Common scenarios', q: 'Can SunTec L3 return a request to Partner?', a: 'Yes when the support path contains an L3 → L2 movement. This is useful when SunTec has prepared a fix or instruction that Partner must deploy, validate or complete before the issue progresses.' },
    { category: 'Common scenarios', q: 'Can SunTec L3 send a request directly to the customer?', a: 'Yes when an L3 → L1 return route is configured. Typical reasons include clarification or Bank verification. Routing and workflow status are separate controls so the audit trail shows both clearly.' },
    { category: 'Filters & reporting', q: 'What is the difference between Requests assigned to me and a saved filter?', a: 'Requests assigned to me is a quick personal queue based on active-stage ownership. A saved filter can combine multiple conditions such as client, status, support level, SLA, severity and free text, and can be shared according to its visibility setting.' },
    { category: 'Filters & reporting', q: 'Why do I see an Active filter banner above Requests?', a: 'You arrived from Filters with a query. The banner keeps the filtering context visible while you page through results. Clear filter removes the query context and returns to your full permitted request view.' },
    { category: 'Filters & reporting', q: 'What do Only me, My team and Everyone mean on a saved filter?', a: 'Only me keeps the saved view private. My team exposes it to users in the relevant operating context. Everyone makes it tenant-visible. These settings control the saved filter, not permissions to the requests themselves.' },
    { category: 'Filters & reporting', q: 'Why is there a full year of historical data in the UAT environment?', a: 'V21 seeds 30 stable historical requests for each of the six Standard Bank/Danske client records. The varied dates, statuses, families, modules, ownership and SLA colours make daily, weekly, monthly and 365-day dashboards meaningful during UAT.' },
    { category: 'Filters & reporting', q: 'What should an Engagement Manager use the dashboard for?', a: 'Engagement Managers should monitor intake trends, open work, SLA attention, recurring demand and client distribution across their assigned portfolio. In the UAT baseline Sudheer Padiyar and Madhu M can see both Standard Bank and Danske Bank hierarchies.' },
    { category: 'SLA, severity & closure', q: 'Why is Standard Bank Gold SLA attached to Ticket rather than the entire client?', a: 'V21 assigns SLA by Client + Issue Family. This avoids applying one policy blindly to unrelated processes. Standard Bank Ticket is mapped to Gold; Danske SaaS Incident is mapped to the Xelerate SaaS sample Incident SLA.' },
    { category: 'SLA, severity & closure', q: 'Do Danske Service Requests and Maintenance Requests use the Incident SLA?', a: 'No in the V21 baseline. They remain outside the Danske Incident SLA assignment. Their due dates, approvals or maintenance windows can be governed separately without inheriting an Incident response/resolution clock.' },
    { category: 'Roles & access', q: 'What can an Engagement Manager do compared with an Agent Manager?', a: 'Engagement Manager is a portfolio/service-health profile with broad scoped visibility, dashboard and filtering access. Agent Manager is an operational support role that can own, assign and manage SunTec support work. Engagement Managers are not included in L3 owner selection by default in V21.' },
    { category: 'Roles & access', q: 'Why are there two Rajani Ramakrishnan logins?', a: 'They are deliberate UAT identities. rajanir@suntecsbs.com represents Partner/L2; rajanir@suntecgroup.com represents SunTec/L3. Keeping them separate makes role, profile, ownership and routing tests unambiguous.' }
  ];

  const byRole = {
    admin: [
      { category: 'Admin guide', q: 'How do I assign Issue Families to a client?', a: 'Open Clients → the client → Configuration → Issue Families. Root clients can use a client-specific selection. Child clients can inherit the parent selection.' },
      { category: 'Admin guide', q: 'What happens when I remove an Issue Family from a client?', a: 'New requests for that family are no longer offered for that client. Client operational rules that point to subtypes outside the enabled families are pruned so stale routing cannot remain active.' },
      { category: 'Admin guide', q: 'How do client, subtype, support path and workflow fit together?', a: 'Client determines the allowed family. Family determines the available subtype. The subtype provides the default support path, and each support-path stage owns a workflow. Client operational rules can choose an alternate path for the same subtype, such as critical parallel routing.' },
      { category: 'Admin guide', q: 'How are client operational rules selected?', a: 'Rules are evaluated for the selected subtype and can narrow by severity and environment. Specific rules should precede broad fallbacks. Parent rules can be inherited by child clients.' },
      { category: 'Admin guide', q: 'When should I deactivate instead of delete?', a: 'Deactivate records referenced by historical requests or configuration. Deactivation preserves audit history while removing the item from new selections.' }
    ],
    clientUser: [
      { category: 'Client guide', q: 'What can I see on a request?', a: 'You can see client-visible statuses, comments, tasks and RCA details where configured. Internal-only support notes and tasks remain hidden.' },
      { category: 'Client guide', q: 'Why might I have no customer tasks on a Standard Bank request?', a: 'Standard Bank is configured for direct-to-L3 normal support. The customer raises and follows the request, while SunTec L3 owns the operational workflow and tasks. Customer input is provided through comments and customer-visible statuses.' },
      { category: 'Client guide', q: 'What should I do when a request is Bank to Verify?', a: 'Read the verification instructions, perform the requested validation, record the result and return the request to support using the available transition.' }
    ],
    partnerUser: [
      { category: 'Partner guide', q: 'How do I accept an L2 request?', a: 'Open the request, work the active L2 stage, move through configured statuses and complete the generated ownership/analysis tasks.' },
      { category: 'Partner guide', q: 'Why does Rajani have a separate Partner test login?', a: 'The UAT baseline deliberately uses rajanir@suntecsbs.com as the Partner/L2 identity and rajanir@suntecgroup.com as the SunTec/L3 identity. This lets the same tester validate different permissions, sidebars, ownership rules and support stages.' },
      { category: 'Partner guide', q: 'How do I escalate to L3?', a: 'Use the configured support movement, record the reason and required handover information. In parallel paths, L3 can start while L2 remains active.' },
      { category: 'Partner guide', q: 'How do I send a request back for more information?', a: 'Use a configured return movement such as Send back to Customer. Add the reason and a clear client-visible comment explaining exactly what information is required. The target L1 stage can then be assigned to an eligible customer user.' },
      { category: 'Partner guide', q: 'How do I request Bank verification?', a: 'Move an Application workflow to Bank to Verify when available and provide a clear client-visible description of exactly what must be verified.' }
    ],
    agentUser: [
      { category: 'Agent guide', q: 'How do I work an L3 request?', a: 'Use the L3 workflow and generated tasks for analysis, correction/development, release and verification. Keep customer-safe updates on the request.' },
      { category: 'Agent guide', q: 'Can L3 return work to Partner or Customer?', a: 'Yes when that return rule is configured on the support path. L3 can commonly return to Partner L2 for deployment/validation, and can return directly to Customer L1 when the support path includes an L1 stage and an L3 → L1 rule.' },
      { category: 'Agent guide', q: 'How do I record RCA?', a: 'Complete the RCA category, root cause, corrective action, preventive action and RCA status before closure when required.' }
    ],
    agentManager: [
      { category: 'Manager guide', q: 'How do I approve closure?', a: 'Confirm RCA and blocking tasks are complete, then perform the configured closure-approval step when your role is authorized.' },
      { category: 'Manager guide', q: 'How do I monitor team work?', a: 'Use Dashboard, Requests, Tasks and Filters to review support stages, blocking work, SLA state and client scope.' },
      { category: 'Manager guide', q: 'How do I assign or reassign ownership?', a: 'Open the request and use Ownership in the right control tower. Only users eligible for that stage/client are listed. Eligibility follows the support path owner: Customer/Bank stages list client users, Partner stages list partner users, and SunTec stages list SunTec agents/managers.' }
    ],
    engagementManager: [
      { category: 'Engagement guide', q: 'How do I monitor a client?', a: 'Use your assigned client scope, dashboards, filters and request/task views to follow service activity and SLA attention.' },
      { category: 'Engagement guide', q: 'What does my Engagement Manager scope include?', a: 'The UAT baseline assigns Sudheer Padiyar and Madhu M to both Standard Bank and Danske Bank with child-client inheritance. Their dashboard and request views therefore cover both client portfolios.' },
      { category: 'Engagement guide', q: 'What should I look at first on the dashboard?', a: 'Start with Today, This week and This month for intake volume, then SLA attention, client distribution, open aging and the attention queue. Use the time-range control for trend comparisons.' },
      { category: 'Engagement guide', q: 'Can I work support tasks as an Engagement Manager?', a: 'Engagement Manager is primarily a portfolio and service-health profile. Visibility can be broad, but operational ownership still follows the configured support stage and eligible support roles.' },
      { category: 'Engagement guide', q: 'How do I isolate one client or one problem area?', a: 'Use Filters or the client-linked charts, then open the result in Requests. The active filter banner will remain visible above the request table until you clear it.' },
      { category: 'Engagement guide', q: 'How do I identify recurring demand?', a: 'Use the 30/90/180/365-day dashboard ranges together with Issues by family, client and status. The seeded year of UAT data provides enough history to test these views.' }
    ]
  };

  return [...startHere, ...serviceModel, ...workflow, ...sla, ...scenarios, ...(byRole[role] || byRole.clientUser), ...common];
}

function defaultSupportLevels(role) {
  if (role === 'clientUser') return ['L1'];
  if (role === 'partnerUser') return ['L2'];
  return ['L3'];
}

function chooseTenantPortal(actor = {}) {
  const roles = new Set(normalizedAssignments(actor).map((item) => item.role));
  if ([...roles].some((role) => AGENT_PORTAL_ROLES.has(role))) return 'agent';
  if (roles.has('clientUser')) return 'client';
  return 'client';
}

function normalizedAssignments(actor = {}) {
  if (actor.assignments?.length) return actor.assignments.map((item) => ({
    ...item,
    clientId: String(item.clientId || ''),
    supportLevels: item.supportLevels?.length ? item.supportLevels.map(String) : defaultSupportLevels(item.role)
  }));
  const legacyRole = actor.userType === 'client' ? 'clientUser' : (actor.userType || 'agentUser');
  return (actor.clientScopes || []).map((scope) => ({
    clientId: String(scope.clientId || ''),
    role: legacyRole,
    includeChildren: scope.includeChildren === true,
    supportLevels: defaultSupportLevels(legacyRole)
  }));
}

function assignmentsForPortal(actor, portal) {
  const allowed = portal === 'client' ? CLIENT_PORTAL_ROLES : portal === 'agent' ? AGENT_PORTAL_ROLES : null;
  return allowed ? normalizedAssignments(actor).filter((item) => allowed.has(item.role)) : normalizedAssignments(actor);
}

function includeChildSet(baseClientId, flatClients) {
  const output = new Set([String(baseClientId)]);
  flatClients.forEach((item) => {
    const pathIds = (item.path || []).map(String);
    if (pathIds.includes(String(baseClientId))) output.add(String(item._id));
  });
  return output;
}

function assignmentContexts(actor, flatClients = [], portal = 'agent') {
  const contexts = new Map();
  assignmentsForPortal(actor, portal).forEach((assignment) => {
    const ids = assignment.includeChildren ? includeChildSet(assignment.clientId, flatClients) : new Set([String(assignment.clientId)]);
    ids.forEach((clientId) => {
      const existing = contexts.get(clientId) || [];
      existing.push({ ...assignment, isDirect: String(assignment.clientId) === String(clientId) });
      contexts.set(clientId, existing);
    });
  });
  return contexts;
}

function resolveUserScopedClients(actor, flatClients = [], portal = 'agent') {
  const byId = makeClientMap(flatClients);
  return [...assignmentContexts(actor, flatClients, portal).keys()].map((id) => byId.get(id)).filter(Boolean);
}

function bestAssignmentForClient(actor, clientId, flatClients = [], portal = 'agent') {
  const candidates = assignmentContexts(actor, flatClients, portal).get(String(clientId)) || [];
  const rank = { agentManager: 5, agentUser: 4, engagementManager: 3, partnerUser: 2, clientUser: 1 };
  return [...candidates].sort((a, b) => Number(b.isDirect) - Number(a.isDirect) || (rank[b.role] || 0) - (rank[a.role] || 0))[0] || null;
}

function assignmentCanSeeRequest(assignment, request, portal) {
  if (portal === 'client') return assignment?.role === 'clientUser' && request.visibilityScope === 'client_visible';
  if (!assignment) return false;
  if (assignment.role === 'partnerUser') return ['client_visible', 'partner_visible'].includes(request.visibilityScope || 'client_visible');
  return true;
}

function assignmentCanActAtLevel(assignment, level) {
  return Boolean(assignment && (assignment.supportLevels || defaultSupportLevels(assignment.role)).includes(String(level)));
}

function assignmentRolesForOwnerSide(ownerSide = 'client') {
  if (ownerSide === 'partner') return new Set(['partnerUser']);
  if (ownerSide === 'suntec') return new Set(['agentUser', 'agentManager']);
  return new Set(['clientUser']);
}

function assignmentMatchesStage(assignment = null, stage = {}, level = 'L1') {
  if (!assignment) return false;
  const allowedRoles = assignmentRolesForOwnerSide(stage?.ownerSide || ownerSideFromSupportLevel(level));
  if (!allowedRoles.has(assignment.role)) return false;
  return assignmentCanActAtLevel(assignment, level);
}

function userAssignmentsCoverClient(user = {}, clientId = '', flatClients = [], level = 'L1', ownerSide = '') {
  const allowedRoles = assignmentRolesForOwnerSide(ownerSide || ownerSideFromSupportLevel(level));
  return normalizedAssignments(user).some((assignment) => {
    if (!allowedRoles.has(assignment.role)) return false;
    if (!(assignment.supportLevels || defaultSupportLevels(assignment.role)).includes(String(level))) return false;
    const covered = assignment.includeChildren ? includeChildSet(assignment.clientId, flatClients) : new Set([String(assignment.clientId)]);
    return covered.has(String(clientId));
  });
}

function eligibleStageAssignees(users = [], clientId = '', flatClients = [], level = 'L1', ownerSide = '') {
  return (users || [])
    .filter((user) => user.status !== 'inactive' && userAssignmentsCoverClient(user, clientId, flatClients, level, ownerSide))
    .map((user) => ({ _id: String(user._id), name: user.name, email: user.email }))
    .sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email)));
}

function actorMatchesEligibleAssignee(actor = {}, eligible = []) {
  const actorId = String(actor._id || actor.actorId || '');
  const email = String(actor.email || '').toLowerCase();
  return (eligible || []).some((user) => String(user._id) === actorId || (email && String(user.email || '').toLowerCase() === email));
}

function actorMatchesStageOwner(actor = {}, stage = {}) {
  const owner = stage?.assignedTo || {};
  const actorId = String(actor._id || actor.actorId || '');
  const email = String(actor.email || '').toLowerCase();
  return Boolean((actorId && String(owner.actorId || '') === actorId) || (email && String(owner.email || '').toLowerCase() === email));
}

function canWorkSupportStage({ portal = 'admin', actor = {}, assignment = null, stage = null, level = 'L1' } = {}) {
  if (portal === 'admin') return true;
  if (!stage || !assignmentMatchesStage(assignment, stage, level)) return false;
  return actorMatchesStageOwner(actor, stage);
}

// v23.1.5: acknowledgement follows the same SaaS eligibility model as the
// request workbench. An eligible Partner/L2 or SunTec/L3 user may acknowledge
// an ACTIVE, UNASSIGNED SaaS support stage without first assigning it to
// themselves. Once a stage has an explicit owner, only that owner (or Admin)
// may acknowledge it. This prevents the UI from offering Acknowledge and the
// POST handler then rejecting the same actor.
function canAcknowledgeSupportStage({ portal = 'admin', actor = {}, assignment = null, stage = null, level = 'L1', isSaasRequest = false } = {}) {
  if (portal === 'admin') return true;
  if (!stage || !assignmentMatchesStage(assignment, stage, level)) return false;
  if (actorMatchesStageOwner(actor, stage)) return true;
  const owner = stage?.assignedTo || {};
  const isUnassigned = !(owner.actorId || owner.email);
  return Boolean(isSaasRequest && isUnassigned);
}

function scopeLabel(assignment, clientsById) {
  const client = clientsById.get(String(assignment.clientId || ''));
  if (!client) return 'Unknown client';
  return `${client.name} · ${ROLE_LABELS[assignment.role] || assignment.role}${assignment.includeChildren ? ' · includes children' : ''}`;
}

function printInviteMail({ organization, user, temporaryPassword, baseUrl }) {
  const roles = new Set((user.assignments || []).map((item) => item.role));
  const tenantSlug = organizationSlug(organization);
  const loginLines = [];
  if (user.userType === 'organizationAdmin') loginLines.push(`Admin Portal: ${baseUrl}/admin/login  (Tenant: ${tenantSlug})`);
  if ([...roles].some((role) => AGENT_PORTAL_ROLES.has(role) || role === 'clientUser')) loginLines.push(`Tenant Portal: ${baseUrl}/${tenantSlug}/login`);
  const lines = (loginLines.length ? loginLines : [`Tenant Portal: ${baseUrl}/${tenantSlug}/login`]).join('\n');
  console.log(`\n--------------------------------------------------\nSERVICE DESK USER INVITE\nTo: ${user.email}\nName: ${user.name}\nOrganization: ${organization.name}\n${lines}\nTemporary Password: ${temporaryPassword}\n\nMessage:\nYou have been added to ${organization.name}. Your client-specific roles determine what you can see and do.\n--------------------------------------------------\n`);
}




function actorSnapshotFromSession(req, portal = 'admin') {
  return {
    actorId: String(req.session?.actorId || req.session?.adminEmail || ''),
    name: String(req.session?.actorName || req.session?.adminName || 'System'),
    email: String(req.session?.actorEmail || req.session?.adminEmail || ''),
    role: String(req.session?.actorRole || req.session?.portal || portal),
    portal
  };
}

async function safeAudit(organizationId, data) {
  try {
    await createAuditLog(organizationId, data);
  } catch (error) {
    console.error('[audit] Failed to write audit log:', error.message);
  }
}

async function safeMailAndAudit(organization, { to, subject, text, html, eventType = 'mail_sent', targetType = '', targetId = '', targetLabel = '', actor = {}, metadata = {} }) {
  const result = await sendServiceMail({ to, subject, text, html });
  if (organization?._id) {
    await safeAudit(organization._id, {
      eventType,
      message: `${subject} ${result.ok ? 'sent' : 'logged/failed'} for ${to || 'recipient'}.`,
      targetType,
      targetId,
      targetLabel,
      actor,
      metadata: { ...metadata, mailResult: result }
    });
  }
  return result;
}

function runInBackground(label, job) {
  setImmediate(() => {
    Promise.resolve()
      .then(job)
      .catch((error) => {
        console.error(`[background] ${label} failed:`, error?.message || error);
        if (error?.stack) console.error(error.stack);
      });
  });
}

function publicBaseUrl(req) {
  return String(config.mail.publicBaseUrl || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
}

function mailDeliveryLabel(result, { sent = 'Email sent.', console = 'Email printed to the Service Desk terminal.', failed = 'Email could not be sent.' } = {}) {
  if (result?.mode === 'console') return console;
  if (result?.ok) return sent;
  const detail = String(result?.error || '').trim();
  return detail ? `${failed} ${detail}` : failed;
}

function collectV23CustomFieldsFromBody(body = {}) {
  const fields = [];
  for (const [name, value] of Object.entries(body || {})) {
    if (!name.startsWith('v23Field__')) continue;
    const fieldKey = name.slice('v23Field__'.length).trim();
    if (!fieldKey) continue;
    const cleanValue = Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : String(value || '').trim();
    if (Array.isArray(cleanValue) ? !cleanValue.length : !cleanValue) continue;
    fields.push({ fieldKey, key: fieldKey, code: fieldKey, name: fieldKey, label: fieldKey, value: cleanValue, source: 'v23_configurable_form' });
  }
  return fields;
}

function isV23SaasRequestRecord(request = {}) {
  const direct = String(request.serviceModelKey || request.v23ServiceModelKey || request.level3Type?.serviceModelKey || request.level2Type?.serviceModelKey || request.level1Type?.serviceModelKey || '').trim();
  if (direct === 'SUNTEC_SAAS_V23') return true;
  const fields = request.customFieldValues || request.customFields || [];
  return (fields || []).some((field) => {
    const key = String(field.fieldKey || field.key || field.code || field.name || field.label || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    return (key === '__v23_service_model_key' || key === 'service_model_key') && String(field.value || field.displayValue || '').trim() === 'SUNTEC_SAAS_V23';
  });
}

const V23_INCIDENT_LIFECYCLE_FIELD_KEYS = new Set([
  'SEVERITY', 'PRIORITY', 'S3_BUCKET_URL', 'TEST_RELEASE', 'RELEASE_ID', 'RELEASE_TYPE',
  'RCA_CATEGORY', 'ROOT_CAUSE', 'CORRECTIVE_ACTION', 'PREVENTIVE_ACTION', 'RCA_STATUS',
  'APPROVER', 'EXCEPTION_APPROVER', 'TEST_CASE_LINK'
]);

function isV23SaasBehaviorNode(node = {}) {
  return String(node?.formDefinitionKey || '').trim().toUpperCase().startsWith('SAAS_');
}

function taxonomyNodeIsIncident(node = {}) {
  const code = String(node?.key || node?.code || '').trim().toUpperCase();
  const name = String(node?.name || '').trim().toLowerCase();
  return code === 'INCIDENT' || name === 'incident';
}

function isV23SaasIncidentBehaviorNode(node = {}, issueType = null) {
  const marker = String(node?.formDefinitionKey || '').trim().toUpperCase();
  return marker.startsWith('SAAS_INCIDENT_') || taxonomyNodeIsIncident(issueType || node);
}

function requestLooksLikeV23Incident(request = {}, configuredBehavior = {}, supportPath = null) {
  const taxonomyIncident = taxonomyNodeIsIncident(request?.level2Type || {});
  const taxonomyVersion = String(request?.taxonomyVersion || '').trim();
  const pathCode = String(supportPath?.key || supportPath?.code || request?.supportPath?.code || '').trim().toUpperCase();
  const pathName = String(supportPath?.name || request?.supportPath?.name || '').trim();
  const marker = String(configuredBehavior?.formDefinitionKey || '').trim().toUpperCase();
  return marker.startsWith('SAAS_INCIDENT_')
    || (taxonomyIncident && (taxonomyVersion.startsWith('23.1') || pathCode.startsWith('PATH_INC_') || /\bincident\b/i.test(pathName)));
}

function filterClientIncidentLifecycleFields(fields = [], { portal = '', behaviorNode = {}, issueType = null, incident = false } = {}) {
  if (portal !== 'client' || !(incident || isV23SaasIncidentBehaviorNode(behaviorNode, issueType))) return fields || [];
  return (fields || []).filter((field) => !V23_INCIDENT_LIFECYCLE_FIELD_KEYS.has(String(field?.fieldKey || '').trim().toUpperCase()));
}


function dispatchRequestMail(args) {
  const requestLabel = args?.request?.requestNumber || args?.request?._id || args?.request?.id || 'request';
  const eventLabel = args?.event || 'notification';
  runInBackground(`mail ${requestLabel} ${eventLabel}`, () => sendRequestMail(args));
}

async function pollSlaNotifications() {
  for (const organizationId of [...knownSlaOrganizations]) {
    try {
      const [{ organization }, pending] = await Promise.all([
        getOrganization(organizationId),
        claimSlaNotifications(organizationId)
      ]);

      for (const item of pending?.notifications || []) {
        const breached = item.state === 'breached';
        dispatchRequestMail({
          organization,
          request: item.request,
          event: breached ? 'SLA breached' : 'SLA at risk',
          actor: { name: 'Service Desk', userType: 'system', portal: 'system' },
          extra: item.request?.sla?.reason || (breached ? 'The SLA has breached.' : 'The SLA is approaching breach.')
        });
      }
    } catch (error) {
      console.error(`[sla-notifier] ${organizationId}: ${error.message}`);
    }
  }
}

const slaNotificationTimer = setInterval(() => {
  runInBackground('SLA notification scan', pollSlaNotifications);
}, 60 * 1000);
slaNotificationTimer.unref?.();

function requestActionRedirect(portal, requestId, tenantSlug, { notice = '', error = '' } = {}) {
  const base = requestDetailPath(portal, requestId, tenantSlug);
  const query = new URLSearchParams();
  if (notice) query.set('notice', String(notice).slice(0, 300));
  if (error) query.set('error', String(error).slice(0, 500));
  return query.size ? `${base}?${query.toString()}` : base;
}

function redirectRequestActionError(error, req, res, portal) {
  if (![400, 409].includes(Number(error?.status))) return false;
  const message = error?.payload?.message || error?.message || 'The request could not be updated.';
  res.redirect(requestActionRedirect(portal, req.params.requestId, req.session.tenantSlug, { error: message }));
  return true;
}


function escapeMailHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function nl2br(value) {
  return escapeMailHtml(value).replace(/\n/g, '<br />');
}

function renderMailShell({ preheader = '', title = 'Service Desk update', intro = '', rows = [], actionUrl = '', actionLabel = '', note = '' }) {
  const rowHtml = rows
    .filter((row) => row && row.label)
    .map((row) => `
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #E6E0D4;color:#8B7355;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;width:34%;">${escapeMailHtml(row.label)}</td>
        <td style="padding:10px 0;border-bottom:1px solid #E6E0D4;color:#1F2933;font-size:14px;font-weight:700;">${nl2br(row.value || '—')}</td>
      </tr>`).join('');
  const actionHtml = actionUrl ? `
    <div style="margin:22px 0 6px;">
      <a href="${escapeMailHtml(actionUrl)}" style="display:inline-block;background:#1F8A5B;color:#ffffff;text-decoration:none;border-radius:999px;padding:12px 18px;font-size:14px;font-weight:800;">${escapeMailHtml(actionLabel || 'Open Service Desk')}</a>
    </div>` : '';
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#FAF8F1;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1F2933;">
    <span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;">${escapeMailHtml(preheader)}</span>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F1;margin:0;padding:28px 0;">
      <tr>
        <td align="center" style="padding:0 14px;">
          <table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#FFFFFF;border:1px solid #E6E0D4;border-radius:22px;overflow:hidden;box-shadow:0 18px 50px rgba(31,41,51,.08);">
            <tr>
              <td style="background:linear-gradient(135deg,#E7F6EE 0%,#FFFFFF 48%,#FFF4BF 100%);padding:24px 28px;border-bottom:1px solid #E6E0D4;">
                <div style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#8B7355;font-weight:900;margin-bottom:8px;">Service Desk</div>
                <h1 style="margin:0;font-size:24px;line-height:1.25;color:#1F2933;letter-spacing:-.03em;">${escapeMailHtml(title)}</h1>
                ${intro ? `<p style="margin:10px 0 0;color:#6B7280;font-size:14px;line-height:1.55;">${nl2br(intro)}</p>` : ''}
              </td>
            </tr>
            <tr>
              <td style="padding:22px 28px 26px;">
                ${rowHtml ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${rowHtml}</table>` : ''}
                ${actionHtml}
                ${note ? `<div style="margin-top:18px;background:#FFF4BF;border:1px solid #F4C430;border-radius:16px;padding:12px 14px;color:#1F2933;font-size:13px;line-height:1.45;">${nl2br(note)}</div>` : ''}
                <p style="margin:24px 0 0;color:#6B7280;font-size:13px;line-height:1.5;">Regards,<br /><strong style="color:#1F2933;">Service Desk</strong></p>
              </td>
            </tr>
          </table>
          <p style="margin:14px 0 0;color:#9CA3AF;font-size:11px;">Warm Command Minimal · operational notifications</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendInviteMail({ organization, user, temporaryPassword, baseUrl, actor = {} }) {
  const tenantSlug = organizationSlug(organization);
  const roles = new Set((user.assignments || []).map((item) => item.role));
  const adminUrl = `${baseUrl}/admin/login`;
  const tenantUrl = `${baseUrl}/${tenantSlug}/login`;
  const loginRows = [];
  if (user.userType === 'organizationAdmin' || user.role === 'admin' || user.role === 'owner') {
    loginRows.push(`Admin Portal: ${adminUrl}  (Tenant: ${tenantSlug})`);
  }
  if ([...roles].some((role) => AGENT_PORTAL_ROLES.has(role) || role === 'clientUser')) {
    loginRows.push(`Tenant Portal: ${tenantUrl}`);
  }
  const lines = (loginRows.length ? loginRows : [`Tenant Portal: ${tenantUrl}`]).join('\n');
  const text = `Hello ${user.name},

You have been added to ${organization.name}.

${lines}

Temporary password: ${temporaryPassword}

Your client-specific roles determine what you can see and do.

Regards,
Service Desk`;
  const html = renderMailShell({
    preheader: `You have been added to ${organization.name}.`,
    title: `Welcome, ${user.name}`,
    intro: `You have been added to ${organization.name}. Your client-specific roles decide what you can see and do.`,
    rows: [
      { label: 'Organization', value: organization.name },
      { label: 'Tenant', value: tenantSlug },
      { label: 'Login', value: lines },
      { label: 'Temporary password', value: temporaryPassword }
    ],
    actionUrl: tenantUrl,
    actionLabel: 'Open tenant portal',
    note: 'This is a temporary password for testing. Change it when password reset/change-password flow is enabled.'
  });
  return safeMailAndAudit(organization, {
    to: user.email,
    subject: `Service Desk invite for ${organization.name}`,
    text,
    html,
    eventType: 'user_invite_mail',
    targetType: 'user',
    targetId: user._id || user.id || '',
    targetLabel: user.email,
    actor
  });
}

async function sendOrganizationActivationMail({ organization, admin, activationToken, baseUrl }) {
  const tenantSlug = organizationSlug(organization);
  const activationUrl = `${baseUrl}/activate/${encodeURIComponent(activationToken)}`;
  const text = `Hello ${admin.name},

Your Service Desk workspace for ${organization.name} has been created and is waiting for activation.

Activate workspace: ${activationUrl}

This one-time link expires in 24 hours. You will choose your admin password during activation.

Tenant workspace: ${baseUrl}/${tenantSlug}/login

Regards,
Service Desk`;
  const html = renderMailShell({
    preheader: `Activate ${organization.name} Service Desk workspace.`,
    title: 'Activate your Service Desk workspace',
    intro: `${organization.name} has been created in pending state. Activate the first administrator to make the workspace available.`,
    rows: [
      { label: 'Organization', value: organization.name },
      { label: 'Workspace', value: `/${tenantSlug}` },
      { label: 'Administrator', value: `${admin.name} · ${admin.email}` },
      { label: 'Link validity', value: '24 hours · one-time use' }
    ],
    actionUrl: activationUrl,
    actionLabel: 'Activate workspace',
    note: 'For security, the workspace remains inactive until this link is used and an administrator password is set.'
  });
  return safeMailAndAudit(organization, {
    to: admin.email,
    subject: `Activate Service Desk for ${organization.name}`,
    text,
    html,
    eventType: 'organization_activation_mail',
    targetType: 'organization',
    targetId: organization._id,
    targetLabel: organization.name,
    actor: { name: admin.name, email: admin.email, role: 'owner', portal: 'setup' }
  });
}

async function sendPasswordResetMail({ organization, account, resetToken, accountType, baseUrl }) {
  const tenantSlug = organizationSlug(organization);
  const resetUrl = `${baseUrl}/reset-password/${encodeURIComponent(resetToken)}`;
  const loginUrl = accountType === 'admin' ? `${baseUrl}/admin/login` : `${baseUrl}/${tenantSlug}/login`;
  const text = `Hello ${account.name || 'there'},

A password reset was requested for your Service Desk account.

Reset password: ${resetUrl}

This one-time link expires in 30 minutes. If you did not request this, no action is required.

Login: ${loginUrl}

Regards,
Service Desk`;
  const html = renderMailShell({
    preheader: 'Reset your Service Desk password.',
    title: 'Reset your password',
    intro: 'Use the one-time link below to choose a new password. The link expires in 30 minutes.',
    rows: [
      { label: 'Organization', value: organization.name },
      { label: 'Account', value: account.email || '' },
      { label: 'Portal', value: accountType === 'admin' ? 'Admin Portal' : 'Tenant Portal' }
    ],
    actionUrl: resetUrl,
    actionLabel: 'Reset password',
    note: 'If you did not request a password reset, you can ignore this message.'
  });
  return sendServiceMail({ to: account.email, subject: `Reset your Service Desk password`, text, html });
}

async function sendAdminEmailVerificationMail({ organization, adminName, currentEmail, newEmail, token, baseUrl }) {
  const verifyUrl = `${baseUrl}/verify-admin-email/${encodeURIComponent(token)}`;
  const text = `Hello ${adminName || 'Administrator'},

A change was requested for your Service Desk administrator email.

Current email: ${currentEmail}
New email: ${newEmail}
Verify new email: ${verifyUrl}

This one-time link expires in 60 minutes.

Regards,
Service Desk`;
  const html = renderMailShell({
    preheader: 'Verify your new Service Desk administrator email.',
    title: 'Verify administrator email change',
    intro: 'Confirm the new email address before it becomes the login identity.',
    rows: [
      { label: 'Organization', value: organization.name },
      { label: 'Current email', value: currentEmail },
      { label: 'New email', value: newEmail },
      { label: 'Link validity', value: '60 minutes · one-time use' }
    ],
    actionUrl: verifyUrl,
    actionLabel: 'Verify new email',
    note: 'The current login email remains active until this verification succeeds.'
  });
  return sendServiceMail({ to: newEmail, subject: 'Verify your new Service Desk administrator email', text, html });
}

async function sendUserEmailVerificationMail({ organization, userName, currentEmail, newEmail, token, baseUrl }) {
  const verifyUrl = `${baseUrl}/verify-email/${encodeURIComponent(token)}`;
  const text = `Hello ${userName || 'there'},

An administrator requested a change to your Service Desk login email.

Current email: ${currentEmail}
New email: ${newEmail}
Verify new email: ${verifyUrl}

This one-time link expires in 60 minutes. The current email remains active until verification succeeds.

Regards,
Service Desk`;
  const html = renderMailShell({
    preheader: 'Verify your new Service Desk login email.',
    title: 'Verify login email change',
    intro: 'Confirm the new email address before it replaces your current login.',
    rows: [
      { label: 'Organization', value: organization.name },
      { label: 'Current email', value: currentEmail },
      { label: 'New email', value: newEmail },
      { label: 'Link validity', value: '60 minutes · one-time use' }
    ],
    actionUrl: verifyUrl,
    actionLabel: 'Verify new email',
    note: 'If you were not expecting this change, contact your tenant administrator.'
  });
  return sendServiceMail({ to: newEmail, subject: 'Verify your new Service Desk login email', text, html });
}

async function sendRequestMail({ organization, request, event, actor = {}, extra = '', visibility = '', customerStatusChanged = true }) {
  if (!request) return null;
  const eventKey = String(event || '').trim().toLowerCase();
  const commentVisibility = String(visibility || '').trim().toLowerCase();
  const customerStatusVisible = request.currentStatus?.isCustomerVisible !== false;
  const customerEmails = [
    (request.visibilityScope || 'client_visible') === 'client_visible' ? request.raisedOnBehalfOf?.email : '',
    (request.visibilityScope || 'client_visible') === 'client_visible' ? request.requester?.email : ''
  ];
  const stageEmails = (request.activeStages || []).map((stage) => stage.assignedTo?.email);

  let scopedUsers = [];
  let clientRows = [];
  try {
    const [usersResponse, clientsResponse] = await Promise.all([listUsers(organization._id), listClients(organization._id)]);
    scopedUsers = usersResponse.users || [];
    clientRows = clientsResponse.clients || [];
  } catch {
    // Core notification recipients still work if the directory lookup is temporarily unavailable.
  }
  const managementEmails = scopedUsers
    .filter((user) => {
      if ((user.status || 'active') !== 'active') return false;
      const assignment = bestAssignmentForClient(user, request.client?.id, clientRows, 'agent');
      return assignment && ['agentManager', 'engagementManager'].includes(assignment.role);
    })
    .map((user) => user.email);

  const recipients = new Set();
  const addEmails = (values = []) => values.forEach((email) => {
    const clean = String(email || '').trim().toLowerCase();
    if (clean.includes('@')) recipients.add(clean);
  });

  if (eventKey === 'created') {
    addEmails(customerEmails);
    addEmails(stageEmails);
  } else if (eventKey === 'assigned' || eventKey === 'ownership changed') {
    addEmails(stageEmails);
    addEmails(managementEmails);
  } else if (eventKey === 'sla at risk' || eventKey === 'sla breached') {
    addEmails(stageEmails);
    addEmails(managementEmails);
  } else if (eventKey === 'comment added') {
    if (commentVisibility === 'client_visible') {
      if (actor.portal === 'client') {
        addEmails(stageEmails);
        addEmails(managementEmails);
      } else {
        addEmails(customerEmails);
        addEmails(stageEmails);
      }
    } else {
      // Partner/internal notes are never mailed to the customer.
      addEmails(stageEmails);
      addEmails(managementEmails);
    }
  } else if (['client information submitted', 'information supplied', 'resolution rejected', 'resolution accepted'].includes(eventKey)) {
    addEmails(stageEmails);
    addEmails(managementEmails);
  } else if (['information requested', 'resolved', 'closed', 'status changed'].includes(eventKey)) {
    addEmails(stageEmails);
    if (customerStatusVisible && (eventKey !== 'status changed' || customerStatusChanged)) addEmails(customerEmails);
  } else if (['support level changed', 'returned', 'acknowledged', 'severity changed', 'priority changed'].includes(eventKey)) {
    addEmails(stageEmails);
    addEmails(managementEmails);
    if (eventKey === 'returned' && customerStatusVisible) addEmails(customerEmails);
  } else {
    addEmails(stageEmails);
    if (customerStatusVisible && commentVisibility !== 'internal_only' && commentVisibility !== 'partner_visible') addEmails(customerEmails);
  }

  const recipient = [...recipients].join(', ');
  if (!recipient) return null;
  const subject = `${request.requestNumber || 'Request'} ${event}`;
  const statusLabel = request.currentStatus?.customerLabel || request.currentStatus?.name || '';
  const requestUrl = organization?.workspaceSlug
    ? `/${organization.workspaceSlug}/requests/${request._id || request.id}`
    : '';
  const text = `Request: ${request.requestNumber}
Summary: ${request.subject}
Client: ${request.client?.name || ''}
Status: ${statusLabel}
Support level: ${request.currentSupportLevel || ''}

${extra || event}

Regards,
Service Desk`;
  const html = renderMailShell({
    preheader: `${request.requestNumber || 'Request'} ${event}`,
    title: `${request.requestNumber || 'Request'} ${event}`,
    intro: request.subject || 'Request update',
    rows: [
      { label: 'Request', value: request.requestNumber || '—' },
      { label: 'Summary', value: request.subject || '—' },
      { label: 'Client', value: request.client?.name || '—' },
      { label: 'Status', value: statusLabel || '—' },
      { label: 'Support level', value: request.currentSupportLevel || '—' },
      { label: 'Update', value: extra || event }
    ],
    actionUrl: requestUrl,
    actionLabel: 'Open request'
  });
  return safeMailAndAudit(organization, {
    to: recipient,
    subject,
    text,
    html,
    eventType: 'request_mail',
    targetType: 'request',
    targetId: request._id || request.id || '',
    targetLabel: request.requestNumber || '',
    actor,
    metadata: { event, visibility: commentVisibility, recipientCount: recipients.size }
  });
}

function findById(items = [], id) {
  return (items || []).find((item) => String(item._id || item.id || '') === String(id || '')) || null;
}

function makeRef(item, fallbackId = '') {
  if (!item) return { id: String(fallbackId || ''), name: '', code: '' };
  return {
    id: String(item._id || item.id || fallbackId || ''),
    name: String(item.name || ''),
    code: String(item.code || item.shortCode || item.key || '')
  };
}


function issueFieldConfig(issueType = {}) {
  const defaults = { severity: true, priority: true, product: true, module: true, region: true, environment: true };
  return { ...defaults, ...(issueType.fieldsConfig || {}) };
}


function activeCustomFields(issueType = {}) {
  return (issueType.customFields || [])
    .filter((field) => (field.status || 'active') === 'active')
    .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0) || String(a.label || '').localeCompare(String(b.label || '')));
}

function customFieldInputName(field) {
  return `custom_${String(field.fieldKey || '').toUpperCase()}`;
}

function parseMultiValue(value) {
  return toArray(value).map((item) => String(item || '').trim()).filter(Boolean);
}

function customFieldValueFromBody(field, body) {
  const key = customFieldInputName(field);
  let raw = body[key];
  let value = '';
  if (field.fieldType === 'checkbox') value = raw === 'on' || raw === 'true' || raw === true;
  else if (field.fieldType === 'multi_select') value = parseMultiValue(raw);
  else value = String(raw || '').trim();
  const empty = Array.isArray(value) ? value.length === 0 : field.fieldType === 'checkbox' ? value !== true : !String(value || '').trim();
  if (field.required && empty) {
    const error = new Error(`${field.label} is required.`);
    error.status = 400;
    throw error;
  }
  const displayValue = Array.isArray(value) ? value.join(', ') : field.fieldType === 'checkbox' ? (value ? 'Yes' : 'No') : String(value || '');
  if (!field.required && empty) return null;
  return { fieldKey: field.fieldKey, label: field.label, fieldType: field.fieldType, value, displayValue };
}

function slaDefinitionFor(policy) {
  if (!policy) return null;
  return {
    supportWindow: policy.supportWindow || 'business_hours',
    clockStartTrigger: policy.clockStartTrigger || 'severity_selected',
    rules: (policy.rules || []).map((rule) => ({
      ruleBasis: rule.ruleBasis || 'severity',
      severityId: rule.severityId ? String(rule.severityId) : '',
      priorityId: rule.priorityId ? String(rule.priorityId) : '',
      responseTimeValue: rule.responseTimeValue,
      responseTimeUnit: rule.responseTimeUnit,
      resolutionTimeValue: rule.resolutionTimeValue,
      resolutionTimeUnit: rule.resolutionTimeUnit,
      updateFrequencyValue: rule.updateFrequencyValue,
      updateFrequencyUnit: rule.updateFrequencyUnit,
      clockType: rule.clockType,
      notes: rule.notes || ''
    })),
    applicability: {
      applyOnlyWhenSeveritySelected: policy.applicability?.applyOnlyWhenSeveritySelected !== false,
      applicableEnvironmentIds: (policy.applicability?.applicableEnvironmentIds || []).map(String),
      applicableIssueLevelCodes: (policy.applicability?.applicableIssueLevelCodes || ['L2','L3']).map((item) => String(item).toUpperCase())
    }
  };
}

function workflowInitialStatus(workflow) {
  const statuses = [...(workflow?.statuses || [])].filter((status) => status.isActive !== false).sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0));
  const start = statuses.find((status) => status.statusType === 'start') || statuses[0];
  if (!start) {
    return { localId: 'new', name: 'New', customerLabel: 'New', statusType: 'start', isCustomerVisible: true };
  }
  return {
    localId: start.localId,
    name: start.name,
    customerLabel: start.customerLabel || start.name,
    statusType: start.statusType || 'start',
    isCustomerVisible: start.isCustomerVisible !== false,
    taskTemplates: start.taskTemplates || []
  };
}

function workflowDefinitionFrom(workflow = {}) {
  const statuses = (workflow?.statuses || []).filter((status) => status.isActive !== false);
  const ids = new Set(statuses.map((status) => status.localId));
  return { statuses, transitions: (workflow?.transitions || []).filter((item) => ids.has(item.fromStatusId) && ids.has(item.toStatusId)) };
}

function workflowStatusByLocalId(workflow = {}, localId = '') {
  return (workflow?.statuses || []).find((status) => status.localId === localId) || null;
}

function makeTaskInstances({ workflow, status, supportLevel, ownerSide }) {
  const statusItem = workflowStatusByLocalId(workflow, status?.localId) || status || {};
  return [...(statusItem.taskTemplates || [])]
    .sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0))
    .map((template, index) => ({
      localId: `${supportLevel || 'stage'}_${statusItem.localId || 'status'}_${template.localId || index}`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 80),
      title: template.title,
      description: template.description || '',
      ownerSide: template.ownerSide || ownerSide || 'suntec',
      queue: template.queue || '',
      status: 'open',
      visibility: template.visibility || 'internal_only',
      isBlocking: template.isBlocking === true,
      sourceStatusId: statusItem.localId || '',
      sourceStatusName: statusItem.name || statusItem.customerLabel || statusItem.localId || '',
      sourceStageId: supportLevel || '',
      createdByAutomation: true
    }));
}

function makeSupportStage(level = {}, fallbackWorkflow = null, isPrimary = false) {
  const workflow = level.workflow || fallbackWorkflow || null;
  const currentStatus = workflowInitialStatus(workflow);
  return {
    localId: level.localId || 'L1',
    label: level.label || level.localId || 'Support stage',
    ownerSide: level.ownerSide || ownerSideFromSupportLevel(level.localId || 'L1'),
    isPrimary,
    workflow: makeRef(workflow),
    workflowDefinition: workflowDefinitionFrom(workflow),
    currentStatus
  };
}

function supportPathStageForLevel(supportPath = {}, levelId = '') {
  return [...(supportPath?.levels || [])].find((level) => String(level.localId) === String(levelId)) || null;
}

function clientRuleMatches(rule = {}, level2TypeId = '', severityId = '', environmentId = '') {
  if (!rule?.isActive && rule?.isActive !== undefined) return false;
  if (String(rule.level2TypeId || '') !== String(level2TypeId || '')) return false;
  const severityIds = (rule.severityIds || []).map(String).filter(Boolean);
  const environmentIds = (rule.environmentIds || []).map(String).filter(Boolean);
  if (severityIds.length && !severityIds.includes(String(severityId || ''))) return false;
  if (environmentIds.length && !environmentIds.includes(String(environmentId || ''))) return false;
  return true;
}

function resolveClientOperationalRule(client, clientsById, level2TypeId, severityId = '', environmentId = '', seen = new Set()) {
  if (!client) return null;
  const clientId = String(client._id || '');
  if (seen.has(clientId)) return null;
  seen.add(clientId);
  const ownRule = (client.operationalRules || [])
    .filter((rule) => clientRuleMatches(rule, level2TypeId, severityId, environmentId))
    .sort((a, b) => {
      const score = (rule) => ((rule.severityIds || []).length ? 10 : 0) + ((rule.environmentIds || []).length ? 10 : 0)
        - Math.min(5, (rule.severityIds || []).length) - Math.min(5, (rule.environmentIds || []).length);
      return score(b) - score(a);
    })[0] || null;
  if (ownRule) return { rule: ownRule, sourceClient: client };
  if (client.parentClientId) {
    const parent = clientsById.get(String(client.parentClientId));
    const parentResult = resolveClientOperationalRule(parent, clientsById, level2TypeId, severityId, environmentId, seen);
    if (parentResult?.rule?.inheritToChildren !== false) return parentResult;
  }
  return null;
}

function resolveEffectiveSupportPath({ client, clientsById, level2Type, supportPaths = [], severityId = '', environmentId = '' }) {
  const override = resolveClientOperationalRule(client, clientsById, level2Type?._id, severityId, environmentId);
  const supportPathId = override?.rule?.supportPathId || level2Type?.supportPathId || level2Type?.supportPath?._id || level2Type?.supportPath?.id || '';
  const supportPath = supportPaths.find((item) => String(item._id || item.id) === String(supportPathId)) || level2Type?.supportPath || null;
  return { supportPath, override };
}

function actorFromSession(req, portal = 'admin') {
  const isAdmin = portal === 'admin';
  return {
    _id: req.session.actorId || req.session.adminId || 'admin-session',
    name: req.session.actorName || req.session.adminName || 'Service Desk Admin',
    email: req.session.actorEmail || req.session.adminEmail || 'admin@service-desk.local',
    userType: req.session.actorType || (isAdmin ? 'organizationAdmin' : 'serviceUser'),
    portal,
    assignments: req.session.assignments || [],
    clientScopes: req.session.clientScopes || []
  };
}

function portalBasePath(portal = 'admin', tenantSlug = '') {
  if (portal === 'admin') return '/admin';
  return tenantSlug ? `/${tenantSlug}` : `/${portal}`;
}

function portalRequestBasePath(portal = 'admin', tenantSlug = '') {
  return portalBasePath(portal, tenantSlug);
}

function requestListPath(portal = 'admin', tenantSlug = '') {
  return `${portalRequestBasePath(portal, tenantSlug)}/requests`;
}

function requestNewPath(portal = 'admin', tenantSlug = '') {
  return `${portalRequestBasePath(portal, tenantSlug)}/requests/new`;
}

function requestDetailPath(portal = 'admin', requestId = '', tenantSlug = '') {
  return `${portalRequestBasePath(portal, tenantSlug)}/requests/${requestId}`;
}

function taskListPath(portal = 'admin', tenantSlug = '') {
  return `${portalBasePath(portal, tenantSlug)}/tasks`;
}

function taskDetailPath(portal = 'admin', taskId = '', tenantSlug = '') {
  return `${taskListPath(portal, tenantSlug)}/${encodeURIComponent(taskId)}`;
}

function labelFromKey(value = '') {
  return String(value || '')
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function ownerSideFromSupportLevel(level) {
  if (level === 'L2') return 'partner';
  if (level === 'L3') return 'suntec';
  return 'client';
}

function sanitizeChoice(value, allowed, fallback) {
  const candidate = String(value || '').trim();
  return allowed.includes(candidate) ? candidate : fallback;
}


function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function timeLeftLabel(value) {
  if (!value) return '';
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) return '';
  const diff = due.getTime() - Date.now();
  const past = diff < 0;
  const abs = Math.abs(diff);
  const minutes = Math.floor(abs / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  let label = '';
  if (days > 0) label = `${days}d ${hours}h`;
  else if (hours > 0) label = `${hours}h ${mins}m`;
  else label = `${Math.max(1, mins)}m`;
  return past ? `${label} overdue` : `${label} left`;
}

function buildSlaView(sla = {}) {
  const state = sla?.state || 'not_applicable';
  const rag = sla?.rag || 'grey';
  const responseDueAt = sla?.responseDueAt || '';
  const resolutionDueAt = sla?.resolutionDueAt || '';
  let nextAction = 'SLA not active';
  let nextDueAt = '';
  let nextDueLabel = '';
  let nextTimeLeft = '';

  if (state === 'waiting') {
    nextAction = 'Waiting for SLA trigger';
  } else if (state === 'not_applicable') {
    nextAction = 'No SLA action due';
  } else if (state === 'stopped') {
    nextAction = 'SLA stopped';
  } else if (state === 'met') {
    nextAction = 'SLA met';
  } else if (['running', 'at_risk', 'breached'].includes(state)) {
    const responseDate = responseDueAt ? new Date(responseDueAt) : null;
    const resolutionDate = resolutionDueAt ? new Date(resolutionDueAt) : null;
    const now = Date.now();
    if (responseDate && !Number.isNaN(responseDate.getTime()) && responseDate.getTime() > now) {
      nextAction = 'Respond by';
      nextDueAt = responseDate;
    } else if (resolutionDate && !Number.isNaN(resolutionDate.getTime())) {
      nextAction = resolutionDate.getTime() < now ? 'Resolution overdue since' : 'Resolve by';
      nextDueAt = resolutionDate;
    } else if (responseDate && !Number.isNaN(responseDate.getTime())) {
      nextAction = responseDate.getTime() < now ? 'Response overdue since' : 'Respond by';
      nextDueAt = responseDate;
    } else {
      nextAction = 'SLA running';
    }
  }

  if (nextDueAt) {
    nextDueLabel = formatDateTime(nextDueAt);
    nextTimeLeft = timeLeftLabel(nextDueAt);
  }

  return {
    state,
    rag,
    label: state.replaceAll('_', ' '),
    reason: sla?.reason || '',
    policyName: sla?.policyName || '',
    basis: sla?.ruleLabel || '',
    responseDueLabel: formatDateTime(responseDueAt),
    resolutionDueLabel: formatDateTime(resolutionDueAt),
    nextAction,
    nextDueLabel,
    nextTimeLeft
  };
}


function prettyMilestoneState(state = '') {
  const value = String(state || '').replaceAll('_', ' ');
  return value ? value[0].toUpperCase() + value.slice(1) : 'Not started';
}

function buildSlaMilestoneView(milestones = {}) {
  const make = (key, label) => {
    const item = milestones?.[key] || {};
    return {
      key,
      label: item.label || label,
      state: item.state || 'not_started',
      stateLabel: prettyMilestoneState(item.state || 'not_started'),
      rag: item.rag || 'grey',
      dueLabel: item.dueAt ? formatDateTime(item.dueAt) : '—',
      actualLabel: item.actualAt ? formatDateTime(item.actualAt) : '—',
      timeLeft: item.actualAt ? '' : timeLeftLabel(item.dueAt),
      reason: item.reason || ''
    };
  };
  const rows = [make('response', 'Response'), make('resolution', 'Resolution'), make('update', 'Next update')];
  const next = rows
    .filter((row) => ['running', 'at_risk', 'breached'].includes(row.state) && row.dueLabel !== '—')
    .sort((a, b) => {
      const rawA = milestones?.[a.key]?.dueAt ? new Date(milestones[a.key].dueAt).getTime() : Infinity;
      const rawB = milestones?.[b.key]?.dueAt ? new Date(milestones[b.key].dueAt).getTime() : Infinity;
      return rawA - rawB;
    })[0];
  return { rows, next };
}

function buildRoleDashboard({ portal, actor, visibleRequests = [], scopedClients = [], clientAssignments = new Map(), portalBase = '' }) {
  const roles = new Set();
  for (const assignments of clientAssignments.values()) {
    (assignments || []).forEach((assignment) => roles.add(assignment.role));
  }
  const has = (role) => roles.has(role);
  let title = 'Your service desk';
  let subtitle = 'Raise requests and track what is visible to you.';

  if (portal === 'client') {
    title = 'Your request workspace';
    subtitle = 'Track client-visible requests and respond when action is needed.';
  } else if (has('partnerUser')) {
    title = 'Partner operations queue';
    subtitle = 'Focus on L2 work, SLA risk, and requests that need partner action.';
  } else if (has('agentManager')) {
    title = 'Support manager view';
    subtitle = 'Watch queues, SLA risk, and workload across your assigned clients.';
  } else if (has('engagementManager')) {
    title = 'Client health view';
    subtitle = 'Monitor client-visible issues, internal tracking, and service health.';
  } else if (portal === 'agent') {
    title = 'Agent workbench';
    subtitle = 'Work on requests assigned to your support scope.';
  }

  const open = visibleRequests.filter((item) => !['closed', 'cancelled'].includes(item.lifecycleState)).length;
  const atRisk = visibleRequests.filter((item) => ['amber', 'red'].includes(item.sla?.rag)).length;
  const waiting = visibleRequests.filter((item) => String(item.currentStatus?.customerLabel || item.currentStatus?.name || '').toLowerCase().includes('waiting')).length;
  const l2 = visibleRequests.filter((item) => item.currentSupportLevel === 'L2').length;
  const l3 = visibleRequests.filter((item) => item.currentSupportLevel === 'L3').length;
  const clientVisible = visibleRequests.filter((item) => (item.visibilityScope || 'client_visible') === 'client_visible').length;

  const cards = portal === 'client'
    ? [
        { label: 'Open requests', value: open, hint: 'Visible to you', href: `${portalBase}/requests` },
        { label: 'Waiting for you', value: waiting, hint: 'Needs client action', href: `${portalBase}/requests` },
        { label: 'SLA attention', value: atRisk, hint: 'At risk or breached', href: `${portalBase}/requests` },
        { label: 'Clients', value: scopedClients.length, hint: 'Your access scope', href: `${portalBase}/requests/new` }
      ]
    : [
        { label: has('partnerUser') ? 'L2 queue' : 'Open requests', value: has('partnerUser') ? l2 : open, hint: has('partnerUser') ? 'Partner owned' : 'In your scope', href: `${portalBase}/requests` },
        { label: 'SLA attention', value: atRisk, hint: 'Amber or red', href: `${portalBase}/requests` },
        { label: has('agentManager') || has('agentUser') ? 'L3 work' : 'Client-visible', value: has('agentManager') || has('agentUser') ? l3 : clientVisible, hint: has('agentManager') || has('agentUser') ? 'SunTec owned' : 'Customer-facing', href: `${portalBase}/requests` },
        { label: 'Clients', value: scopedClients.length, hint: 'Assigned scope', href: `${portalBase}/requests/new` }
      ];

  return { title, subtitle, cards, roles: [...roles] };
}


function dashboardRange(query = {}) {
  const selected = String(query.range || '30d').toLowerCase();
  const now = new Date();
  let days = 30;
  if (selected === '1w') days = 7;
  else if (selected === '2w') days = 14;
  else if (selected === '90d') days = 90;
  else if (selected === '180d') days = 180;
  else if (selected === '365d') days = 365;
  else if (selected === 'custom') {
    const from = query.from ? new Date(query.from) : new Date(now.getTime() - 30 * 86400000);
    const to = query.to ? new Date(query.to) : now;
    return {
      key: 'custom',
      from: Number.isNaN(from.getTime()) ? new Date(now.getTime() - 30 * 86400000) : from,
      to: Number.isNaN(to.getTime()) ? now : to
    };
  }
  return { key: selected, from: new Date(now.getTime() - days * 86400000), to: now };
}

function dateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

function daySeries(from, to) {
  const days = [];
  const cursor = new Date(Date.UTC(from.getFullYear(), from.getMonth(), from.getDate()));
  const end = new Date(Date.UTC(to.getFullYear(), to.getMonth(), to.getDate()));
  while (cursor <= end && days.length < 370) {
    days.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

function groupTop(items = [], keyFn, limit = 8) {
  const counts = new Map();
  items.forEach((item) => {
    const key = keyFn(item) || 'Not set';
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([label, value]) => ({ label, value }));
}

function countByFixed(items = [], values = [], keyFn = () => '') {
  const counts = new Map(values.map((value) => [value, 0]));
  items.forEach((item) => {
    const key = keyFn(item) || values[0] || 'unknown';
    if (!counts.has(key)) counts.set(key, 0);
    counts.set(key, counts.get(key) + 1);
  });
  return [...counts.entries()].map(([label, value]) => ({ label, value }));
}

function milestoneState(item = {}, key = 'response') {
  const milestone = item.slaMilestones?.[key] || {};
  if (milestone.state) return milestone.state;
  if (milestone.actualAt) return 'met';
  if (milestone.dueAt) return new Date(milestone.dueAt).getTime() < Date.now() ? 'breached' : 'running';
  return 'not_applicable';
}

function requestRiskRank(item = {}) {
  const rag = item.sla?.rag || item.slaMilestones?.resolution?.rag || 'grey';
  if (rag === 'red') return 1;
  if (rag === 'amber') return 2;
  if (rag === 'green') return 3;
  return 4;
}

function buildCalendarPulse(requests = [], now = new Date()) {
  const point = new Date(now);
  const todayStart = new Date(Date.UTC(point.getUTCFullYear(), point.getUTCMonth(), point.getUTCDate()));
  const mondayOffset = (todayStart.getUTCDay() + 6) % 7;
  const weekStart = new Date(todayStart);
  weekStart.setUTCDate(weekStart.getUTCDate() - mondayOffset);
  const monthStart = new Date(Date.UTC(point.getUTCFullYear(), point.getUTCMonth(), 1));
  const validCreated = (item) => {
    const value = new Date(item.createdAt || 0);
    return Number.isNaN(value.getTime()) ? null : value;
  };
  const countCreatedSince = (start) => requests.filter((item) => {
    const created = validCreated(item);
    return created && created.getTime() >= start.getTime() && created.getTime() <= point.getTime();
  }).length;
  const openNow = requests.filter((item) => !['closed', 'cancelled'].includes(String(item.lifecycleState || 'open').toLowerCase())).length;
  const resolvedThisMonth = requests.filter((item) => {
    if (!['resolved', 'closed'].includes(String(item.lifecycleState || '').toLowerCase())) return false;
    const changed = new Date(item.updatedAt || item.createdAt || 0);
    return !Number.isNaN(changed.getTime()) && changed.getTime() >= monthStart.getTime() && changed.getTime() <= point.getTime();
  }).length;
  const slaAttention = requests.filter((item) => ['amber', 'red'].includes(String(item.sla?.rag || '').toLowerCase())).length;
  return {
    today: countCreatedSince(todayStart),
    week: countCreatedSince(weekStart),
    month: countCreatedSince(monthStart),
    openNow,
    resolvedThisMonth,
    slaAttention,
    asOf: point
  };
}

function buildDashboardAnalytics(requests = [], range = dashboardRange()) {
  const days = daySeries(range.from, range.to);
  const raisedMap = new Map(days.map((day) => [day, 0]));
  const redMap = new Map(days.map((day) => [day, 0]));
  const amberMap = new Map(days.map((day) => [day, 0]));
  requests.forEach((item) => {
    const key = dateKey(item.createdAt);
    if (raisedMap.has(key)) raisedMap.set(key, raisedMap.get(key) + 1);
    const rag = item.sla?.rag || 'grey';
    if (rag === 'red' && redMap.has(key)) redMap.set(key, redMap.get(key) + 1);
    if (rag === 'amber' && amberMap.has(key)) amberMap.set(key, amberMap.get(key) + 1);
  });
  const raisedPerDay = [...raisedMap.entries()].map(([label, value]) => ({ label, value }));
  const openByDay = days.map((day) => {
    const dayEnd = new Date(`${day}T23:59:59.999Z`).getTime();
    const value = requests.filter((item) => {
      const created = new Date(item.createdAt).getTime();
      if (Number.isNaN(created) || created > dayEnd) return false;
      if (!['closed', 'cancelled'].includes(item.lifecycleState || 'open')) return true;
      const updated = new Date(item.updatedAt || item.createdAt).getTime();
      return updated > dayEnd;
    }).length;
    return { label: day, value };
  });
  const slaRiskTrend = days.map((day) => ({
    label: day,
    red: redMap.get(day) || 0,
    amber: amberMap.get(day) || 0,
    total: (redMap.get(day) || 0) + (amberMap.get(day) || 0)
  }));
  const riskRequests = requests
    .filter((item) => ['red', 'amber'].includes(item.sla?.rag || ''))
    .sort((a, b) => requestRiskRank(a) - requestRiskRank(b) || new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime());
  const topSlaClients = groupTop(riskRequests, (item) => item.client?.name, 8);
  const attentionQueue = riskRequests.slice(0, 8).map((item) => {
    const slaView = buildSlaView(item.sla || {});
    return {
      id: String(item._id || item.id || ''),
      requestNumber: item.requestNumber,
      subject: item.subject,
      client: item.client?.name || '—',
      rag: item.sla?.rag || 'grey',
      nextAction: slaView.nextAction,
      nextDue: slaView.nextDueLabel || '—',
      supportLevel: item.currentSupportLevel || 'L1'
    };
  });
  const closedRequests = requests.filter((item) => ['closed', 'resolved'].includes(item.lifecycleState || ''));
  return {
    raisedPerDay,
    openByDay,
    slaRiskTrend,
    topSlaClients,
    attentionQueue,
    closedRequests: closedRequests.slice(0, 8).map((item) => ({
      id: String(item._id || item.id || ''),
      requestNumber: item.requestNumber,
      subject: item.subject,
      client: item.client?.name || '—',
      status: item.currentStatus?.name || 'Closed',
      resolution: milestoneState(item, 'resolution')
    })),
    byClient: groupTop(requests, (item) => item.client?.name),
    byFamily: groupTop(requests, (item) => item.level1Type?.name || item.level1Type?.key || 'Not set'),
    byStatus: groupTop(requests, (item) => item.currentStatus?.name || item.currentStatus?.customerLabel || 'Not set'),
    byAssignee: groupTop(requests, (item) => {
      const active = (item.activeStages || []).find((stage) => stage.isPrimary) || (item.activeStages || [])[0] || null;
      return active?.assignedTo?.name || active?.assignedTo?.email || 'Unassigned';
    }),
    byAgent: groupTop(requests, (item) => {
      const active = (item.activeStages || []).find((stage) => stage.isPrimary) || (item.activeStages || [])[0] || null;
      return active?.assignedTo?.name || active?.assignedTo?.email || 'Unassigned';
    }),
    bySla: countByFixed(requests, ['red', 'amber', 'green', 'grey'], (item) => item.sla?.rag || 'grey').map((item) => ({ label: item.label.toUpperCase(), value: item.value })),
    bySupportLevel: groupTop(requests, (item) => item.currentSupportLevel || 'L1', 4),
    byResponseState: countByFixed(requests, ['met', 'breached', 'running', 'not_applicable'], (item) => milestoneState(item, 'response')),
    byResolutionState: countByFixed(requests, ['met', 'breached', 'running', 'not_applicable'], (item) => milestoneState(item, 'resolution'))
  };
}

function periodHref(base, key, range = {}) {
  const search = new URLSearchParams({ range: key });
  if (key === 'custom') {
    if (range.from) search.set('from', String(range.from).slice(0, 10));
    if (range.to) search.set('to', String(range.to).slice(0, 10));
  }
  return `${base}?${search.toString()}`;
}

function requestQueryParams(query = {}) {
  return {
    page: Number.parseInt(query.page || '1', 10) || 1,
    pageSize: 50,
    search: String(query.search || '').trim(),
    status: String(query.status || '').trim(),
    sla: String(query.sla || '').trim(),
    supportLevel: String(query.supportLevel || '').trim(),
    visibility: String(query.visibility || '').trim(),
    mine: String(query.mine || '').trim(),
    fromFilters: String(query.fromFilters || '').trim(),
    activeFilter: String(query.activeFilter || '').trim()
  };
}

function withQuery(base, params = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value).trim() !== '') search.set(key, String(value));
  });
  return `${base}${search.toString() ? `?${search.toString()}` : ''}`;
}

function summarizeRequest(request, portal = 'admin', assignment = null) {
  const created = request.createdAt ? new Date(request.createdAt) : null;
  const updated = request.updatedAt ? new Date(request.updatedAt) : created;
  const primaryStage = (request.activeStages || []).find((stage) => stage.isPrimary) || (request.activeStages || [])[0] || null;
  const visibilityScope = request.visibilityScope || 'client_visible';
  const source = request.source || (request.sourcePortal === 'client' ? 'client_portal' : 'internal_observed');
  const currentSupportLevel = request.currentSupportLevel || 'L1';
  const statusLabel = portal === 'client'
    ? (request.currentStatus?.customerLabel || request.currentStatus?.name || 'New')
    : (request.currentStatus?.name || request.currentStatus?.customerLabel || 'New');
  return {
    ...request,
    visibilityScope,
    visibilityLabel: visibilityScope === 'client_visible' ? 'Client visible' : visibilityScope === 'partner_visible' ? 'Partner + SunTec' : 'SunTec internal',
    visibilityClass: visibilityScope === 'client_visible' ? 'good' : visibilityScope === 'partner_visible' ? 'warn' : 'dark',
    source,
    sourceLabel: source === 'client_portal' ? 'Client portal' : source === 'client_asked_agent' ? 'Raised for client' : source === 'partner_observed' ? 'Partner/team observed' : source === 'system_alert' ? 'System alert' : 'Internal observed',
    supportLevelLabel: `${currentSupportLevel} · ${(request.ownerSide || ownerSideFromSupportLevel(currentSupportLevel)) === 'suntec' ? 'SunTec Support' : (request.ownerSide || ownerSideFromSupportLevel(currentSupportLevel)) === 'partner' ? 'Partner / Operations' : 'Client / Bank'}`,
    createdLabel: created && !Number.isNaN(created.getTime()) ? created.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '',
    updatedShortLabel: updated && !Number.isNaN(updated.getTime()) ? updated.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '',
    currentAssignee: primaryStage?.assignedTo || {},
    statusLabel,
    internalStatusLabel: request.currentStatus?.name || 'New',
    clientStatusLabel: request.currentStatus?.customerLabel || request.currentStatus?.name || 'New',
    slaView: buildSlaView(request.sla || {}),
    slaMilestoneView: buildSlaMilestoneView(request.slaMilestones || {}),
    comments: request.comments || [],
    actingRole: assignment?.role || '',
    actingRoleLabel: ROLE_LABELS[assignment?.role] || ''
  };
}

async function resolvePortalAccess(req, portal) {
  if (!req.session.organizationId || req.session.portal !== portal) {
    return { organization: null, actor: null, allowed: false };
  }
  const { organization } = await getOrganization(req.session.organizationId);
  const actor = actorFromSession(req, portal);
  const hasRole = portal === 'admin'
    ? actor.userType === 'organizationAdmin'
    : assignmentsForPortal(actor, portal).length > 0;
  return { organization, actor, allowed: hasRole };
}

async function getRequestPageContext({ organization, actor, portal = 'admin' }) {
  const [{ clients, tree: clientTree }, { tree }, workflowsResponse, supportPathsResponse, configResponse] = await Promise.all([
    listClients(organization._id),
    listIssueTypes(organization._id),
    listWorkflows(organization._id),
    listSupportPaths(organization._id),
    getOperationalConfig(organization._id)
  ]);

  const flatClients = clients || flattenClientTree(clientTree || []);
  const accessibleClients = portal === 'admin' ? flatClients : resolveUserScopedClients(actor, flatClients, portal);
  const clientsById = makeClientMap(flatClients);

  return {
    clients: flatClients,
    accessibleClients,
    clientsById,
    clientTree: clientTree || [],
    issueTree: tree || [],
    workflows: workflowsResponse.workflows || [],
    supportPaths: supportPathsResponse.supportPaths || [],
    severities: configResponse.severities || [],
    priorities: configResponse.priorities || [],
    products: configResponse.products || [],
    modules: configResponse.modules || [],
    regions: configResponse.regions || [],
    environments: configResponse.environments || [],
    slaPolicies: configResponse.slaPolicies || []
  };
}

function configuredLevel2ForRequest(request = {}, context = {}) {
  return (context.issueTree || [])
    .flatMap((family) => family.children || [])
    .find((item) => String(item._id) === String(request.level2Type?.id || '')) || null;
}

function configuredLevel3ForRequest(request = {}, context = {}) {
  const level3Id = String(request.level3Type?.id || '');
  if (!level3Id) return null;
  for (const family of context.issueTree || []) {
    for (const issueType of family.children || []) {
      const subtype = (issueType.children || []).find((item) => String(item._id) === level3Id);
      if (subtype) return subtype;
    }
  }
  return null;
}

function configuredBehaviorForRequest(request = {}, context = {}) {
  const issueType = configuredLevel2ForRequest(request, context);
  const subtype = configuredLevel3ForRequest(request, context);
  return effectiveTaxonomyNode(issueType || {}, subtype);
}

function currentSupportPathForRequest(request = {}, context = {}) {
  const directId = request.supportPath?.id || request.supportPath?._id || '';
  if (directId) {
    const direct = (context.supportPaths || []).find((item) => String(item._id) === String(directId));
    if (direct) return direct;
  }
  const configuredBehavior = configuredBehaviorForRequest(request, context);
  const configuredPath = configuredBehavior?.supportPath || null;
  if (!configuredPath) return null;
  if (Array.isArray(configuredPath.levels) && configuredPath.levels.length) return configuredPath;
  const configuredId = configuredPath._id || configuredPath.id || configuredBehavior?.supportPathId || '';
  return (context.supportPaths || []).find((item) => String(item._id) === String(configuredId)) || null;
}

function supportPathDefinitionForRequest(request = {}, context = {}) {
  const supportPath = currentSupportPathForRequest(request, context);
  if (supportPath?.levels?.length) {
    return { levels: supportPath.levels || [], movementRules: supportPath.movementRules || [] };
  }
  return request.supportPathDefinition?.levels?.length
    ? request.supportPathDefinition
    : { levels: [], movementRules: [] };
}

function effectiveStageAgainstPath(stage = null, supportPath = null) {
  if (!stage) return null;
  const configured = (supportPath?.levels || []).find((level) => String(level.localId) === String(stage.localId));
  if (!configured) return stage;
  return {
    ...stage,
    label: configured.label || stage.label,
    ownerSide: configured.ownerSide || stage.ownerSide,
    workflow: configured.workflow ? makeRef(configured.workflow) : stage.workflow,
    configuredWorkflowDefinition: configured.workflowDefinition || null
  };
}

function stageAssignmentIsEligible(stage = {}, eligible = []) {
  const owner = stage?.assignedTo || {};
  if (!(owner.actorId || owner.email)) return false;
  const ownerId = String(owner.actorId || '');
  const ownerEmail = String(owner.email || '').toLowerCase();
  return (eligible || []).some((user) =>
    (ownerId && String(user._id) === ownerId)
    || (ownerEmail && String(user.email || '').toLowerCase() === ownerEmail)
  );
}

function supportOwnerLabel(ownerSide = 'client') {
  if (ownerSide === 'suntec') return 'SunTec Support';
  if (ownerSide === 'partner') return 'Partner / Operations';
  return 'Client / Bank';
}

function applyCurrentSupportConfiguration(summary = {}, request = {}, context = {}) {
  const supportPath = currentSupportPathForRequest(request, context);
  const rawPrimary = (request.activeStages || []).find((stage) => stage.isPrimary) || (request.activeStages || [])[0] || null;
  const effectivePrimary = effectiveStageAgainstPath(rawPrimary, supportPath);
  if (!effectivePrimary) return summary;
  const level = effectivePrimary.localId || request.currentSupportLevel || 'L1';
  const ownerSide = effectivePrimary.ownerSide || request.ownerSide || ownerSideFromSupportLevel(level);
  return {
    ...summary,
    ownerSide,
    supportLevelLabel: `${level} · ${supportOwnerLabel(ownerSide)}`,
    currentAssignee: effectivePrimary.assignedTo || {}
  };
}

function selectedRequestCreationState(req, context, portal = 'admin') {
  const skipClientStep = portal === 'client' && context.accessibleClients.length === 1;
  const selectedClientId = req.query.clientId || (skipClientStep ? context.accessibleClients[0]?._id : '');
  const selectedClient = findById(context.accessibleClients, selectedClientId);
  const activeTree = selectedClient ? activeTreeForClient(context.issueTree, selectedClient, context.clients) : [];

  let selectedLevel1Id = req.query.level1TypeId || '';
  if (!selectedLevel1Id && activeTree.length === 1) selectedLevel1Id = String(activeTree[0]._id);
  const selectedLevel1 = activeTree.find((item) => String(item._id) === String(selectedLevel1Id)) || null;

  let selectedLevel2Id = req.query.level2TypeId || '';
  if (!selectedLevel2Id && selectedLevel1 && (selectedLevel1.children || []).length === 1) selectedLevel2Id = String(selectedLevel1.children[0]._id);
  const selectedLevel2 = (selectedLevel1?.children || []).find((item) => String(item._id) === String(selectedLevel2Id)) || null;

  let selectedLevel3Id = req.query.level3TypeId || '';
  if (!selectedLevel3Id && selectedLevel2 && (selectedLevel2.children || []).length === 1) selectedLevel3Id = String(selectedLevel2.children[0]._id);
  const selectedLevel3 = (selectedLevel2?.children || []).find((item) => String(item._id) === String(selectedLevel3Id)) || null;
  const behaviorNode = effectiveTaxonomyNode(selectedLevel2 || {}, selectedLevel3);

  const supportResolution = selectedClient && selectedLevel2
    ? resolveEffectiveSupportPath({ client: selectedClient, clientsById: context.clientsById, level2Type: { ...selectedLevel2, supportPathId: behaviorNode.supportPathId, supportPath: behaviorNode.supportPath }, supportPaths: context.supportPaths })
    : { supportPath: null, override: null };
  const supportPath = supportResolution.supportPath || null;
  const supportLevels = [...(supportPath?.levels || [])].sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0));
  const activeAssignment = selectedClient ? bestAssignmentForClient(actorFromSession(req, portal), selectedClient._id, context.clients, portal) : null;
  const preferredLevel = activeAssignment?.supportLevels?.[0];
  const defaultSupportLevel = preferredLevel
    || (portal === 'client'
      ? (supportLevels.find((item) => item.ownerSide === 'client')?.localId || supportLevels[0]?.localId || 'L1')
      : portal === 'agent'
        ? (activeAssignment?.role === 'partnerUser' ? 'L2' : 'L3')
        : (supportLevels.find((item) => item.ownerSide === 'suntec')?.localId || supportLevels.at(-1)?.localId || 'L3'));
  const stage = supportPathStageForLevel(supportPath, defaultSupportLevel) || supportLevels[0] || null;
  const workflow = stage?.workflow || behaviorNode?.workflow || null;
  const initialStatus = workflowInitialStatus(workflow);
  const fieldConfig = issueFieldConfig(behaviorNode || {});
  const isSaasIncidentIntake = taxonomyNodeIsIncident(selectedLevel2 || {}) || isV23SaasIncidentBehaviorNode(behaviorNode || {}, selectedLevel2 || {});
  const isV23SaasIntake = isV23SaasBehaviorNode(behaviorNode || {}) || isSaasIncidentIntake;
  const customFieldDefinitions = filterClientIncidentLifecycleFields(activeCustomFields(behaviorNode || {}), { portal, behaviorNode, issueType: selectedLevel2, incident: isSaasIncidentIntake });
  const effectiveSlaPolicyId = selectedClient ? resolveEffectiveSlaPolicyId(selectedClient, context.clientsById, selectedLevel1?._id) : '';
  const familySlaPolicy = effectiveSlaPolicyId ? findById(context.slaPolicies || [], effectiveSlaPolicyId) : null;
  const effectiveSlaPolicy = behaviorNode?.slaApplicable === false ? null : (behaviorNode?.slaPolicy || familySlaPolicy);
  const productConfig = selectedClient ? resolveEffectiveProductConfig(selectedClient, context.clientsById) : { productIds: [], moduleIds: [] };
  const effectiveProductIds = new Set(productConfig.productIds.map(String));
  const effectiveModuleIds = new Set(productConfig.moduleIds.map(String));
  const productOptions = fieldConfig.product && effectiveProductIds.size ? context.products.filter((product) => effectiveProductIds.has(String(product._id))) : [];
  const moduleOptions = fieldConfig.module && effectiveModuleIds.size ? context.modules.filter((module) => effectiveModuleIds.has(String(module._id))) : [];
  const regionOptions = fieldConfig.region && selectedClient?.regionId ? context.regions.filter((region) => String(region._id) === String(selectedClient.regionId)) : [];
  const effectiveEnvironmentIds = new Set((selectedClient ? resolveEffectiveEnvironmentIds(selectedClient, context.clientsById) : []).map(String));
  const environmentOptions = fieldConfig.environment && effectiveEnvironmentIds.size ? context.environments.filter((environment) => effectiveEnvironmentIds.has(String(environment._id))) : [];
  const showClientSearch = portal === 'admin' && (context.accessibleClients || []).length > 10;
  const defaultSource = portal === 'client'
    ? 'client_portal'
    : activeAssignment?.role === 'partnerUser'
      ? 'partner_observed'
      : 'internal_observed';
  const defaultVisibilityScope = portal === 'client'
    ? 'client_visible'
    : defaultSource === 'client_asked_agent'
      ? 'client_visible'
      : activeAssignment?.role === 'partnerUser'
        ? 'partner_visible'
        : 'internal_only';

  const showClientStep = !skipClientStep;
  let currentStep = 'client';
  if (!showClientStep || selectedClient) currentStep = 'family';
  if (selectedClient && selectedLevel1) currentStep = 'issueType';
  if (selectedClient && selectedLevel1 && selectedLevel2) currentStep = (selectedLevel2.children || []).length ? 'subtype' : 'details';
  if (selectedClient && selectedLevel1 && selectedLevel2 && ((selectedLevel2.children || []).length === 0 || selectedLevel3)) currentStep = 'details';

  return {
    selectedClient,
    activeTree,
    selectedLevel1,
    selectedLevel2,
    selectedLevel3,
    behaviorNode,
    workflow,
    supportPath,
    supportResolution,
    supportLevels,
    defaultSupportLevel,
    defaultSource,
    defaultVisibilityScope,
    activeAssignment,
    initialStatus,
    fieldConfig,
    customFieldDefinitions,
    isV23SaasIntake,
    isSaasIncidentIntake,
    effectiveSlaPolicy,
    productOptions,
    moduleOptions,
    regionOptions,
    environmentOptions,
    showClientSearch,
    showClientStep,
    currentStep
  };
}

function buildRequestPayload({ req, organization, portal, actor, context }) {
  const client = findById(context.accessibleClients, req.body.clientId);
  if (!client) {
    const error = new Error('You do not have access to this client.');
    error.status = 403;
    throw error;
  }

  const activeTree = activeTreeForClient(context.issueTree, client, context.clients);
  const level1Type = activeTree.find((item) => String(item._id) === String(req.body.level1TypeId));
  if (!level1Type) {
    const error = new Error('This Level 1 issue type is not enabled for the selected client.');
    error.status = 400;
    throw error;
  }

  const level2Type = (level1Type.children || []).find((item) => String(item._id) === String(req.body.level2TypeId));
  if (!level2Type) {
    const error = new Error('Select a valid Issue Type.');
    error.status = 400;
    throw error;
  }

  const configuredSubtypes = level2Type.children || [];
  const level3Type = configuredSubtypes.find((item) => String(item._id) === String(req.body.level3TypeId)) || null;
  if (configuredSubtypes.length && !level3Type) {
    const error = new Error('Select a valid Subtype.');
    error.status = 400;
    throw error;
  }
  const behaviorNode = effectiveTaxonomyNode(level2Type, level3Type);
  const isSaasIncidentIntake = taxonomyNodeIsIncident(level2Type) || isV23SaasIncidentBehaviorNode(behaviorNode, level2Type);
  const fallbackWorkflow = behaviorNode.workflow || null;
  const fieldConfig = issueFieldConfig(behaviorNode);
  const customFieldDefinitions = filterClientIncidentLifecycleFields(activeCustomFields(behaviorNode), { portal, behaviorNode, issueType: level2Type, incident: isSaasIncidentIntake });
  const customFieldValues = customFieldDefinitions.map((field) => customFieldValueFromBody(field, req.body)).filter(Boolean);
  const effectiveSlaPolicyId = resolveEffectiveSlaPolicyId(client, context.clientsById, level1Type._id);
  const familySlaPolicy = effectiveSlaPolicyId ? findById(context.slaPolicies || [], effectiveSlaPolicyId) : null;
  const effectiveSlaPolicy = behaviorNode.slaApplicable === false ? null : (behaviorNode.slaPolicy || familySlaPolicy);
  const productConfig = resolveEffectiveProductConfig(client, context.clientsById);
  const allowedProductIds = new Set(productConfig.productIds.map(String));
  const allowedModuleIds = new Set(productConfig.moduleIds.map(String));
  const submittedModuleIds = toArray(req.body.moduleIds || req.body.moduleId).map(String).filter(Boolean);
  if (fieldConfig.product && req.body.productId && (!allowedProductIds.size || !allowedProductIds.has(String(req.body.productId)))) {
    const error = new Error('Selected product is not enabled for this client.');
    error.status = 400;
    throw error;
  }
  if (fieldConfig.module && submittedModuleIds.some((moduleId) => !allowedModuleIds.size || !allowedModuleIds.has(String(moduleId)))) {
    const error = new Error('One or more selected modules are not enabled for this client.');
    error.status = 400;
    throw error;
  }
  const effectiveEnvironmentIds = new Set(resolveEffectiveEnvironmentIds(client, context.clientsById).map(String));
  if (fieldConfig.region && req.body.regionId && String(client.regionId || '') !== String(req.body.regionId)) {
    const error = new Error('Selected region is not configured for this client.');
    error.status = 400;
    throw error;
  }
  if (fieldConfig.environment && req.body.environmentId && (!effectiveEnvironmentIds.size || !effectiveEnvironmentIds.has(String(req.body.environmentId)))) {
    const error = new Error('Selected environment is not enabled for this client.');
    error.status = 400;
    throw error;
  }
  const submittedSeverityId = req.body.severityId;
  const severity = fieldConfig.severity ? findById(context.severities, submittedSeverityId) : null;
  if (fieldConfig.severity && submittedSeverityId && !severity) {
    const error = new Error('Select a valid Severity.');
    error.status = 400;
    throw error;
  }
  const priority = portal !== 'client' && fieldConfig.priority ? findById(context.priorities, req.body.priorityId) : null;
  const product = fieldConfig.product ? findById(context.products, req.body.productId) : null;
  const selectedModules = fieldConfig.module ? submittedModuleIds.map((moduleId) => findById(context.modules, moduleId)).filter(Boolean) : [];
  const module = selectedModules[0] || null;
  const region = fieldConfig.region ? findById(context.regions, req.body.regionId || client.regionId) : null;
  const environment = fieldConfig.environment ? findById(context.environments, req.body.environmentId) : null;
  const supportResolution = resolveEffectiveSupportPath({
    client,
    clientsById: context.clientsById,
    level2Type: { ...level2Type, supportPathId: behaviorNode.supportPathId, supportPath: behaviorNode.supportPath },
    supportPaths: context.supportPaths,
    severityId: submittedSeverityId,
    environmentId: req.body.environmentId
  });
  const supportPath = supportResolution.supportPath || null;

  const configuredLevels = [...(supportPath?.levels || [])].sort((a, b) => Number(a.displayOrder || 0) - Number(b.displayOrder || 0));
  const activeAssignment = portal === 'admin' ? null : bestAssignmentForClient(actor, client._id, context.clients, portal);
  const defaultSource = portal === 'client'
    ? 'client_portal'
    : activeAssignment?.role === 'partnerUser'
      ? 'partner_observed'
      : 'internal_observed';
  const source = portal === 'client'
    ? 'client_portal'
    : sanitizeChoice(req.body.source, ['client_asked_agent', 'partner_observed', 'internal_observed', 'system_alert'], defaultSource);
  const defaultVisibility = portal === 'client'
    ? 'client_visible'
    : source === 'client_asked_agent'
      ? 'client_visible'
      : activeAssignment?.role === 'partnerUser'
        ? 'partner_visible'
        : 'internal_only';
  const visibilityScope = portal === 'client'
    ? 'client_visible'
    : sanitizeChoice(req.body.visibilityScope, ['client_visible', 'partner_visible', 'internal_only'], defaultVisibility);
  const assignmentDefaultLevel = activeAssignment?.supportLevels?.[0];
  const defaultLevel = assignmentDefaultLevel || (portal === 'client'
    ? (configuredLevels.find((item) => item.ownerSide === 'client')?.localId || configuredLevels[0]?.localId || 'L1')
    : visibilityScope === 'partner_visible'
      ? (configuredLevels.find((item) => item.ownerSide === 'partner')?.localId || 'L2')
      : (configuredLevels.find((item) => item.ownerSide === 'suntec')?.localId || configuredLevels.at(-1)?.localId || 'L3'));
  const currentSupportLevel = portal === 'client'
    ? defaultLevel
    : sanitizeChoice(req.body.currentSupportLevel, configuredLevels.map((item) => item.localId).length ? configuredLevels.map((item) => item.localId) : ['L1', 'L2', 'L3'], defaultLevel);
  const configuredLevel = configuredLevels.find((item) => item.localId === currentSupportLevel)
    || configuredLevels[0]
    || { localId: currentSupportLevel, label: currentSupportLevel, ownerSide: ownerSideFromSupportLevel(currentSupportLevel) };
  const workflow = configuredLevel?.workflow || fallbackWorkflow || null;
  const initialStatus = workflowInitialStatus(workflow);
  const ownerSide = configuredLevel?.ownerSide || ownerSideFromSupportLevel(currentSupportLevel);
  const primaryStage = makeSupportStage(configuredLevel, fallbackWorkflow, true);
  const initialTasks = makeTaskInstances({ workflow, status: initialStatus, supportLevel: configuredLevel.localId, ownerSide });

  return {
    subject: req.body.subject,
    description: req.body.description,
    client: makeRef(client),
    level1Type: makeRef(level1Type),
    level2Type: makeRef(level2Type),
    level3Type: makeRef(level3Type),
    taxonomyVersion: '23.1',
    workflow: makeRef(workflow),
    workflowDefinition: workflowDefinitionFrom(workflow),
    supportPath: makeRef(supportPath),
    supportPathDefinition: { levels: supportPath?.levels || [], movementRules: supportPath?.movementRules || [] },
    slaPolicy: makeRef(effectiveSlaPolicy),
    slaDefinition: slaDefinitionFor(effectiveSlaPolicy),
    slaCalendar: resolveEffectiveBusinessCalendar(client, context.clientsById),
    customFieldValues,
    currentStatus: initialStatus,
    activeStages: [primaryStage],
    tasks: initialTasks,
    severity: makeRef(severity, submittedSeverityId),
    priority: makeRef(priority, req.body.priorityId),
    product: makeRef(product, req.body.productId),
    module: makeRef(module, submittedModuleIds[0]),
    modules: selectedModules.map((item) => makeRef(item)),
    region: makeRef(region, req.body.regionId),
    environment: makeRef(environment, req.body.environmentId),
    attachments: String(req.body.attachmentNames || '')
      .split('||')
      .map((name) => name.trim())
      .filter(Boolean)
      .map((fileName) => ({ fileName })),
    requester: {
      actorId: String(actor._id || ''),
      name: actor.name,
      email: actor.email,
      userType: activeAssignment?.role || actor.userType,
      portal
    },
    v23CustomFields: collectV23CustomFieldsFromBody(req.body),
    raisedOnBehalfOf: portal === 'client' ? {} : {
      name: String(req.body.raisedOnBehalfOfName || '').trim(),
      email: String(req.body.raisedOnBehalfOfEmail || '').trim().toLowerCase(),
      userType: source === 'client_asked_agent' ? 'client contact' : '',
      portal: 'client'
    },
    sourcePortal: portal,
    source,
    visibilityScope,
    currentSupportLevel,
    ownerSide
  };
}

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'web-gateway', timestamp: new Date().toISOString() });
});

app.get('/', async (req, res) => {
  try {
    if (req.session.organizationId && req.session.portal) return res.redirect(portalHomePath(req.session.portal, req.session.tenantSlug));
    let organization = null;
    try {
      const latest = await getLatestOrganization();
      organization = latest?.organization || null;
    } catch (error) {
      if (error?.status && error.status !== 404) throw error;
    }
    const isActive = organization?.status === 'active';
    return res.render('pages/landing', {
      title: 'Welcome',
      organization: isActive ? organization : null,
      tenantLoginUrl: isActive ? `/${organizationSlug(organization)}/login` : '',
      adminLoginUrl: isActive ? `/admin/login?tenant=${encodeURIComponent(organizationSlug(organization))}` : '',
      setupUrl: isActive ? '' : '/setup',
      serviceIssue: false
    });
  } catch {
    return res.status(503).render('pages/landing', {
      title: 'Welcome', organization: null, tenantLoginUrl: '', adminLoginUrl: '', setupUrl: '', serviceIssue: true
    });
  }
});

app.get('/setup', async (req, res) => {
  try {
    const latest = await getLatestOrganization();
    if (latest?.organization?.status === 'active' && req.query.force !== '1') return res.redirect('/');
  } catch {
    // First-run installations normally have no organization yet.
  }
  res.render('pages/setup', {
    title: 'Create your organization',
    form: {},
    errorMessage: null,
    serviceIssue: false
  });
});

app.post('/setup', async (req, res) => {
  const form = {
    organizationName: req.body.organizationName?.trim(),
    shortCode: req.body.shortCode?.trim(),
    workspaceSlug: req.body.workspaceSlug?.trim().toLowerCase(),
    primaryDomain: req.body.primaryDomain?.trim(),
    adminName: req.body.adminName?.trim(),
    adminEmail: req.body.adminEmail?.trim()
  };

  let organization = null;
  let organizationWasCreated = false;
  try {
    const organizationResponse = await createOrganization({
      name: form.organizationName,
      shortCode: form.shortCode,
      workspaceSlug: form.workspaceSlug,
      primaryDomain: form.primaryDomain,
      createdBy: form.adminEmail,
      status: 'pending',
      reusePending: true
    });

    organization = organizationResponse.organization;
    organizationWasCreated = !organizationResponse.pendingRetry;
    if (organizationResponse.pendingRetry) {
      const existingAdmins = await listAdmins(organization._id);
      const pendingAdmins = existingAdmins?.admins || [];
      if (pendingAdmins.length && !pendingAdmins.some((admin) => String(admin.email || '').toLowerCase() === String(form.adminEmail || '').toLowerCase())) {
        const error = new Error(`This pending workspace is already linked to ${pendingAdmins[0].email}. Complete or reset that activation before changing the first administrator.`);
        error.status = 409;
        throw error;
      }
    }

    const placeholderPassword = crypto.randomBytes(24).toString('base64url');
    const adminResponse = await createAdminUser({
      organizationId: organization._id,
      name: form.adminName,
      email: form.adminEmail,
      role: 'owner',
      password: placeholderPassword,
      status: 'pending',
      issueActivationToken: true
    });

    if (!adminResponse.activationToken) {
      const error = new Error('The activation link could not be created. Please submit the setup form again.');
      error.status = 500;
      throw error;
    }

    const admin = { ...adminResponse.admin, userType: 'organizationAdmin', assignments: [] };
    const baseUrl = publicBaseUrl(req);
    printInviteMail({ organization, user: admin, temporaryPassword: 'Set during activation', baseUrl });
    const activationMail = await sendOrganizationActivationMail({ organization, admin, activationToken: adminResponse.activationToken, baseUrl });
    req.session.pendingSetup = { organizationId: String(organization._id), adminEmail: String(admin.email || '').toLowerCase() };

    return res.status(202).render('pages/setup-pending', {
      title: 'Check your email',
      organization,
      adminEmail: admin.email,
      activationExpiresAt: adminResponse.activationExpiresAt || null,
      mailMode: mailStatus().effectiveMode,
      mailResult: activationMail,
      mailMessage: mailDeliveryLabel(activationMail, {
        sent: 'Activation email accepted by SMTP.',
        console: 'Activation email printed to the Service Desk terminal.',
        failed: 'The workspace was created, but the activation email could not be delivered.'
      })
    });
  } catch (error) {
    if (organizationWasCreated && organization?._id) {
      try { await deletePendingOrganization(organization._id); } catch {}
    }
    res.status(error.status || 500).render('pages/setup', {
      title: 'Create your organization',
      form,
      errorMessage: error.message || 'Unable to create organization.',
      serviceIssue: false
    });
  }
});

app.post('/setup/resend-activation', async (req, res) => {
  try {
    const pending = req.session.pendingSetup || {};
    if (!pending.organizationId || !pending.adminEmail) return res.redirect('/setup');
    const { organization } = await getOrganization(pending.organizationId);
    if (!organization || organization.status !== 'pending') return res.redirect('/setup');
    const adminsResult = await listAdmins(organization._id);
    const existingAdmin = (adminsResult?.admins || []).find((item) => String(item.email || '').toLowerCase() === String(pending.adminEmail || '').toLowerCase());
    if (!existingAdmin || existingAdmin.status === 'active') return res.redirect('/setup');

    const refreshed = await createAdminUser({
      organizationId: organization._id,
      name: existingAdmin.name,
      email: existingAdmin.email,
      role: existingAdmin.role || 'owner',
      password: crypto.randomBytes(24).toString('base64url'),
      status: 'pending',
      issueActivationToken: true
    });
    if (!refreshed.activationToken) throw new Error('A new activation token could not be created.');
    const admin = { ...refreshed.admin, userType: 'organizationAdmin', assignments: [] };
    const result = await sendOrganizationActivationMail({ organization, admin, activationToken: refreshed.activationToken, baseUrl: publicBaseUrl(req) });
    return res.status(202).render('pages/setup-pending', {
      title: 'Check your email', organization, adminEmail: admin.email, activationExpiresAt: refreshed.activationExpiresAt || null,
      mailMode: mailStatus().effectiveMode, mailResult: result,
      mailMessage: mailDeliveryLabel(result, { sent: 'A fresh activation email was accepted by SMTP.', console: 'A fresh activation email was printed to the Service Desk terminal.', failed: 'The activation email still could not be delivered.' })
    });
  } catch (error) {
    return res.status(500).render('pages/setup', { title: 'Create your organization', form: {}, errorMessage: error.message || 'Unable to resend activation email.', serviceIssue: false });
  }
});

app.get('/activate/:token', async (req, res) => {
  try {
    const payload = await validateActivationToken(req.params.token);
    const { organization } = await getOrganization(payload.organizationId);
    res.render('pages/activation', {
      title: 'Activate workspace',
      organization,
      admin: payload.admin,
      token: req.params.token,
      errorMessage: null
    });
  } catch (error) {
    res.status(400).render('pages/activation', {
      title: 'Activation link',
      organization: null,
      admin: null,
      token: req.params.token,
      errorMessage: error.message || 'This activation link is invalid or has expired.'
    });
  }
});

app.post('/activate/:token', async (req, res) => {
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirmPassword || '');
  try {
    if (password !== confirmPassword) {
      const error = new Error('The passwords do not match.');
      error.status = 400;
      throw error;
    }
    const activation = await completeActivation({ token: req.params.token, password });
    const { organization } = await activateOrganization(activation.organizationId);
    delete req.session.pendingSetup;
    req.session.globalFormNotice = `${organization.name} is active. Sign in with the password you just created.`;
    return res.redirect(`/admin/login?tenant=${encodeURIComponent(organizationSlug(organization))}`);
  } catch (error) {
    let organization = null;
    let admin = null;
    try {
      const validation = await validateActivationToken(req.params.token);
      ({ organization } = await getOrganization(validation.organizationId));
      admin = validation.admin;
    } catch {}
    return res.status(error.status || 400).render('pages/activation', {
      title: 'Activate workspace',
      organization,
      admin,
      token: req.params.token,
      errorMessage: error.message || 'Unable to activate this workspace.'
    });
  }
});

app.get('/verify-admin-email/:token', (req, res) => res.redirect(`/verify-email/${encodeURIComponent(req.params.token)}`));
app.post('/verify-admin-email/:token', (req, res) => res.redirect(307, `/verify-email/${encodeURIComponent(req.params.token)}`));

app.get('/verify-email/:token', async (req, res) => {
  try {
    const validation = await validateAdminEmailChange(req.params.token);
    const { organization } = await getOrganization(validation.organizationId);
    res.render('pages/verify-email', { title: 'Verify login email', organization, account: validation.account, accountType: validation.accountType, token: req.params.token, errorMessage: null, successMessage: null });
  } catch (error) {
    res.status(400).render('pages/verify-email', { title: 'Verify login email', organization: null, account: null, accountType: '', token: req.params.token, errorMessage: error.message || 'This email verification link is invalid or has expired.', successMessage: null });
  }
});

app.post('/verify-email/:token', async (req, res) => {
  try {
    const changed = await completeAdminEmailChange(req.params.token);
    const { organization } = await getOrganization(changed.organizationId);
    runInBackground(`email change notice ${changed.oldEmail}`, () => sendServiceMail({
      to: changed.oldEmail,
      subject: 'Your Service Desk login email changed',
      text: `Hello ${changed.name || 'there'},\n\nYour Service Desk login email for ${organization.name} was changed from ${changed.oldEmail} to ${changed.newEmail}. If you did not authorize this change, contact your tenant administrator immediately.\n\nRegards,\nService Desk`
    }));
    res.render('pages/verify-email', { title: 'Email updated', organization, account: { name: changed.name, email: changed.newEmail, pendingEmail: '' }, accountType: changed.accountType, token: req.params.token, errorMessage: null, successMessage: `Login email changed to ${changed.newEmail}.` });
  } catch (error) {
    res.status(error.status || 400).render('pages/verify-email', { title: 'Verify login email', organization: null, account: null, accountType: '', token: req.params.token, errorMessage: error.message || 'Unable to verify this email address.', successMessage: null });
  }
});

const RESERVED_TENANT_SLUGS = new Set(['admin', 'agent', 'client', 'api', 'assets', 'static', 'login', 'logout', 'health', 'setup', 'session', 'activate', 'reset-password', 'forgot-password', 'verify-admin-email', 'verify-email']);

function renderLoginPage(req, res, { portal, tenantSlug = '', organization = null, errorMessage = null, form = {} }) {
  const isAdmin = portal === 'admin';
  const title = isAdmin ? 'Admin Login' : `${organization?.name || tenantSlug} Login`;
  res.render('pages/login', {
    title,
    organization,
    portal,
    tenantSlug,
    isAdminLogin: isAdmin,
    portalTitle: isAdmin ? 'Admin Portal' : 'Tenant Portal',
    form,
    errorMessage,
    loginAction: isAdmin ? '/admin/login' : `/${tenantSlug}/login`
  });
}

app.get('/admin/login', (req, res) => {
  if (req.session.organizationId && req.session.portal === 'admin') return res.redirect('/admin/home');
  renderLoginPage(req, res, { portal: 'admin', form: { tenant: String(req.query.tenant || '').trim(), email: '' } });
});

app.post('/admin/login', async (req, res) => {
  const form = { tenant: req.body.tenant?.trim(), email: req.body.email?.trim(), password: '' };
  try {
    const tenant = String(req.body.tenant || '').trim();
    if (!tenant) {
      const error = new Error('Tenant is required.');
      error.status = 400;
      throw error;
    }
    const { organization } = await getOrganizationByWorkspace(tenant);
    const { actor, organizationId } = await loginActor({ portal: 'admin', organizationId: organization._id, email: req.body.email, password: req.body.password });
    const orgResponse = organizationId && String(organizationId) !== String(organization._id) ? await getOrganization(organizationId) : { organization };
    setActorSession(req, orgResponse.organization, actor, 'admin');
    res.redirect(`/session/welcome?next=${encodeURIComponent('/admin/home')}`);
  } catch (error) {
    renderLoginPage(req, res.status(error.status || 401), { portal: 'admin', errorMessage: error.message || 'Unable to login.', form });
  }
});

app.get('/admin/forgot-password', (req, res) => {
  res.render('pages/forgot-password', {
    title: 'Forgot admin password',
    organization: null,
    isAdmin: true,
    action: '/admin/forgot-password',
    backUrl: '/admin/login',
    form: { tenant: String(req.query.tenant || '').trim(), email: '' },
    errorMessage: null,
    successMessage: null
  });
});

app.post('/admin/forgot-password', async (req, res) => {
  const form = { tenant: String(req.body.tenant || '').trim(), email: String(req.body.email || '').trim() };
  const successMessage = 'If that administrator account exists, a one-time password reset link has been sent.';
  try {
    const { organization } = await getOrganizationByWorkspace(form.tenant);
    const reset = await requestPasswordReset({ organizationId: organization._id, email: form.email, portal: 'admin' });
    if (reset.resetToken) {
      runInBackground(`password reset ${form.email}`, () => sendPasswordResetMail({
        organization,
        account: { name: reset.name || 'Administrator', email: reset.email || form.email },
        resetToken: reset.resetToken,
        accountType: 'admin',
        baseUrl: publicBaseUrl(req)
      }));
    }
    res.render('pages/forgot-password', { title: 'Forgot admin password', organization: null, isAdmin: true, action: '/admin/forgot-password', backUrl: '/admin/login', form, errorMessage: null, successMessage });
  } catch (error) {
    // Do not disclose whether the tenant or account exists.
    res.render('pages/forgot-password', { title: 'Forgot admin password', organization: null, isAdmin: true, action: '/admin/forgot-password', backUrl: '/admin/login', form, errorMessage: null, successMessage });
  }
});

app.get('/session/bootstrap', async (req, res) => {
  try {
    if (!req.session.organizationId || !req.session.portal) return res.status(401).json({ ok: false, message: 'Session is not authenticated.' });
    const { organization } = await getOrganization(req.session.organizationId);
    const portal = req.session.portal;
    const actor = actorFromSession(req, portal);
    let workspaceLabel = organization.name;
    if (portal !== 'admin') {
      try {
        const clientsResponse = await listClients(organization._id);
        const flatClients = clientsResponse.clients || flattenClientTree(clientsResponse.tree || []);
        const scoped = resolveUserScopedClients(actor, flatClients, portal);
        const scopedIds = new Set(scoped.map((item) => String(item._id)));
        const roots = scoped.filter((item) => !item.parentClientId || !scopedIds.has(String(item.parentClientId)));
        if (roots.length === 1) workspaceLabel = roots[0].name;
      } catch {}
    }
    res.json({ ok: true, organizationName: organization.name, workspaceLabel, actorName: actor.name || '' });
  } catch (error) {
    res.status(error.status || 500).json({ ok: false, message: 'Workspace initialization failed.' });
  }
});

app.get('/session/welcome', async (req, res) => {
  if (!req.session.organizationId || !req.session.portal) return res.redirect('/');
  const portal = req.session.portal;
  const fallback = portalHomePath(portal, req.session.tenantSlug);
  const requested = String(req.query.next || '').trim();
  const nextPath = requested.startsWith('/') && !requested.startsWith('//') ? requested : fallback;
  let workspaceLabel = 'your workspace';
  try {
    const { organization } = await getOrganization(req.session.organizationId);
    workspaceLabel = organization.name || workspaceLabel;
    if (portal !== 'admin') {
      const actor = actorFromSession(req, portal);
      const clientsResponse = await listClients(organization._id);
      const flatClients = clientsResponse.clients || flattenClientTree(clientsResponse.tree || []);
      const scoped = resolveUserScopedClients(actor, flatClients, portal);
      const scopedIds = new Set(scoped.map((item) => String(item._id)));
      const roots = scoped.filter((item) => !item.parentClientId || !scopedIds.has(String(item.parentClientId)));
      if (roots.length === 1) workspaceLabel = roots[0].name;
    }
  } catch {}
  res.render('pages/workspace-loading', {
    title: 'Setting up your workspace',
    workspaceLabel,
    actorName: req.session.actorName || req.session.adminName || '',
    nextPath
  });
});

app.get('/:tenant/forgot-password', async (req, res, next) => {
  try {
    const tenantSlug = String(req.params.tenant || '').trim().toLowerCase();
    if (RESERVED_TENANT_SLUGS.has(tenantSlug)) return next();
    const { organization } = await getOrganizationByWorkspace(tenantSlug);
    res.render('pages/forgot-password', {
      title: 'Forgot password',
      organization,
      isAdmin: false,
      action: `/${organizationSlug(organization)}/forgot-password`,
      backUrl: `/${organizationSlug(organization)}/login`,
      form: { email: '' },
      errorMessage: null,
      successMessage: null
    });
  } catch (error) {
    next(error);
  }
});

app.post('/:tenant/forgot-password', async (req, res, next) => {
  const tenantSlug = String(req.params.tenant || '').trim().toLowerCase();
  const form = { email: String(req.body.email || '').trim() };
  const successMessage = 'If that account exists, a one-time password reset link has been sent.';
  try {
    const { organization } = await getOrganizationByWorkspace(tenantSlug);
    const reset = await requestPasswordReset({ organizationId: organization._id, email: form.email, portal: 'tenant' });
    if (reset.resetToken) {
      runInBackground(`password reset ${form.email}`, () => sendPasswordResetMail({
        organization,
        account: { name: reset.name || 'User', email: reset.email || form.email },
        resetToken: reset.resetToken,
        accountType: 'user',
        baseUrl: publicBaseUrl(req)
      }));
    }
    res.render('pages/forgot-password', { title: 'Forgot password', organization, isAdmin: false, action: `/${organizationSlug(organization)}/forgot-password`, backUrl: `/${organizationSlug(organization)}/login`, form, errorMessage: null, successMessage });
  } catch (error) {
    try {
      const { organization } = await getOrganizationByWorkspace(tenantSlug);
      res.render('pages/forgot-password', { title: 'Forgot password', organization, isAdmin: false, action: `/${organizationSlug(organization)}/forgot-password`, backUrl: `/${organizationSlug(organization)}/login`, form, errorMessage: null, successMessage });
    } catch { next(error); }
  }
});

app.get('/reset-password/:token', async (req, res) => {
  try {
    const validation = await validatePasswordResetToken(req.params.token);
    const { organization } = await getOrganization(validation.organizationId);
    res.render('pages/reset-password', { title: 'Reset password', organization, account: validation, token: req.params.token, errorMessage: null });
  } catch (error) {
    res.status(400).render('pages/reset-password', { title: 'Reset password', organization: null, account: null, token: req.params.token, errorMessage: error.message || 'This password reset link is invalid or has expired.' });
  }
});

app.post('/reset-password/:token', async (req, res) => {
  const password = String(req.body.password || '');
  const confirmPassword = String(req.body.confirmPassword || '');
  try {
    if (password !== confirmPassword) {
      const error = new Error('The passwords do not match.');
      error.status = 400;
      throw error;
    }
    const reset = await completePasswordReset({ token: req.params.token, password });
    const { organization } = await getOrganization(reset.organizationId);
    req.session.globalFormNotice = 'Your password has been reset. You can sign in now.';
    return res.redirect(reset.accountType === 'admin' ? `/admin/login?tenant=${encodeURIComponent(organizationSlug(organization))}` : `/${organizationSlug(organization)}/login`);
  } catch (error) {
    let organization = null;
    let account = null;
    try {
      const validation = await validatePasswordResetToken(req.params.token);
      ({ organization } = await getOrganization(validation.organizationId));
      account = validation;
    } catch {}
    return res.status(error.status || 400).render('pages/reset-password', { title: 'Reset password', organization, account, token: req.params.token, errorMessage: error.message || 'Unable to reset your password.' });
  }
});

app.get('/:tenant/login', async (req, res, next) => {
  try {
    const tenantSlug = String(req.params.tenant || '').trim().toLowerCase();
    if (RESERVED_TENANT_SLUGS.has(tenantSlug)) return res.status(404).render('pages/error', { title: 'Reserved route', status: 404, message: 'This URL is reserved. Use your tenant login URL, for example /sbs/login, or use /admin/login for admin access.' });
    const { organization } = await getOrganizationByWorkspace(tenantSlug);
    if (req.session.organizationId && String(req.session.organizationId) === String(organization._id) && ['client', 'agent'].includes(req.session.portal)) {
      return res.redirect(portalHomePath(req.session.portal, organizationSlug(organization)));
    }
    renderLoginPage(req, res, { portal: 'tenant', tenantSlug: organizationSlug(organization), organization });
  } catch (error) {
    if (error.status === 404) return res.status(404).render('pages/error', { title: 'Tenant not found', status: 404, message: 'We could not find that tenant workspace.' });
    next(error);
  }
});

app.post('/:tenant/login', async (req, res, next) => {
  const tenantSlug = String(req.params.tenant || '').trim().toLowerCase();
  const form = { email: req.body.email?.trim(), password: '' };
  try {
    if (RESERVED_TENANT_SLUGS.has(tenantSlug)) return res.status(404).render('pages/error', { title: 'Reserved route', status: 404, message: 'This URL is reserved. Use your tenant login URL, for example /sbs/login, or use /admin/login for admin access.' });
    const { organization } = await getOrganizationByWorkspace(tenantSlug);
    const { actor, organizationId } = await loginActor({ portal: 'tenant', organizationId: organization._id, email: req.body.email, password: req.body.password });
    const orgResponse = organizationId && String(organizationId) !== String(organization._id) ? await getOrganization(organizationId) : { organization };
    const tenantPortal = chooseTenantPortal(actor);
    setActorSession(req, orgResponse.organization, actor, tenantPortal);
    const nextPath = portalHomePath(tenantPortal, organizationSlug(orgResponse.organization));
    res.redirect(`/session/welcome?next=${encodeURIComponent(nextPath)}`);
  } catch (error) {
    try {
      const { organization } = await getOrganizationByWorkspace(tenantSlug);
      renderLoginPage(req, res.status(error.status || 401), { portal: 'tenant', tenantSlug: organizationSlug(organization), organization, errorMessage: error.message || 'Unable to login.', form });
    } catch {
      next(error);
    }
  }
});


function normalizeFilterText(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function parseSunQuery(query = '') {
  const text = String(query || '').trim();
  const conditions = [];
  const re = /([a-zA-Z][a-zA-Z0-9_.-]*)\s*(?::|=)\s*("[^"]+"|'[^']+'|[^\s]+)/g;
  let match;
  const consumed = [];
  while ((match = re.exec(text))) {
    const field = match[1].toLowerCase();
    const rawValue = match[2].replace(/^['"]|['"]$/g, '');
    conditions.push({ field, value: normalizeFilterText(rawValue), raw: rawValue });
    consumed.push(match[0]);
  }
  let freeText = text;
  consumed.forEach((part) => { freeText = freeText.replace(part, ' '); });
  freeText = normalizeFilterText(freeText);
  return { conditions, freeText };
}

function requestFieldValue(item, field) {
  const map = {
    request: item.requestNumber,
    key: item.requestNumber,
    code: item.requestNumber,
    summary: item.subject,
    subject: item.subject,
    client: `${item.client?.name || ''} ${item.client?.code || ''}`,
    status: `${item.statusLabel || ''} ${item.internalStatusLabel || ''} ${item.clientStatusLabel || ''}`,
    family: item.level1Type?.name,
    type: item.level2Type?.name,
    issueType: item.level2Type?.name,
    subtype: item.level3Type?.name || item.level2Type?.name,
    level: item.currentSupportLevel,
    support: item.supportLevelLabel,
    visibility: item.visibilityLabel,
    source: item.sourceLabel,
    sla: `${item.slaView?.rag || ''} ${item.slaView?.state || ''} ${item.slaView?.nextAction || ''}`,
    priority: `${item.priority?.name || ''} ${item.priority?.code || ''}`,
    severity: `${item.severity?.name || ''} ${item.severity?.code || ''}`,
    product: item.product?.name,
    module: item.module?.name,
    environment: item.environment?.name,
    region: item.region?.name
  };
  return normalizeFilterText(map[field] || '');
}

function clientFieldValue(item, field, clientsById = new Map()) {
  const parent = item.parentClientId ? clientsById.get(String(item.parentClientId)) : null;
  const map = {
    code: item.shortCode,
    key: item.shortCode,
    client: item.name,
    name: item.name,
    domain: item.primaryDomain,
    parent: parent?.name || '',
    status: item.status,
    issue: item.issueTypeMode,
    issuetypes: item.issueTypeMode,
    sla: item.slaMode,
    depth: String(item.depth ?? 0)
  };
  return normalizeFilterText(map[field] || '');
}

function filterRecords(items = [], query = '', target = 'requests', clientsById = new Map()) {
  const parsed = parseSunQuery(query);
  if (!parsed.freeText && !parsed.conditions.length) return items;
  return items.filter((item) => {
    const blob = normalizeFilterText(JSON.stringify(item));
    const freeOk = !parsed.freeText || blob.includes(parsed.freeText);
    if (!freeOk) return false;
    return parsed.conditions.every(({ field, value }) => {
      const fieldText = target === 'clients' ? clientFieldValue(item, field, clientsById) : requestFieldValue(item, field);
      return fieldText.includes(value);
    });
  });
}


function sunQueryRequestParams(query = '') {
  const parsed = parseSunQuery(query);
  const params = {};
  const free = [];
  for (const item of parsed.conditions || []) {
    const field = String(item.field || '').toLowerCase();
    const raw = String(item.raw || item.value || '').trim();
    const value = String(item.value || raw).trim();
    if (field === 'status') params.status = raw;
    else if (field === 'sla') params.sla = raw.toLowerCase();
    else if (['level', 'support'].includes(field)) params.supportLevel = raw.toUpperCase();
    else if (field === 'visibility') params.visibility = raw;
    else if (['mine', 'owner', 'assignee'].includes(field) && ['me', 'mine', 'self', '1', 'true'].includes(value)) params.mine = '1';
    else if (['client', 'family', 'type', 'subtype', 'severity', 'priority', 'product', 'module', 'environment', 'request', 'key', 'code'].includes(field)) free.push(raw);
  }
  if (parsed.freeText) free.push(parsed.freeText);
  if (free.length) params.search = free.join(' ');
  return params;
}

function sunQueryRequestLink(portalBase, query = '') {
  return withQuery(`${portalBase}/requests`, { ...sunQueryRequestParams(query), fromFilters: '1', activeFilter: query });
}
async function renderSimpleHome(req, res, next, { organization, actor, portal }) {
  try {
    const tenantSlug = req.session.tenantSlug || organizationSlug(organization);
    const portalBase = portalBasePath(portal, tenantSlug);
    let visibleRequests = [];
    let scopedClients = [];
    if (portal === 'admin') {
      const response = await listRequests(organization._id, { page: 1, pageSize: 5000 });
      visibleRequests = response.requests || [];
    } else {
      const clientsResponse = await listClients(organization._id);
      const flatClients = clientsResponse.clients || flattenClientTree(clientsResponse.tree || []);
      scopedClients = resolveUserScopedClients(actor, flatClients, portal);
      const scopedClientIds = scopedClients.map((client) => String(client._id));
      const response = await listRequests(organization._id, { clientIds: scopedClientIds, page: 1, pageSize: 5000 });
      visibleRequests = (response.requests || []).filter((item) => {
        const assignment = bestAssignmentForClient(actor, item.client?.id, flatClients, portal);
        return assignmentCanSeeRequest(assignment, item, portal);
      });
    }

    const isOpen = (item) => !['closed', 'cancelled', 'returned'].includes(String(item.lifecycleState || '').toLowerCase());
    const waitsForCustomer = (item) => /need\s*(info|information)|bank\s*to\s*verify|waiting\s*for\s*(client|customer)/i.test(`${item.currentStatus?.name || ''} ${item.currentStatus?.customerLabel || ''}`);
    const actorOwns = (item) => (item.activeStages || []).some((stage) => String(stage.assignedTo?.actorId || '') === String(actor._id || '') || String(stage.assignedTo?.email || '').toLowerCase() === String(actor.email || '').toLowerCase());
    const slaRisk = visibleRequests.filter((item) => ['amber', 'red'].includes(String(item.sla?.rag || '')) && isOpen(item)).length;
    const waitingCustomer = visibleRequests.filter((item) => waitsForCustomer(item) && isOpen(item)).length;
    const myAttention = portal === 'client'
      ? waitingCustomer
      : visibleRequests.filter((item) => isOpen(item) && (actorOwns(item) || ['amber', 'red'].includes(String(item.sla?.rag || '')) || (portal === 'admin' && !(item.activeStages || []).some((stage) => stage.assignedTo?.actorId || stage.assignedTo?.email)))).length;
    const recentRequests = visibleRequests
      .slice()
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())
      .slice(0, portal === 'client' ? 3 : 4)
      .map((item) => summarizeRequest(item, portal));
    const firstName = String(actor.name || '').trim().split(/\s+/)[0] || '';
    const homeActions = portal === 'client'
      ? [
          { label: 'My work', href: `${portalBase}/requests`, style: 'secondary' },
          { label: '＋ Raise request', href: `${portalBase}/requests/new`, style: 'primary' }
        ]
      : portal === 'admin'
        ? [
            { label: 'View requests', href: `${portalBase}/requests`, style: 'secondary' },
            { label: '＋ Raise request', href: `${portalBase}/requests/new`, style: 'primary' }
          ]
        : [
            { label: 'My work', href: `${portalBase}/requests?mine=1`, style: 'secondary' },
            { label: '＋ Raise request', href: `${portalBase}/requests/new`, style: 'primary' }
          ];
    res.render('pages/simple-home', {
      title: 'Home', organization, actor, portal, portalBase, portalTitle: portalName(portal),
      firstName, homeActions, scopedClients,
      homeMetrics: {
        open: visibleRequests.filter(isOpen).length,
        attention: myAttention,
        slaRisk,
        waitingCustomer
      },
      recentRequests
    });
  } catch (error) { next(error); }
}

async function renderAdminDashboard(req, res, next, organization) {
  try {
    const range = dashboardRange(req.query);
    const [adminResponse, services, summaryResponse, requestResponse, allRequestResponse] = await Promise.all([
      listAdmins(organization._id),
      healthSummary(),
      getOrganizationSummary(organization._id),
      listRequests(organization._id, { page: 1, pageSize: 5000, dateFrom: range.from.toISOString(), dateTo: range.to.toISOString() }),
      listRequests(organization._id, { page: 1, pageSize: 5000 })
    ]);

    const admins = adminResponse.admins || [];
    const owner = admins.find((admin) => admin.role === 'owner') || admins[0];
    if (owner) {
      req.session.adminName = owner.name;
      req.session.adminEmail = owner.email;
    }

    const summary = summaryResponse.summary;
    const recentRequests = (allRequestResponse.requests || []).map((item) => summarizeRequest(item, 'admin'));
    const analytics = buildDashboardAnalytics(requestResponse.requests || [], range);
    const calendarPulse = buildCalendarPulse(allRequestResponse.requests || []);
    const requestMetrics = {
      open: recentRequests.filter((item) => !['closed', 'cancelled'].includes(item.lifecycleState)).length,
      new: recentRequests.filter((item) => (item.currentStatus?.statusType || 'start') === 'start').length,
      internal: recentRequests.filter((item) => item.visibilityScope === 'internal_only').length,
      l3: recentRequests.filter((item) => item.currentSupportLevel === 'L3').length,
      attention: recentRequests.filter((item) => ['amber','red'].includes(item.sla?.rag)).length
    };
    res.render('pages/home', {
      title: 'Admin Dashboard',
      organization,
      portal: 'admin',
      summary,
      services,
      range,
      periodHref: (key) => periodHref('/admin/dashboard', key, req.query),
      requestMetrics,
      analytics,
      calendarPulse,
      recentRequests: recentRequests.slice(0, 8)
    });
  } catch (error) {
    next(error);
  }
}

app.get('/admin/home', async (req, res, next) => {
  try {
    const { organization, allowed } = await resolvePortalAccess(req, 'admin');
    if (!allowed) return res.redirect('/admin/login');
    await renderSimpleHome(req, res, next, { organization, actor: actorFromSession(req, 'admin'), portal: 'admin' });
  } catch (error) {
    next(error);
  }
});


app.get('/admin/health', async (req, res, next) => {
  try {
    const { organization, allowed } = await resolvePortalAccess(req, 'admin');
    if (!allowed) return res.redirect('/admin/login');
    const [services, summaryResponse, clientsResult, usersResult, issueTypesResult, workflowsResult, supportPathsResult, slaResult] = await Promise.all([
      healthSummary(),
      getOrganizationSummary(organization._id),
      listClients(organization._id),
      listUsers(organization._id),
      listIssueTypes(organization._id),
      listWorkflows(organization._id),
      listSupportPaths(organization._id),
      listSlaPolicies(organization._id)
    ]);
    const clients = clientsResult.clients || flattenClientTree(clientsResult.tree || []);
    const level2 = (issueTypesResult.issueTypes || []).filter((item) => item.level === 2);
    const configuration = [
      { label: 'Clients without SLA', count: clients.filter((c) => c.slaMode !== 'inherit' && !c.defaultSlaPolicyId && !(c.familySlaAssignments || []).some((assignment) => assignment.isActive !== false && assignment.slaPolicyId)).length, tone: 'warn' },
      { label: 'Clients without products/modules', count: clients.filter((c) => c.productModuleMode !== 'inherit' && (!(c.enabledProductIds || []).length || !(c.enabledModuleIds || []).length)).length, tone: 'warn' },
      { label: 'Level 2 types without workflow', count: level2.filter((t) => !t.workflowId && !t.workflow?.id).length, tone: 'danger' },
      { label: 'Level 2 types without support path', count: level2.filter((t) => !t.supportPathId && !t.supportPath?.id).length, tone: 'warn' },
      { label: 'Users without assignment', count: (usersResult.users || []).filter((u) => !(u.assignments || []).length).length, tone: 'warn' },
      { label: 'SLA policies without rules', count: (slaResult.policies || []).filter((p) => !(p.rules || []).length).length, tone: 'danger' }
    ];
    res.render('pages/admin-health', {
      title: 'Health',
      organization,
      portal: 'admin',
      services,
      summary: summaryResponse.summary,
      configuration,
      mail: mailStatus(),
      totals: {
        clients: clients.length,
        users: (usersResult.users || []).length,
        issueTypes: (issueTypesResult.issueTypes || []).length,
        workflows: (workflowsResult.workflows || []).length,
        supportPaths: (supportPathsResult.supportPaths || []).length,
        slaPolicies: (slaResult.policies || []).length
      }
    });
  } catch (error) { next(error); }
});

app.get('/admin/activity', async (req, res, next) => {
  try {
    const { organization, allowed } = await resolvePortalAccess(req, 'admin');
    if (!allowed) return res.redirect('/admin/login');
    const [{ logs }, requestResponse, usersResult] = await Promise.all([
      listAuditLogs(organization._id, 250),
      listRequests(organization._id, { page: 1, pageSize: 100 }),
      listUsers(organization._id)
    ]);
    const requestTimeline = (requestResponse.requests || []).flatMap((request) => (request.timeline || []).slice(-3).map((event) => ({
      eventType: event.eventType || 'request_activity',
      message: event.message || '',
      targetType: 'request',
      targetId: request._id,
      targetLabel: request.requestNumber,
      actor: event.actor || {},
      createdAt: event.createdAt
    })));
    const userRows = (usersResult.users || []).slice(0, 20).map((user) => ({
      eventType: 'user_snapshot',
      message: `User ${user.email} is ${user.status || 'active'}.`,
      targetType: 'user',
      targetId: user._id,
      targetLabel: user.email,
      actor: { name: user.name, email: user.email, role: 'user' },
      createdAt: user.updatedAt || user.createdAt
    }));
    const activity = [...(logs || []), ...requestTimeline, ...userRows]
      .filter((item) => item.createdAt)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 250);
    res.render('pages/admin-activity', { title: 'Activity', organization, portal: 'admin', activity });
  } catch (error) { next(error); }
});

app.get('/admin/dashboard', async (req, res, next) => {
  try {
    const { organization, allowed } = await resolvePortalAccess(req, 'admin');
    if (!allowed) return res.redirect('/admin/login');
    await renderAdminDashboard(req, res, next, organization);
  } catch (error) { next(error); }
});


async function renderTenantPortalDashboard(req, res, next, { organization, actor, portal }) {
  try {
    const range = dashboardRange(req.query);
    const { clients, tree: clientTree } = await listClients(organization._id);
    const flatClients = clients || flattenClientTree(clientTree || []);
    const scopedClients = resolveUserScopedClients(actor, flatClients, portal);
    const clientAssignments = assignmentContexts(actor, flatClients, portal);
    const scopedClientIds = scopedClients.map((client) => String(client._id));
    const [{ requests }, { requests: allScopedRequests }] = await Promise.all([
      listRequests(organization._id, { clientIds: scopedClientIds, page: 1, pageSize: 5000, dateFrom: range.from.toISOString(), dateTo: range.to.toISOString() }),
      listRequests(organization._id, { clientIds: scopedClientIds, page: 1, pageSize: 5000 })
    ]);
    const visibleRequests = (requests || []).filter((item) => {
      const assignment = bestAssignmentForClient(actor, item.client?.id, flatClients, portal);
      return assignmentCanSeeRequest(assignment, item, portal);
    });
    const allVisibleRequests = (allScopedRequests || []).filter((item) => {
      const assignment = bestAssignmentForClient(actor, item.client?.id, flatClients, portal);
      return assignmentCanSeeRequest(assignment, item, portal);
    });
    const requestCountsByClient = new Map();
    allVisibleRequests.forEach((item) => {
      const id = String(item.client?.id || '');
      requestCountsByClient.set(id, (requestCountsByClient.get(id) || 0) + 1);
    });
    const tenantSlug = req.session.tenantSlug || organizationSlug(organization);

    const portalBase = portalBasePath(portal, tenantSlug);
    const dashboard = buildRoleDashboard({ portal, actor, visibleRequests: allVisibleRequests, scopedClients, clientAssignments, portalBase });
    const analytics = buildDashboardAnalytics(visibleRequests, range);
    const calendarPulse = buildCalendarPulse(allVisibleRequests);

    res.render('pages/portal-home', {
      title: portalName(portal),
      organization,
      portal,
      portalBase,
      portalTitle: portalName(portal),
      actor,
      dashboard,
      analytics,
      calendarPulse,
      range,
      periodHref: (key) => periodHref(`${portalBase}/dashboard`, key, req.query),
      scopedClients,
      clientAssignments,
      roleLabels: ROLE_LABELS,
      clientTree: clientTree || [],
      requestCountsByClient,
      visibleRequestCount: allVisibleRequests.length,
      recentRequests: allVisibleRequests.slice(0, 8).map((item) => summarizeRequest(item, portal, bestAssignmentForClient(actor, item.client?.id, flatClients, portal)))
    });
  } catch (error) {
    next(error);
  }
}

app.get('/:portal(client|agent)/home', (req, res) => {
  const tenantSlug = req.session.tenantSlug;
  if (tenantSlug && req.session.portal === req.params.portal) return res.redirect(portalHomePath(req.params.portal, tenantSlug));
  return res.redirect('/');
});

app.get('/:tenant/home', async (req, res, next) => {
  try {
    const tenant = String(req.params.tenant || '').trim().toLowerCase();
    if (RESERVED_TENANT_SLUGS.has(tenant)) return next();
    const portal = req.session.portal;
    if (!['client', 'agent'].includes(portal)) return res.redirect(`/${tenant}/login`);
    const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.redirect(`/${tenant}/login`);
    if (organizationSlug(organization) !== tenant) return res.redirect(portalHomePath(portal, organizationSlug(organization)));
    await renderSimpleHome(req, res, next, { organization, actor, portal });
  } catch (error) {
    next(error);
  }
});

app.get('/:tenant/dashboard', async (req, res, next) => {
  try {
    const tenant = String(req.params.tenant || '').trim().toLowerCase();
    if (RESERVED_TENANT_SLUGS.has(tenant)) return next();
    const portal = req.session.portal;
    if (!['client', 'agent'].includes(portal)) return res.redirect(`/${tenant}/login`);
    const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.redirect(`/${tenant}/login`);
    if (organizationSlug(organization) !== tenant) return res.redirect(`/${tenant}/home`);
    await renderTenantPortalDashboard(req, res, next, { organization, actor, portal });
  } catch (error) { next(error); }
});


app.get('/admin/help', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    res.render('pages/help', { title: 'Help & FAQ', organization, portal: 'admin', actor: { name: req.session.actorName, userType: 'organizationAdmin' }, helpRole: 'admin', items: faqItemsForRole('admin') });
  } catch (error) { next(error); }
});

app.get('/:tenant/help', async (req, res, next) => {
  try {
    const tenant = String(req.params.tenant || '').trim().toLowerCase();
    if (RESERVED_TENANT_SLUGS.has(tenant)) return next();
    const portal = req.session.portal;
    if (!['client', 'agent'].includes(portal)) return res.redirect(`/${tenant}/login`);
    const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.redirect(`/${tenant}/login`);
    const helpRole = helpRoleForActor(portal, actor);
    res.render('pages/help', { title: 'Help & FAQ', organization, portal, actor, helpRole, items: faqItemsForRole(helpRole) });
  } catch (error) { next(error); }
});

app.get('/home', (req, res) => res.redirect(req.session.portal ? portalHomePath(req.session.portal, req.session.tenantSlug) : '/admin/login'));

// v10 canonical admin URLs while preserving the existing route handlers below.
app.use((req, res, next) => {
  if (/^\/admin\/(clients|users|admins|issue-types|workflows|support-paths|sla|severities-priorities|products-modules|regions|environments)(\/|$)/.test(req.url)) {
    req.url = req.url.replace(/^\/admin/, '') || '/';
  }
  next();
});

// Compatibility redirects from workspace-slug routes used in v6-v11.
app.get('/:workspace/:portal(admin|client|agent)/login', (req, res) => {
  if (req.params.portal === 'admin') return res.redirect('/admin/login');
  return res.redirect(`/${req.params.workspace}/login`);
});
app.get('/:workspace/:portal(admin|client|agent)/home', (req, res) => {
  if (req.params.portal === 'admin') return res.redirect('/admin/home');
  return res.redirect(`/${req.params.workspace}/home`);
});


// Admin configuration pages are exposed under /admin/* in the UI, while the
// original handlers were built without the /admin prefix. Rewrite only the
// configuration/tooling paths so /admin/login, /admin/home, and /admin/requests
// remain first-class routes.
const ADMIN_TOOL_PREFIXES = [
  '/issue-types',
  '/workflows',
  '/sla',
  '/severities-priorities',
  '/products-modules',
  '/regions',
  '/environments',
  '/config',
  '/users',
  '/support-paths',
  '/clients',
  '/client-code',
  '/tasks'
];

app.use((req, res, next) => {
  if (!req.path.startsWith('/admin/')) return next();
  const withoutAdmin = req.path.replace(/^\/admin/, '') || '/';
  const shouldRewrite = ADMIN_TOOL_PREFIXES.some((prefix) => withoutAdmin === prefix || withoutAdmin.startsWith(`${prefix}/`));
  if (shouldRewrite) {
    req.url = req.url.replace(/^\/admin(?=\/)/, '');
  }
  next();
});


app.get('/tasks', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const actor = actorFromSession(req, 'admin');
    await renderTaskList(req, res, next, { organization, actor, portal: 'admin' });
  } catch (error) { next(error); }
});

app.get('/tasks/:taskId', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const actor = actorFromSession(req, 'admin');
    await renderTaskDetail(req, res, next, { organization, actor, portal: 'admin', taskId: req.params.taskId });
  } catch (error) { next(error); }
});

app.post('/tasks/:taskId/comments', upload.array('attachments', 5), (req, res, next) => handleTaskComment(req, res, next, 'admin'));
app.post('/tasks/:taskId/status', (req, res, next) => handleTaskPageStatus(req, res, next, 'admin'));

app.get('/issue-types', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const [{ tree }, { workflows }, { supportPaths }, { slaPolicies }] = await Promise.all([
      listIssueTypes(organization._id),
      listWorkflows(organization._id),
      listSupportPaths(organization._id),
      listSlaPolicies(organization._id)
    ]);

    res.render('pages/issue-types', {
      title: 'Issue Families',
      organization,
      tree,
      workflows: workflows || [],
      supportPaths: supportPaths || [],
      slaPolicies: slaPolicies || [],
      form: {},
      errorMessage: null
    });
  } catch (error) {
    next(error);
  }
});

app.get('/issue-types/families/:familyId', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const [{ tree }, { workflows }, { supportPaths }, { slaPolicies }] = await Promise.all([
      listIssueTypes(organization._id),
      listWorkflows(organization._id),
      listSupportPaths(organization._id),
      listSlaPolicies(organization._id)
    ]);
    const family = (tree || []).find((item) => String(item._id) === String(req.params.familyId));
    if (!family) return res.status(404).render('pages/error', { title: 'Family not found', status: 404, message: 'This Family no longer exists.' });
    res.render('pages/issue-family-detail', {
      title: family.name,
      organization,
      family,
      workflows: workflows || [],
      supportPaths: supportPaths || [],
      slaPolicies: slaPolicies || [],
      errorMessage: null
    });
  } catch (error) { next(error); }
});

app.get('/issue-types/nodes/:issueTypeId/fields', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const { tree } = await listIssueTypes(organization._id);
    let family = null;
    let parentType = null;
    let issueType = null;
    for (const item of tree || []) {
      for (const child of item.children || []) {
        if (String(child._id) === String(req.params.issueTypeId)) {
          family = item;
          parentType = item;
          issueType = child;
          break;
        }
        const subtype = (child.children || []).find((entry) => String(entry._id) === String(req.params.issueTypeId));
        if (subtype) {
          family = item;
          parentType = child;
          issueType = subtype;
          break;
        }
      }
      if (issueType) break;
    }
    if (!issueType) return res.status(404).render('pages/error', { title: 'Not found', status: 404, message: 'Issue Type or Subtype not found.' });
    res.render('pages/issue-type-fields-detail', {
      title: `Fields · ${issueType.name}`,
      organization,
      family,
      parentType,
      issueType,
      errorMessage: null
    });
  } catch (error) { next(error); }
});

// Alias retained inside v23.1 code so existing bookmarks to the field editor do not 404.
app.get('/issue-types/level2/:issueTypeId/fields', (req, res) => res.redirect(`/admin/issue-types/nodes/${req.params.issueTypeId}/fields`));
app.get('/issue-types/level3/:issueTypeId/fields', (req, res) => res.redirect(`/admin/issue-types/nodes/${req.params.issueTypeId}/fields`));

app.post('/issue-types/level1', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const { issueType } = await createLevel1IssueType(organization._id, req.body);
    res.redirect(`/admin/issue-types?openFamily=${issueType._id}&created=family`);
  } catch (error) { next(error); }
});

app.post('/issue-types/level2', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const { issueType } = await createLevel2IssueType(organization._id, req.body);
    const fallback = `/admin/issue-types?openFamily=${issueType.parentTypeId}&createdIssueType=${issueType._id}`;
    res.redirect(safeRedirectTarget(req.body.returnTo, fallback));
  } catch (error) { next(error); }
});

app.post('/issue-types/level3', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const { issueType } = await createLevel3IssueType(organization._id, req.body);
    const fallback = `/admin/issue-types?createdSubtype=${issueType._id}`;
    res.redirect(safeRedirectTarget(req.body.returnTo, fallback));
  } catch (error) { next(error); }
});

app.post('/issue-types/:issueTypeId/edit', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await updateIssueType(organization._id, req.params.issueTypeId, req.body);
    res.redirect(safeRedirectTarget(req.body.returnTo, '/admin/issue-types'));
  } catch (error) { next(error); }
});

app.post('/issue-types/:issueTypeId/behavior', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await updateTaxonomyBehavior(organization._id, req.params.issueTypeId, {
      workflowId: req.body.workflowId || '',
      supportPathId: req.body.supportPathId || '',
      slaApplicability: req.body.slaApplicability || 'inherit',
      slaPolicyId: req.body.slaPolicyId || '',
      formDefinitionKey: req.body.formDefinitionKey || '',
      approvalPolicyKey: req.body.approvalPolicyKey || '',
      notificationPolicyKey: req.body.notificationPolicyKey || ''
    });
    res.redirect(safeRedirectTarget(req.body.returnTo, '/admin/issue-types'));
  } catch (error) { next(error); }
});

app.post('/issue-types/:issueTypeId/fields-config', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await updateIssueType(organization._id, req.params.issueTypeId, req.body);
    res.redirect(`/admin/issue-types/nodes/${req.params.issueTypeId}/fields`);
  } catch (error) { next(error); }
});

app.post('/issue-types/:issueTypeId/custom-fields', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await addIssueTypeCustomField(organization._id, req.params.issueTypeId, req.body);
    res.redirect(`/admin/issue-types/nodes/${req.params.issueTypeId}/fields`);
  } catch (error) { next(error); }
});

app.post('/issue-types/:issueTypeId/custom-fields/:fieldKey', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await updateIssueTypeCustomField(organization._id, req.params.issueTypeId, req.params.fieldKey, req.body);
    res.redirect(`/admin/issue-types/nodes/${req.params.issueTypeId}/fields`);
  } catch (error) { next(error); }
});

app.post('/issue-types/preset/:presetKey', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await applyIssueTypePreset(organization._id, req.params.presetKey);
    res.redirect('/admin/issue-types');
  } catch (error) { next(error); }
});

app.get('/workflows', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const [{ workflows }, { tree }] = await Promise.all([listWorkflows(organization._id), listIssueTypes(organization._id)]);

    res.render('pages/workflows', {
      title: 'Workflows',
      organization,
      workflows,
      issueTypeTree: tree,
      errorMessage: null
    });
  } catch (error) {
    next(error);
  }
});

app.post('/workflows', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const { workflow } = await createWorkflow(organization._id, req.body);
    res.redirect(`/admin/workflows/${workflow._id}`);
  } catch (error) {
    next(error);
  }
});

app.post('/workflows/preset/:presetKey', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const { workflow } = await applyWorkflowPreset(organization._id, req.params.presetKey);
    res.redirect(`/admin/workflows/${workflow._id}`);
  } catch (error) {
    next(error);
  }
});

app.post('/workflows/:workflowId/issue-types', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await assignWorkflowToIssueTypes(organization._id, req.params.workflowId, toArray(req.body.issueTypeIds));
    res.redirect('/admin/workflows');
  } catch (error) {
    next(error);
  }
});

app.get('/workflows/:workflowId', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const { workflow } = await getWorkflow(organization._id, req.params.workflowId);

    const transitionSet = new Set((workflow.transitions || []).map((transition) => `${transition.fromStatusId}__${transition.toStatusId}`));

    res.render('pages/workflow-detail', {
      title: workflow.name,
      organization,
      workflow,
      transitionSet,
      embedded: req.query.embed === '1'
    });
  } catch (error) {
    next(error);
  }
});


app.post('/workflows/:workflowId/edit', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await updateWorkflow(organization._id, req.params.workflowId, req.body);
    const suffix = req.body.returnEmbedded === '1' ? '?embed=1' : '';
    res.redirect(`/admin/workflows/${req.params.workflowId}${suffix}`);
  } catch (error) { next(error); }
});

app.post('/workflows/:workflowId/statuses', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await addWorkflowStatus(organization._id, req.params.workflowId, req.body);
    const suffix = req.body.returnEmbedded === '1' ? '?embed=1' : '';
    res.redirect(`/admin/workflows/${req.params.workflowId}${suffix}`);
  } catch (error) {
    next(error);
  }
});


app.post('/workflows/:workflowId/statuses/:statusId/edit', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await updateWorkflowStatus(organization._id, req.params.workflowId, req.params.statusId, req.body);
    const suffix = req.body.returnEmbedded === '1' ? '?embed=1' : '';
    res.redirect(`/admin/workflows/${req.params.workflowId}${suffix}`);
  } catch (error) { next(error); }
});

app.post('/workflows/:workflowId/statuses/:statusId/tasks', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await addWorkflowStatusTask(organization._id, req.params.workflowId, req.params.statusId, req.body);
    const suffix = req.body.returnEmbedded === '1' ? '?embed=1' : '';
    res.redirect(`/admin/workflows/${req.params.workflowId}${suffix}`);
  } catch (error) { next(error); }
});

app.post('/workflows/:workflowId/transitions', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await updateWorkflowTransitions(organization._id, req.params.workflowId, toArray(req.body.transitions));
    const suffix = req.body.returnEmbedded === '1' ? '?embed=1' : '';
    res.redirect(`/admin/workflows/${req.params.workflowId}${suffix}`);
  } catch (error) {
    next(error);
  }
});



function safeRedirectTarget(value, fallback = '/admin/sla') {
  const target = String(value || '').trim();
  if (!target.startsWith('/') || target.startsWith('//')) return fallback;
  return target;
}

app.get('/sla', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const configBundle = await getOperationalConfig(organization._id);

    res.render('pages/sla', {
      title: 'SLA Policies',
      organization,
      ...configBundle,
      errorMessage: null
    });
  } catch (error) {
    next(error);
  }
});

app.get('/severities-priorities', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const configBundle = await getOperationalConfig(organization._id);

    res.render('pages/severities-priorities', {
      title: 'Severities & Priorities',
      organization,
      ...configBundle,
      errorMessage: null
    });
  } catch (error) {
    next(error);
  }
});

app.get('/products-modules', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const configBundle = await getOperationalConfig(organization._id);

    res.render('pages/products-modules', {
      title: 'Products & Modules',
      organization,
      ...configBundle,
      errorMessage: null
    });
  } catch (error) {
    next(error);
  }
});

app.get('/regions', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const configBundle = await getOperationalConfig(organization._id);

    res.render('pages/regions', {
      title: 'Regions',
      organization,
      ...configBundle,
      errorMessage: null
    });
  } catch (error) {
    next(error);
  }
});

app.get('/environments', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const configBundle = await getOperationalConfig(organization._id);

    res.render('pages/environments', {
      title: 'Environments',
      organization,
      ...configBundle,
      errorMessage: null
    });
  } catch (error) {
    next(error);
  }
});

app.post('/config/seed', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await seedOperationalConfig(organization._id);
    res.redirect(safeRedirectTarget(req.body.next || req.query.next, '/admin/sla'));
  } catch (error) {
    next(error);
  }
});

app.post('/config/severities', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await createSeverity(organization._id, req.body);
    res.redirect('/admin/severities-priorities');
  } catch (error) {
    next(error);
  }
});

app.post('/config/priorities', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await createPriority(organization._id, req.body);
    res.redirect('/admin/severities-priorities');
  } catch (error) {
    next(error);
  }
});

app.post('/config/products', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await createProduct(organization._id, req.body);
    res.redirect('/admin/products-modules');
  } catch (error) {
    next(error);
  }
});

app.post('/config/modules', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await createModule(organization._id, req.body);
    res.redirect('/admin/products-modules');
  } catch (error) {
    next(error);
  }
});

app.post('/config/modules/bulk', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const result = await createModulesBulk(organization._id, req.body);
    req.session.globalFormNotice = result.message || 'Modules added.';
    return req.session.save(() => res.redirect('/admin/products-modules'));
  } catch (error) { next(error); }
});

app.post('/config/regions', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await createRegion(organization._id, req.body);
    res.redirect('/admin/regions');
  } catch (error) {
    next(error);
  }
});

app.post('/config/subregions', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await createSubregion(organization._id, req.body);
    res.redirect('/admin/regions');
  } catch (error) { next(error); }
});

app.post('/config/environments', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await createEnvironment(organization._id, req.body);
    res.redirect('/admin/environments');
  } catch (error) {
    next(error);
  }
});


app.post('/config/severities/:severityId/edit', async (req, res, next) => {
  try { const organization = await ensureWorkspace(req, res); if (!organization) return res.redirect('/admin/login'); await updateSeverity(organization._id, req.params.severityId, req.body); res.redirect('/admin/severities-priorities'); } catch (error) { next(error); }
});
app.post('/config/priorities/:priorityId/edit', async (req, res, next) => {
  try { const organization = await ensureWorkspace(req, res); if (!organization) return res.redirect('/admin/login'); await updatePriority(organization._id, req.params.priorityId, req.body); res.redirect('/admin/severities-priorities'); } catch (error) { next(error); }
});
app.post('/config/products/:productId/edit', async (req, res, next) => {
  try { const organization = await ensureWorkspace(req, res); if (!organization) return res.redirect('/admin/login'); await updateProduct(organization._id, req.params.productId, req.body); res.redirect('/admin/products-modules'); } catch (error) { next(error); }
});
app.post('/config/modules/:moduleId/edit', async (req, res, next) => {
  try { const organization = await ensureWorkspace(req, res); if (!organization) return res.redirect('/admin/login'); await updateModule(organization._id, req.params.moduleId, req.body); res.redirect('/admin/products-modules'); } catch (error) { next(error); }
});
app.post('/config/regions/:regionId/edit', async (req, res, next) => {
  try { const organization = await ensureWorkspace(req, res); if (!organization) return res.redirect('/admin/login'); await updateRegion(organization._id, req.params.regionId, req.body); res.redirect('/admin/regions'); } catch (error) { next(error); }
});
app.post('/config/subregions/:subregionId/edit', async (req, res, next) => {
  try { const organization = await ensureWorkspace(req, res); if (!organization) return res.redirect('/admin/login'); await updateSubregion(organization._id, req.params.subregionId, req.body); res.redirect('/admin/regions'); } catch (error) { next(error); }
});

app.post('/config/environments/:environmentId/edit', async (req, res, next) => {
  try { const organization = await ensureWorkspace(req, res); if (!organization) return res.redirect('/admin/login'); await updateEnvironment(organization._id, req.params.environmentId, req.body); res.redirect('/admin/environments'); } catch (error) { next(error); }
});

app.post('/sla/policies', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const { slaPolicy } = await createSlaPolicy(organization._id, req.body);
    res.redirect(`/admin/sla/${slaPolicy._id}`);
  } catch (error) {
    next(error);
  }
});

app.post('/sla/preset/:presetKey', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const { slaPolicy } = await applySlaPreset(organization._id, req.params.presetKey);
    res.redirect(`/admin/sla/${slaPolicy._id}`);
  } catch (error) {
    next(error);
  }
});

app.get('/sla/:slaPolicyId', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const payload = await getSlaPolicy(organization._id, req.params.slaPolicyId);

    res.render('pages/sla-detail', {
      title: payload.slaPolicy.name,
      organization,
      ...payload
    });
  } catch (error) {
    next(error);
  }
});


app.post('/sla/:slaPolicyId/edit', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await updateSlaPolicy(organization._id, req.params.slaPolicyId, req.body);
    res.redirect(`/admin/sla/${req.params.slaPolicyId}`);
  } catch (error) { next(error); }
});

app.post('/sla/:slaPolicyId/rules', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await addSlaRule(organization._id, req.params.slaPolicyId, req.body);
    res.redirect(`/admin/sla/${req.params.slaPolicyId}`);
  } catch (error) {
    next(error);
  }
});


app.get('/users', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const [{ users }, { clients, tree: clientTree }, adminsResult] = await Promise.all([
      listUsers(organization._id),
      listClients(organization._id),
      listAdmins(organization._id)
    ]);
    const flatClients = clients || flattenClientTree(clientTree || []);
    const clientsById = makeClientMap(flatClients);
    const admins = adminsResult?.admins || [];
    const adminByEmail = new Map(admins.map((admin) => [String(admin.email || '').toLowerCase(), admin]));
    const decoratedUsers = (users || []).map((user) => {
      const admin = adminByEmail.get(String(user.email || '').toLowerCase());
      if (admin) adminByEmail.delete(String(user.email || '').toLowerCase());
      return {
        ...user,
        serviceUserId: String(user._id),
        adminId: admin ? String(admin._id) : '',
        isTenantAdmin: Boolean(admin),
        pendingEmail: user.pendingEmail || admin?.pendingEmail || '',
        identityType: 'serviceUser',
        assignmentLabels: (user.assignments || []).map((assignment) => scopeLabel(assignment, clientsById))
      };
    });
    adminByEmail.forEach((admin) => decoratedUsers.push({
      _id: `admin:${admin._id}`,
      serviceUserId: '',
      adminId: String(admin._id),
      name: admin.name,
      email: admin.email,
      status: admin.status,
      isTenantAdmin: true,
      pendingEmail: admin.pendingEmail || '',
      identityType: 'adminOnly',
      assignments: [],
      assignmentLabels: []
    }));
    decoratedUsers.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    res.render('pages/users', {
      title: 'Users',
      organization,
      portal: 'admin',
      users: decoratedUsers,
      clients: flatClients,
      roleLabels: ROLE_LABELS,
      admins,
      notice: String(req.query.notice || '').trim(),
      errorMessage: String(req.query.error || '').trim()
    });
  } catch (error) {
    next(error);
  }
});

app.post('/users', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) {
      if (wantsJsonResponse(req)) return res.status(401).json({ message: 'Your admin session has expired.' });
      return res.redirect('/admin/login');
    }
    const { clients, tree: clientTree } = await listClients(organization._id);
    const flatClients = clients || flattenClientTree(clientTree || []);
    const validClientIds = new Set(flatClients.map((item) => String(item._id)));
    const assignments = assignmentsFromForm(req.body, validClientIds);
    const makeTenantAdmin = req.body.makeTenantAdmin === 'on';
    if (!assignments.length && !makeTenantAdmin) {
      const error = new Error('Assign at least one client, or make this identity a tenant admin.');
      error.status = 400;
      throw error;
    }

    const { user, temporaryPassword } = await createUser({
      organizationId: organization._id,
      name: req.body.name,
      email: req.body.email,
      password: req.body.password || 'password',
      status: req.body.status || 'active',
      assignments,
      allowEmptyAssignments: makeTenantAdmin
    });

    if (makeTenantAdmin) {
      await createAdminUser({ organizationId: organization._id, name: req.body.name, email: req.body.email, password: req.body.password || 'password', role: 'admin' });
    }

    const inviteUser = makeTenantAdmin ? { ...user, userType: 'organizationAdmin' } : user;
    const inviteArgs = { organization, user: inviteUser, temporaryPassword: temporaryPassword || req.body.password || 'password', baseUrl: publicBaseUrl(req), actor: actorSnapshotFromSession(req, 'admin') };
    printInviteMail(inviteArgs);
    const inviteMail = await sendInviteMail(inviteArgs);
    runInBackground(`audit user created ${user.email}`, () => safeAudit(organization._id, { eventType: 'user_created', message: `User ${user.email} created.`, targetType: 'user', targetId: user._id, targetLabel: user.email, actor: actorSnapshotFromSession(req, 'admin') }));

    const mailNote = mailDeliveryLabel(inviteMail, {
      sent: 'Invitation email sent.',
      console: 'Invitation email printed to the Service Desk terminal.',
      failed: 'User created, but the invitation email could not be delivered. Use Send access email to retry.'
    });
    const message = `${user.name} was created. ${mailNote}`;
    const redirect = `/admin/users?notice=${encodeURIComponent(message)}`;
    if (wantsJsonResponse(req)) return res.status(201).json({ message, redirect, mail: inviteMail });
    return res.redirect(redirect);
  } catch (error) {
    return userFormError(req, res, next, error);
  }
});


app.post('/users/:userId/send-access-email', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const { users } = await listUsers(organization._id);
    const user = (users || []).find((item) => String(item._id) === String(req.params.userId));
    if (!user) { const error = new Error('User not found.'); error.status = 404; throw error; }
    if (user.status !== 'active') { const error = new Error('Activate the user before sending an access email.'); error.status = 400; throw error; }

    const reset = await requestPasswordReset({ organizationId: organization._id, email: user.email, portal: 'tenant' });
    if (!reset.resetToken) { const error = new Error('A one-time access link could not be created for this user.'); error.status = 400; throw error; }
    const result = await sendPasswordResetMail({
      organization,
      account: { name: reset.name || user.name || 'User', email: reset.email || user.email },
      resetToken: reset.resetToken,
      accountType: 'user',
      baseUrl: publicBaseUrl(req)
    });
    const notice = mailDeliveryLabel(result, {
      sent: `Access email sent for ${user.name || user.email}.`,
      console: `Access email for ${user.name || user.email} was printed to the Service Desk terminal.`,
      failed: `The access email for ${user.name || user.email} could not be delivered.`
    });
    return res.redirect(`/admin/users?notice=${encodeURIComponent(notice)}`);
  } catch (error) {
    if ([400, 404, 409].includes(Number(error?.status))) return res.redirect(`/admin/users?error=${encodeURIComponent(error.message || 'Unable to send access email.')}`);
    return next(error);
  }
});


app.post('/users/:userId', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) {
      if (wantsJsonResponse(req)) return res.status(401).json({ message: 'Your admin session has expired.' });
      return res.redirect('/admin/login');
    }
    const { clients, tree: clientTree } = await listClients(organization._id);
    const flatClients = clients || flattenClientTree(clientTree || []);
    const validClientIds = new Set(flatClients.map((item) => String(item._id)));
    const assignments = assignmentsFromForm(req.body, validClientIds);
    const makeTenantAdmin = req.body.makeTenantAdmin === 'on';
    if (!assignments.length && !makeTenantAdmin) {
      const error = new Error('Assign at least one client, or keep tenant admin access enabled.');
      error.status = 400;
      throw error;
    }

    const { user } = await updateUser(req.params.userId, {
      organizationId: organization._id,
      name: req.body.name,
      status: req.body.status,
      password: req.body.password || '',
      assignments,
      allowEmptyAssignments: makeTenantAdmin
    });
    if (makeTenantAdmin) {
      await createAdminUser({ organizationId: organization._id, name: req.body.name, email: req.body.email, password: req.body.password || 'password', role: 'admin' });
    }
    let emailNotice = '';
    const requestedNewEmail = String(req.body.newEmail || '').trim().toLowerCase();
    if (requestedNewEmail && requestedNewEmail !== String(req.body.email || '').trim().toLowerCase()) {
      const change = await requestUserEmailChange(req.params.userId, { organizationId: organization._id, newEmail: requestedNewEmail });
      const baseUrl = publicBaseUrl(req);
      runInBackground(`user email verification ${requestedNewEmail}`, () => sendUserEmailVerificationMail({ organization, userName: change.name, currentEmail: change.currentEmail, newEmail: change.pendingEmail, token: change.token, baseUrl }));
      emailNotice = ` Verification sent to ${requestedNewEmail}; the current login remains active until verified.`;
    }
    runInBackground(`audit user updated ${req.body.email || req.params.userId}`, () => safeAudit(organization._id, { eventType: 'user_updated', message: `User ${req.body.email || req.params.userId} updated.`, targetType: 'user', targetId: req.params.userId, targetLabel: req.body.email || req.body.name || req.params.userId, actor: actorSnapshotFromSession(req, 'admin') }));

    const label = user?.name || req.body.name || 'User';
    const redirect = `/admin/users?notice=${encodeURIComponent(`${label} was updated.${emailNotice}`)}`;
    if (wantsJsonResponse(req)) return res.json({ message: `${label} was updated.${emailNotice}`, redirect });
    return res.redirect(redirect);
  } catch (error) {
    return userFormError(req, res, next, error);
  }
});


app.post('/admins/:adminId/email-change', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const newEmail = String(req.body.newEmail || '').trim().toLowerCase();
    const change = await requestAdminEmailChange(req.params.adminId, { organizationId: organization._id, newEmail });
    const baseUrl = publicBaseUrl(req);
    runInBackground(`admin email verification ${newEmail}`, () => sendAdminEmailVerificationMail({ organization, adminName: change.name, currentEmail: change.currentEmail, newEmail: change.pendingEmail, token: change.token, baseUrl }));
    req.session.globalFormNotice = `Verification link sent to ${newEmail}. The current login email remains active until it is verified.`;
    return req.session.save(() => res.redirect('/admin/users'));
  } catch (error) { next(error); }
});

app.get('/support-paths', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const [{ supportPaths }, { tree }] = await Promise.all([listSupportPaths(organization._id), listIssueTypes(organization._id)]);
    res.render('pages/support-paths', { title: 'Support Paths', organization, supportPaths, tree, errorMessage: null });
  } catch (error) { next(error); }
});

app.post('/support-paths', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const { supportPath } = await createSupportPath(organization._id, { name: req.body.name, description: req.body.description });
    res.redirect(`/admin/support-paths/${supportPath._id}`);
  } catch (error) { next(error); }
});

app.post('/support-paths/preset/:presetKey', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const { supportPath } = await applySupportPathPreset(organization._id, req.params.presetKey);
    res.redirect(`/admin/support-paths/${supportPath._id}`);
  } catch (error) { next(error); }
});

app.get('/support-paths/:supportPathId', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const [{ supportPath }, { workflows }] = await Promise.all([
      getSupportPath(organization._id, req.params.supportPathId),
      listWorkflows(organization._id)
    ]);
    res.render('pages/support-path-detail', { title: supportPath.name, organization, supportPath, workflows: workflows || [], errorMessage: null });
  } catch (error) { next(error); }
});


app.post('/support-paths/:supportPathId/edit', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await updateSupportPath(organization._id, req.params.supportPathId, req.body);
    res.redirect(`/admin/support-paths/${req.params.supportPathId}`);
  } catch (error) { next(error); }
});

app.post('/support-paths/:supportPathId/levels', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await addSupportPathLevel(organization._id, req.params.supportPathId, req.body);
    res.redirect(`/admin/support-paths/${req.params.supportPathId}`);
  } catch (error) { next(error); }
});


app.post('/support-paths/:supportPathId/levels/:levelId', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await updateSupportPathLevel(organization._id, req.params.supportPathId, req.params.levelId, req.body);
    res.redirect(`/admin/support-paths/${req.params.supportPathId}`);
  } catch (error) { next(error); }
});

app.post('/support-paths/:supportPathId/levels/:levelId/workflow', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await assignWorkflowToSupportLevel(organization._id, req.params.supportPathId, req.params.levelId, req.body.workflowId || '');
    res.redirect(`/admin/support-paths/${req.params.supportPathId}`);
  } catch (error) { next(error); }
});

app.post('/support-paths/:supportPathId/rules', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await addSupportPathRule(organization._id, req.params.supportPathId, req.body);
    res.redirect(`/admin/support-paths/${req.params.supportPathId}`);
  } catch (error) { next(error); }
});

app.get('/client-code/suggest', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.status(401).json({ message: 'No active organization.' });
    const result = await suggestClientCode(organization._id, {
      name: req.query.name || '',
      shortCode: req.query.shortCode || '',
      excludeClientId: req.query.excludeClientId || ''
    });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

app.get('/clients', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const [{ clients, tree: clientTree }, { tree }, { slaPolicies }, configResponse] = await Promise.all([
      listClients(organization._id),
      listIssueTypes(organization._id),
      listSlaPolicies(organization._id),
      getOperationalConfig(organization._id)
    ]);

    const flatClients = clients || flattenClientTree(clientTree || []);
    const clientsById = makeClientMap(flatClients);
    const familyById = new Map((tree || []).map((family) => [String(family._id), family.name]));
    const decoratedClients = flatClients.map((client) => {
      const familyIds = resolveEffectiveLevel1Ids(client, clientsById);
      return { ...client, enabledFamilyNames: familyIds.map((id) => familyById.get(String(id))).filter(Boolean) };
    });

    res.render('pages/clients', {
      title: 'Clients',
      organization,
      clients: decoratedClients,
      clientTree: clientTree || [],
      tree,
      slaPolicies,
      regions: configResponse.regions || [],
      subregions: configResponse.subregions || [],
      createdClientId: String(req.query.created || ''),
      form: {},
      errorMessage: null
    });
  } catch (error) {
    next(error);
  }
});

app.post('/clients', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const { client } = await createClient(organization._id, req.body);
    req.session.globalFormNotice = `${client.name} was created.`;
    req.session.newClientId = String(client._id);
    return req.session.save(() => res.redirect(`/admin/clients?created=${encodeURIComponent(client._id)}`));
  } catch (error) {
    next(error);
  }
});

app.get('/clients/:clientId', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');

    const [{ client }, { clients, tree: clientTree }, { tree }, { slaPolicies }, configResponse, { supportPaths }, usersResult] = await Promise.all([
      getClient(organization._id, req.params.clientId),
      listClients(organization._id),
      listIssueTypes(organization._id),
      listSlaPolicies(organization._id),
      getOperationalConfig(organization._id),
      listSupportPaths(organization._id),
      listUsers(organization._id)
    ]);

    const flatClients = clients || flattenClientTree(clientTree || []);
    const clientsById = makeClientMap(flatClients);
    const parentClient = client.parentClientId ? clientsById.get(String(client.parentClientId)) || null : null;
    const childClients = flatClients.filter((item) => String(item.parentClientId || '') === String(client._id));
    const effectiveLevel1Ids = resolveEffectiveLevel1Ids(client, clientsById);
    const effectiveSlaPolicyId = resolveEffectiveSlaPolicyId(client, clientsById);
    const effectiveProductConfig = resolveEffectiveProductConfig(client, clientsById);
    const effectiveEnvironmentIds = resolveEffectiveEnvironmentIds(client, clientsById);
    const defaultSlaPolicy = (slaPolicies || []).find((policy) => String(policy._id) === String(effectiveSlaPolicyId || '')) || null;
    const clientId = String(client._id);
    const clientUsers = (usersResult?.users || []).map((user) => {
      const matches = (user.assignments || []).filter((assignment) => {
        if (String(assignment.clientId || '') === clientId) return true;
        return assignment.includeChildren === true && includeChildSet(assignment.clientId, flatClients).has(clientId);
      });
      return {
        ...user,
        matchingAssignments: matches,
        matchingRoleLabels: [...new Set(matches.map((assignment) => ROLE_LABELS[assignment.role] || assignment.role))],
        inheritedAccess: matches.length > 0 && matches.every((assignment) => String(assignment.clientId || '') !== clientId)
      };
    }).filter((user) => user.matchingAssignments.length).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));

    res.render('pages/client-detail', {
      title: client.name,
      organization,
      selectedClient: client,
      clients: flatClients,
      parentClient,
      childClients,
      tree,
      slaPolicies,
      regions: configResponse.regions || [],
      subregions: configResponse.subregions || [],
      products: configResponse.products || [],
      modules: configResponse.modules || [],
      environments: configResponse.environments || [],
      severities: configResponse.severities || [],
      supportPaths: supportPaths || [],
      effectiveLevel1Ids,
      effectiveSlaPolicyId,
      effectiveProductIds: effectiveProductConfig.productIds,
      effectiveModuleIds: effectiveProductConfig.moduleIds,
      effectiveEnvironmentIds,
      defaultSlaPolicy,
      clientUsers,
      roleLabels: ROLE_LABELS,
      errorMessage: null
    });
  } catch (error) {
    next(error);
  }
});

app.post('/clients/:clientId/edit', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await updateClient(organization._id, req.params.clientId, req.body);
    res.redirect(`/admin/clients/${req.params.clientId}`);
  } catch (error) {
    next(error);
  }
});

app.post('/clients/:clientId/delete', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const [{ client }, usage, { users }] = await Promise.all([
      getClient(organization._id, req.params.clientId),
      getClientRequestUsage(organization._id, req.params.clientId),
      listUsers(organization._id)
    ]);
    if (String(req.body.confirmCode || '').trim().toUpperCase() !== String(client.shortCode || '').toUpperCase()) {
      const error = new Error(`Type ${client.shortCode} exactly to confirm permanent deletion.`);
      error.status = 400;
      throw error;
    }
    if (Number(usage.requestCount || 0) > 0) {
      const error = new Error(`This client has ${usage.requestCount} historical request${Number(usage.requestCount) === 1 ? '' : 's'}. Deactivate it instead of deleting it.`);
      error.status = 409;
      throw error;
    }
    const assignedUsers = (users || []).filter((user) => (user.assignments || []).some((assignment) => String(assignment.clientId || '') === String(client._id)));
    if (assignedUsers.length) {
      const error = new Error(`This client is assigned to ${assignedUsers.length} user${assignedUsers.length === 1 ? '' : 's'}. Remove those assignments or deactivate the client.`);
      error.status = 409;
      throw error;
    }
    await deleteClient(organization._id, req.params.clientId);
    await safeAudit(organization._id, { eventType: 'client_deleted', message: `Client ${client.name} (${client.shortCode}) deleted.`, targetType: 'client', targetId: client._id, targetLabel: client.name, actor: actorSnapshotFromSession(req, 'admin') });
    req.session.globalFormNotice = `${client.name} was deleted.`;
    res.redirect('/admin/clients');
  } catch (error) {
    next(error);
  }
});

app.post('/clients/:clientId/availability', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');

    await updateClientAvailability(organization._id, req.params.clientId, {
      issueTypeMode: req.body.issueTypeMode || 'custom',
      enabledFamilyIds: toArray(req.body.familyIds)
    });
    res.redirect(`/admin/clients/${req.params.clientId}`);
  } catch (error) {
    next(error);
  }
});



app.post('/clients/:clientId/context', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    const businessHolidays = String(req.body.businessHolidays || '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [date, ...nameParts] = line.split(/[|,]/);
        return { date: String(date || '').trim(), name: nameParts.join(' ').trim() };
      })
      .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(item.date));
    await updateClientContext(organization._id, req.params.clientId, {
      regionId: req.body.regionId || '',
      subregionId: req.body.subregionId || '',
      timezone: req.body.timezone || '',
      enabledEnvironmentIds: toArray(req.body.environmentIds),
      businessCalendarMode: req.body.businessCalendarMode === 'inherit' ? 'inherit' : 'custom',
      businessCalendar: {
        timezone: req.body.timezone || '',
        workingDays: toArray(req.body.workingDays).map(Number),
        dayStart: req.body.businessDayStart || '09:00',
        dayEnd: req.body.businessDayEnd || '17:00',
        holidays: businessHolidays
      }
    });
    res.redirect(`/admin/clients/${req.params.clientId}`);
  } catch (error) {
    next(error);
  }
});

app.post('/clients/:clientId/operational-rules', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await addClientOperationalRule(organization._id, req.params.clientId, {
      level2TypeId: req.body.level2TypeId,
      supportPathId: req.body.supportPathId,
      severityIds: toArray(req.body.severityIds),
      environmentIds: toArray(req.body.environmentIds),
      inheritToChildren: req.body.inheritToChildren === 'on',
      isActive: req.body.isActive === 'on'
    });
    res.redirect(`/admin/clients/${req.params.clientId}`);
  } catch (error) { next(error); }
});

app.post('/clients/:clientId/products', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await updateClientProducts(organization._id, req.params.clientId, {
      productModuleMode: req.body.productModuleMode || 'custom',
      enabledProductIds: toArray(req.body.productIds),
      enabledModuleIds: toArray(req.body.moduleIds)
    });
    res.redirect(`/admin/clients/${req.params.clientId}`);
  } catch (error) {
    next(error);
  }
});

app.post('/clients/:clientId/sla', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await assignClientSlaPolicy(organization._id, req.params.clientId, {
      slaMode: req.body.slaMode || 'custom',
      slaPolicyId: req.body.slaPolicyId || ''
    });
    res.redirect(`/admin/clients/${req.params.clientId}`);
  } catch (error) {
    next(error);
  }
});


app.post('/clients/:clientId/sla-family', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');
    await assignClientFamilySlaPolicy(organization._id, req.params.clientId, {
      level1TypeId: req.body.level1TypeId || '',
      slaPolicyId: req.body.slaPolicyId || '',
      inheritToChildren: req.body.inheritToChildren === 'on'
    });
    res.redirect(`/admin/clients/${req.params.clientId}`);
  } catch (error) {
    next(error);
  }
});

app.get('/clients/:clientId/preview', async (req, res, next) => {
  try {
    const organization = await ensureWorkspace(req, res);
    if (!organization) return res.redirect('/admin/login');

    const [{ client }, { clients, tree: clientTree }, { tree }] = await Promise.all([
      getClient(organization._id, req.params.clientId),
      listClients(organization._id),
      listIssueTypes(organization._id)
    ]);

    const flatClients = clients || flattenClientTree(clientTree || []);
    const activeTree = activeTreeForClient(tree, client, flatClients);
    const selectedTypeId = req.query.type || activeTree[0]?._id;
    const selectedType = activeTree.find((item) => String(item._id) === String(selectedTypeId)) || activeTree[0] || null;

    res.render('pages/intake-preview', {
      title: 'Intake Preview',
      organization,
      selectedClient: client,
      activeTree,
      selectedType
    });
  } catch (error) {
    next(error);
  }
});



async function renderFiltersPage(req, res, next, { organization, actor, portal }) {
  try {
    const target = ['clients', 'requests'].includes(String(req.query.target || '')) ? String(req.query.target) : 'requests';
    const query = String(req.query.q || '').trim();
    const context = await getRequestPageContext({ organization, actor, portal });
    const tenantSlug = req.session.tenantSlug || organizationSlug(organization);
    const portalBase = portalBasePath(portal, tenantSlug);
    let requestRows = [];
    let clientRows = [];
    const clientsById = makeClientMap(context.clients);
    if (target === 'clients') {
      clientRows = filterRecords(portal === 'admin' ? context.clients : context.accessibleClients, query, 'clients', clientsById);
    } else {
      const scopedClientIds = portal === 'admin' ? [] : context.accessibleClients.map((client) => String(client._id));
      const { requests } = await listRequests(organization._id, { clientIds: scopedClientIds });
      requestRows = (requests || [])
        .filter((item) => {
          if (portal === 'admin') return true;
          const assignment = bestAssignmentForClient(actor, item.client?.id, context.clients, portal);
          return assignmentCanSeeRequest(assignment, item, portal);
        })
        .map((item) => summarizeRequest(item, portal, bestAssignmentForClient(actor, item.client?.id, context.clients, portal)));
      requestRows = filterRecords(requestRows, query, 'requests', clientsById);
    }
    res.render('pages/filters', { title: 'Filters', organization, portal, actor, portalBase, target, query, requestRows, clientRows, clientsById, requestsLink: target === 'requests' && query ? sunQueryRequestLink(portalBase, query) : `${portalBase}/requests` });
  } catch (error) { next(error); }
}

async function renderSavedFiltersPage(req, res, next, { organization, actor, portal }) {
  try {
    const tenantSlug = req.session.tenantSlug || organizationSlug(organization);
    const portalBase = portalBasePath(portal, tenantSlug);
    const { filters } = await listSavedFilters(organization._id);
    res.render('pages/saved-filters', { title: 'Saved Filters', organization, portal, actor, portalBase, savedFilters: filters || [] });
  } catch (error) { next(error); }
}

app.get('/admin/filters', async (req, res, next) => {
  try {
    const { organization, actor, allowed } = await resolvePortalAccess(req, 'admin');
    if (!allowed) return res.redirect('/admin/login');
    await renderFiltersPage(req, res, next, { organization, actor, portal: 'admin' });
  } catch (error) { next(error); }
});

app.post('/admin/filters/save', async (req, res, next) => {
  try {
    const { organization, actor, allowed } = await resolvePortalAccess(req, 'admin');
    if (!allowed) return res.redirect('/admin/login');
    await saveSunFilter(organization._id, { name: req.body.name, target: req.body.target, query: req.body.query, createdBy: actor.email, createdByRole: actor.userType || 'organizationAdmin', visibilityScope: req.body.visibilityScope || 'private' });
    res.redirect(`/admin/filters?target=${encodeURIComponent(req.body.target || 'requests')}&q=${encodeURIComponent(req.body.query || '')}`);
  } catch (error) { next(error); }
});

app.get('/admin/saved-filters', async (req, res, next) => {
  try {
    const { organization, actor, allowed } = await resolvePortalAccess(req, 'admin');
    if (!allowed) return res.redirect('/admin/login');
    await renderSavedFiltersPage(req, res, next, { organization, actor, portal: 'admin' });
  } catch (error) { next(error); }
});

app.post('/admin/saved-filters/:filterId/visibility', async (req, res, next) => {
  try {
    const { organization, allowed } = await resolvePortalAccess(req, 'admin');
    if (!allowed) return res.redirect('/admin/login');
    await updateSunFilterVisibility(organization._id, req.params.filterId, req.body.visibilityScope || 'private');
    res.redirect('/admin/saved-filters');
  } catch (error) { next(error); }
});

app.post('/admin/saved-filters/:filterId/delete', async (req, res, next) => {
  try {
    const { organization, allowed } = await resolvePortalAccess(req, 'admin');
    if (!allowed) return res.redirect('/admin/login');
    await deleteSunFilter(organization._id, req.params.filterId);
    res.redirect('/admin/saved-filters');
  } catch (error) { next(error); }
});

app.post('/admin/filters/:filterId/delete', async (req, res, next) => {
  try {
    const { organization, allowed } = await resolvePortalAccess(req, 'admin');
    if (!allowed) return res.redirect('/admin/login');
    await deleteSunFilter(organization._id, req.params.filterId);
    res.redirect('/admin/saved-filters');
  } catch (error) { next(error); }
});

app.get('/:tenant/filters', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    await renderFiltersPage(req, res, next, access);
  } catch (error) { next(error); }
});

app.post('/:tenant/filters/save', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    const { organization, actor } = access;
    await saveSunFilter(organization._id, { name: req.body.name, target: req.body.target, query: req.body.query, createdBy: actor.email, createdByRole: actor.userType || 'serviceUser', visibilityScope: req.body.visibilityScope || 'private' });
    res.redirect(`/${req.params.tenant}/filters?target=${encodeURIComponent(req.body.target || 'requests')}&q=${encodeURIComponent(req.body.query || '')}`);
  } catch (error) { next(error); }
});

app.get('/:tenant/saved-filters', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    await renderSavedFiltersPage(req, res, next, access);
  } catch (error) { next(error); }
});

app.post('/:tenant/saved-filters/:filterId/visibility', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    await updateSunFilterVisibility(access.organization._id, req.params.filterId, req.body.visibilityScope || 'private');
    res.redirect(`/${req.params.tenant}/saved-filters`);
  } catch (error) { next(error); }
});

app.post('/:tenant/saved-filters/:filterId/delete', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    await deleteSunFilter(access.organization._id, req.params.filterId);
    res.redirect(`/${req.params.tenant}/saved-filters`);
  } catch (error) { next(error); }
});

app.post('/:tenant/filters/:filterId/delete', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    await deleteSunFilter(access.organization._id, req.params.filterId);
    res.redirect(`/${req.params.tenant}/saved-filters`);
  } catch (error) { next(error); }
});

async function renderRequestList(req, res, next, { organization, actor, portal = 'admin' }) {
  try {
    const context = await getRequestPageContext({ organization, actor, portal });
    const clientIds = portal === 'admin' ? [] : context.accessibleClients.map((client) => String(client._id));
    const filterParams = requestQueryParams(req.query);
    const listParams = { ...filterParams, clientIds };
    if (filterParams.mine === '1') {
      listParams.assigneeActorId = String(actor?._id || actor?.id || '');
      listParams.assigneeEmail = String(actor?.email || '').toLowerCase();
    }
    const requestResponse = await listRequests(organization._id, listParams);
    let visibleRequests = (requestResponse.requests || []).filter((item) => {
      if (portal === 'admin') return true;
      const assignment = bestAssignmentForClient(actor, item.client?.id, context.clients, portal);
      return assignmentCanSeeRequest(assignment, item, portal);
    });

    if (String(req.query.attention || '') === 'escalation') {
      visibleRequests = visibleRequests.filter((item) => {
        // Normal L1→L2→L3 support-path movement is routing, not an escalation.
        // Open Escalations is intentionally reserved for explicit escalations
        // and already-breached SLA commitments.
        const slaBreached = String(item.sla?.rag || '').toLowerCase() === 'red'
          || String(item.sla?.state || '').toLowerCase() === 'breached';
        const explicitlyEscalated = (item.timeline || []).some((event) =>
          ['manual_escalation', 'escalated', 'sla_breached'].includes(String(event.eventType || ''))
        );
        return slaBreached || explicitlyEscalated;
      });
    }

    const decorated = visibleRequests.map((item) => {
      const assignment = portal === 'admin' ? null : bestAssignmentForClient(actor, item.client?.id, context.clients, portal);
      return applyCurrentSupportConfiguration(summarizeRequest(item, portal, assignment), item, context);
    });
    const tenantSlug = req.session.tenantSlug || organizationSlug(organization);
    const basePath = requestListPath(portal, tenantSlug);
    const pagination = requestResponse.pagination || { page: filterParams.page, pageSize: 50, total: decorated.length, totalPages: 1 };
    res.render('pages/requests', {
      title: 'See requests',
      organization,
      portal,
      actor,
      requests: decorated,
      accessibleClients: context.accessibleClients,
      filters: filterParams,
      pagination,
      pageLink: (page) => withQuery(basePath, { ...filterParams, page }),
      listPath: basePath,
      newPath: requestNewPath(portal, tenantSlug),
      detailPath: (requestId) => requestDetailPath(portal, requestId, tenantSlug),
      activeFilterLabel: filterParams.fromFilters === '1' ? filterParams.activeFilter : ''
    });
  } catch (error) {
    next(error);
  }
}

async function renderRequestNew(req, res, next, { organization, actor, portal = 'admin', form = {}, errorMessage = null }) {
  try {
    const context = await getRequestPageContext({ organization, actor, portal });
    const state = selectedRequestCreationState(req, context, portal);
    const tenantSlug = req.session.tenantSlug || organizationSlug(organization);
    res.render('pages/request-new', {
      title: 'Raise Request',
      organization,
      portal,
      actor,
      ...context,
      ...state,
      form,
      errorMessage,
      listPath: requestListPath(portal, tenantSlug),
      submitPath: requestListPath(portal, tenantSlug),
      newPath: requestNewPath(portal, tenantSlug)
    });
  } catch (error) {
    next(error);
  }
}

async function renderRequestDetail(req, res, next, { organization, actor, portal = 'admin', requestId }) {
  try {
    const context = await getRequestPageContext({ organization, actor, portal });
    const [{ request }, usersResponse] = await Promise.all([
      getServiceRequest(organization._id, requestId),
      listUsers(organization._id)
    ]);
    const activeAssignment = portal === 'admin' ? null : bestAssignmentForClient(actor, request.client?.id, context.clients, portal);
    const allUsers = usersResponse.users || [];
    if (portal !== 'admin' && !assignmentCanSeeRequest(activeAssignment, request, portal)) {
      return res.status(404).render('pages/error', { title: 'Request not found', status: 404, message: 'This request is not visible in your current portal assignment.' });
    }

    const configuredBehavior = configuredBehaviorForRequest(request, context);
    const configuredSaasRequest = String(configuredBehavior?.formDefinitionKey || '').trim().toUpperCase().startsWith('SAAS_')
      || requestLooksLikeV23Incident(request, configuredBehavior, currentSupportPathForRequest(request, context));
    let fallbackWorkflow = request.workflow?.id ? context.workflows.find((item) => String(item._id) === String(request.workflow.id)) || null : null;
    if (!fallbackWorkflow) fallbackWorkflow = configuredBehavior?.workflow || null;
    const supportPath = currentSupportPathForRequest(request, context);
    const supportPathDefinition = supportPathDefinitionForRequest(request, context);

    let activeStages = Array.isArray(request.activeStages) ? request.activeStages : [];
    if (!activeStages.length) {
      const configuredLevel = (supportPathDefinition.levels || []).find((item) => item.localId === (request.currentSupportLevel || 'L1'))
        || { localId: request.currentSupportLevel || 'L1', label: request.currentSupportLevel || 'L1', ownerSide: request.ownerSide || ownerSideFromSupportLevel(request.currentSupportLevel || 'L1'), workflow: fallbackWorkflow };
      activeStages = [{
        ...makeSupportStage(configuredLevel, fallbackWorkflow, true),
        workflow: request.workflow?.id ? request.workflow : makeRef(configuredLevel.workflow || fallbackWorkflow),
        workflowDefinition: request.workflowDefinition?.statuses?.length ? request.workflowDefinition : workflowDefinitionFrom(configuredLevel.workflow || fallbackWorkflow),
        currentStatus: request.currentStatus || workflowInitialStatus(configuredLevel.workflow || fallbackWorkflow)
      }];
    }
    if (!activeStages.some((stage) => stage.isPrimary) && activeStages.length) activeStages[0].isPrimary = true;

    const allTasks = request.tasks || [];
    const v23SaasRequest = isV23SaasRequestRecord(request) || configuredSaasRequest;
    const stageViews = activeStages.map((rawStage) => {
      const stage = effectiveStageAgainstPath(rawStage, supportPath) || rawStage;
      const definition = rawStage.workflowDefinition?.statuses?.length
        ? rawStage.workflowDefinition
        : (stage.configuredWorkflowDefinition?.statuses?.length
            ? stage.configuredWorkflowDefinition
            : (rawStage.isPrimary && request.workflowDefinition?.statuses?.length ? request.workflowDefinition : workflowDefinitionFrom(fallbackWorkflow)));
      const currentStatus = rawStage.currentStatus || (rawStage.isPrimary ? request.currentStatus : workflowInitialStatus(stage.workflow));
      const stageLevel = stage.localId || request.currentSupportLevel || 'L1';
      const eligibleAssignees = eligibleStageAssignees(allUsers, request.client?.id, context.clients, stageLevel, stage.ownerSide)
        .map((user) => ({
          ...user,
          isCurrentActor: String(user._id || '') === String(actor?._id || '')
            || String(user.email || '').toLowerCase() === String(actor?.email || '').toLowerCase()
        }))
        .sort((left, right) => Number(Boolean(right.isCurrentActor)) - Number(Boolean(left.isCurrentActor))
          || String(left.name || left.email || '').localeCompare(String(right.name || right.email || '')));
      const storedAssignedTo = rawStage.assignedTo || {};
      const storedAssignmentIsEligible = stageAssignmentIsEligible({ ...stage, assignedTo: storedAssignedTo }, eligibleAssignees);
      const assignedTo = storedAssignmentIsEligible ? storedAssignedTo : {};
      const staleAssignedTo = !storedAssignmentIsEligible && (storedAssignedTo.actorId || storedAssignedTo.email) ? storedAssignedTo : null;
      const isAssigned = Boolean(assignedTo.actorId || assignedTo.email);
      const actorOwnsStage = isAssigned && actorMatchesStageOwner(actor, { ...stage, assignedTo });
      const baseCanAct = portal === 'admin' || assignmentMatchesStage(activeAssignment, stage, stageLevel);
      const actorIsEligibleForStage = portal === 'admin' || actorMatchesEligibleAssignee(actor, eligibleAssignees);
      // v23 SaaS intentionally removes the separate Ownership card. An eligible user
      // may act on an unassigned stage; the first status action atomically claims it.
      const stageCanAct = portal === 'admin' || (baseCanAct && (actorOwnsStage || (v23SaasRequest && !isAssigned && actorIsEligibleForStage)));
      const canTakeOwnership = portal !== 'admin' && portal !== 'client' && baseCanAct && !isAssigned && actorIsEligibleForStage && !v23SaasRequest;
      // Any eligible operational user can dispatch work to an eligible peer on the same stage.
      // Tenant Admin retains an organization-wide override.
      const canAssignOthers = portal === 'admin' || (portal !== 'client' && baseCanAct && actorIsEligibleForStage);
      const allowedStatusIds = new Set((definition.transitions || []).filter((item) => item.fromStatusId === currentStatus?.localId).map((item) => item.toStatusId));
      let options = stageCanAct
        ? (portal === 'admin'
            ? (definition.statuses || []).filter((item) => item.localId !== currentStatus?.localId)
            : (definition.statuses || []).filter((item) => allowedStatusIds.has(item.localId)))
        : [];
      if (portal === 'client') options = options.filter((item) => item.isCustomerVisible !== false);
      options = options.map((item) => ({ ...item, isConfiguredTransition: allowedStatusIds.has(item.localId) }));
      const tasks = allTasks.filter((task) => task.sourceStageId === stage.localId).filter((task) => {
        if (portal === 'client') return task.visibility === 'client_visible';
        if (activeAssignment?.role === 'partnerUser') return ['client_visible', 'partner_visible'].includes(task.visibility || 'internal_only');
        return true;
      });
      return {
        ...stage,
        workflowDefinition: definition,
        currentStatus,
        assignedTo,
        staleAssignedTo,
        eligibleAssignees,
        actorOwnsStage,
        canTakeOwnership,
        canAssignOthers,
        canAct: stageCanAct,
        statusOptions: options,
        tasks,
        openBlockingTasks: tasks.filter((task) => task.isBlocking && !['done', 'cancelled'].includes(task.status)),
        supportActions: (supportPathDefinition.movementRules || []).filter((item) => item.fromLevelId === stageLevel)
      };
    });
    const primaryStage = stageViews.find((stage) => stage.isPrimary) || stageViews[0] || null;
    const visibleStageViews = portal === 'client' ? stageViews.filter((stage) => stage.isPrimary) : stageViews;
    const workflowDefinition = primaryStage?.workflowDefinition || request.workflowDefinition || workflowDefinitionFrom(fallbackWorkflow);
    const canAct = primaryStage?.canAct || false;
    const statusOptions = primaryStage?.statusOptions || [];
    const supportActions = stageViews.flatMap((stage) => stage.canAct ? (stage.supportActions || []).map((action) => ({ ...action, sourceStageId: stage.localId })) : []);

    const decoratedRequest = applyCurrentSupportConfiguration(summarizeRequest(request, portal, activeAssignment), request, context);
    if (v23SaasRequest && !decoratedRequest.serviceModelKey) decoratedRequest.serviceModelKey = 'SUNTEC_SAAS_V23';
    decoratedRequest.slaView = buildSlaView(decoratedRequest.sla || {});
    decoratedRequest.slaLabel = decoratedRequest.slaView.label || 'not applicable';
    decoratedRequest.slaRag = decoratedRequest.slaView.rag || 'grey';
    decoratedRequest.slaReason = decoratedRequest.slaView.reason || '';
    decoratedRequest.responseDueLabel = decoratedRequest.slaView.responseDueLabel || '';
    decoratedRequest.resolutionDueLabel = decoratedRequest.slaView.resolutionDueLabel || '';
    if ((!decoratedRequest.workflow?.name) && fallbackWorkflow) decoratedRequest.workflow = makeRef(fallbackWorkflow);
    if ((!decoratedRequest.supportPath?.name) && supportPath) decoratedRequest.supportPath = makeRef(supportPath);
    const tenantSlug = req.session.tenantSlug || organizationSlug(organization);

    res.render('pages/request-detail', {
      title: request.requestNumber,
      organization,
      portal,
      actor,
      activeAssignment,
      severities: context.severities || [],
      priorities: context.priorities || [],
      roleLabels: ROLE_LABELS,
      canAct,
      request: decoratedRequest,
      workflowDefinition,
      supportPathDefinition,
      stageViews: visibleStageViews,
      allStageViews: stageViews,
      statusOptions,
      supportActions,
      actionNotice: String(req.query.notice || '').trim().slice(0, 300),
      actionError: String(req.query.error || '').trim().slice(0, 500),
      listPath: requestListPath(portal, tenantSlug),
      newPath: requestNewPath(portal, tenantSlug),
      actionBase: requestDetailPath(portal, requestId, tenantSlug),
      taskBase: taskListPath(portal, tenantSlug)
    });
  } catch (error) {
    next(error);
  }
}


function taskVisibleToPortal(task, portal, assignment = null) {
  if (portal === 'admin') return true;
  if (portal === 'client') return task.visibility === 'client_visible';
  if (assignment?.role === 'partnerUser') return ['client_visible', 'partner_visible'].includes(task.visibility || 'internal_only');
  return true;
}

function decorateTask(task = {}) {
  const statusLabels = { open: 'To Do', in_progress: 'In Progress', blocked: 'Waiting', done: 'Completed', cancelled: 'Cancelled' };
  return {
    ...task,
    statusLabel: statusLabels[task.status] || labelFromKey(task.status || 'open'),
    createdLabel: task.createdAt ? new Date(task.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '',
    dueLabel: task.dueAt ? new Date(task.dueAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '',
    completedLabel: task.completedAt ? new Date(task.completedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : ''
  };
}

async function renderTaskList(req, res, next, { organization, actor, portal = 'admin' }) {
  try {
    const context = await getRequestPageContext({ organization, actor, portal });
    const tenantSlug = req.session.tenantSlug || organizationSlug(organization);
    const visibilityScopes = portal === 'client' ? 'client_visible' : '';
    const response = await listRequestTasks(organization._id, {
      pageSize: 200,
      search: req.query.search,
      status: req.query.status,
      supportLevel: req.query.supportLevel,
      clientId: req.query.clientId,
      blocking: req.query.blocking,
      visibilityScopes
    });
    const accessibleIds = new Set((context.accessibleClients || []).map((client) => String(client._id)));
    const tasks = (response.tasks || []).filter((task) => {
      if (portal === 'admin') return true;
      if (!accessibleIds.has(String(task.client?.id || ''))) return false;
      const assignment = bestAssignmentForClient(actor, task.client?.id, context.clients, portal);
      const requestSummary = { visibilityScope: task.requestVisibilityScope || 'client_visible' };
      return assignmentCanSeeRequest(assignment, requestSummary, portal) && taskVisibleToPortal(task, portal, assignment);
    }).map(decorateTask);
    res.render('pages/tasks', {
      title: 'Tasks', organization, actor, portal, tasks,
      clients: portal === 'admin' ? context.clients : context.accessibleClients,
      filters: {
        search: String(req.query.search || ''),
        status: String(req.query.status || ''),
        supportLevel: String(req.query.supportLevel || ''),
        clientId: String(req.query.clientId || ''),
        blocking: String(req.query.blocking || '')
      },
      listPath: taskListPath(portal, tenantSlug),
      requestBase: requestListPath(portal, tenantSlug)
    });
  } catch (error) { next(error); }
}

async function resolveTaskAccess({ organization, actor, portal, taskId }) {
  const context = await getRequestPageContext({ organization, actor, portal });
  const result = await getRequestTask(organization._id, taskId);
  const assignment = portal === 'admin' ? null : bestAssignmentForClient(actor, result.request.client?.id, context.clients, portal);
  if (portal !== 'admin' && (!assignmentCanSeeRequest(assignment, result.request, portal) || !taskVisibleToPortal(result.task, portal, assignment))) {
    const error = new Error('This task is not visible in your current portal assignment.');
    error.status = 404;
    throw error;
  }
  return { ...result, assignment, context };
}

async function renderTaskDetail(req, res, next, { organization, actor, portal = 'admin', taskId }) {
  try {
    const { request, task, assignment, context } = await resolveTaskAccess({ organization, actor, portal, taskId });
    const usersResponse = portal === 'client' ? { users: [] } : await listUsers(organization._id);
    const taskUsers = (usersResponse.users || []).filter((user) => (user.status || 'active') === 'active');
    const tenantSlug = req.session.tenantSlug || organizationSlug(organization);
    const taskLevel = task.sourceStageId || request.currentSupportLevel || 'L1';
    const storedTaskStage = (request.activeStages || []).find((stage) => stage.localId === taskLevel) || null;
    const taskStage = effectiveStageAgainstPath(storedTaskStage, currentSupportPathForRequest(request, context));
    const canAct = canWorkSupportStage({ portal, actor, assignment, stage: taskStage, level: taskLevel });
    const visibleComments = (task.comments || []).filter((comment) => {
      if (portal === 'admin') return true;
      if (portal === 'client') return comment.visibility === 'client_visible';
      if (assignment?.role === 'partnerUser') return ['client_visible', 'partner_visible'].includes(comment.visibility || 'internal_only');
      return true;
    });
    const taskAttachments = visibleComments.flatMap((comment) => (comment.attachments || []).map((attachment) => ({
      ...attachment,
      commentId: comment.commentId,
      commentBody: comment.body,
      uploadedBy: attachment.uploadedBy || comment.author || {},
      createdAt: comment.createdAt
    })));
    res.render('pages/task-detail', {
      title: task.taskId || task.title,
      organization, actor, portal, assignment, canAct,
      task: { ...decorateTask(task), comments: visibleComments },
      taskAttachments,
      taskUsers,
      request: applyCurrentSupportConfiguration(summarizeRequest(request, portal, assignment), request, context),
      taskListPath: taskListPath(portal, tenantSlug),
      taskActionPath: taskDetailPath(portal, task.taskId, tenantSlug),
      requestPath: requestDetailPath(portal, request._id, tenantSlug),
      notice: String(req.query.notice || '').slice(0, 300),
      errorMessage: String(req.query.error || '').slice(0, 500)
    });
  } catch (error) { next(error); }
}

async function handleStageAssignment(req, res, next, portal) {
  try {
    const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.redirect(portalLoginPath(portal, req.session.tenantSlug));
    if (portal === 'client') return res.status(403).render('pages/error', { title: 'Action not allowed', status: 403, message: 'Customer users do not assign or take ownership of support stages.' });
    const context = await getRequestPageContext({ organization, actor, portal });
    const { request } = await getServiceRequest(organization._id, req.params.requestId);
    const stageId = String(req.params.stageId || '').trim();
    const storedStage = (request.activeStages || []).find((item) => item.localId === stageId);
    if (!storedStage) return res.status(404).render('pages/error', { title: 'Support stage not found', status: 404, message: 'This support stage is no longer active.' });
    const supportPath = currentSupportPathForRequest(request, context);
    const stage = effectiveStageAgainstPath(storedStage, supportPath) || storedStage;
    const assignment = portal === 'admin' ? null : bestAssignmentForClient(actor, request.client?.id, context.clients, portal);
    const usersResponse = await listUsers(organization._id);
    const eligible = eligibleStageAssignees(usersResponse.users || [], request.client?.id, context.clients, stageId, stage.ownerSide);
    const mode = String(req.body.mode || 'assign').trim();
    let selected = null;

    if (mode === 'take') {
      selected = eligible.find((user) => String(user._id) === String(actor._id || '') || String(user.email || '').toLowerCase() === String(actor.email || '').toLowerCase()) || null;
      if (!selected) return res.status(403).render('pages/error', { title: 'Ownership not allowed', status: 403, message: 'Your profile is not eligible to own this client and support level.' });
    } else {
      const canAssignOthers = portal === 'admin' || (assignmentMatchesStage(assignment, stage, stageId) && actorMatchesEligibleAssignee(actor, eligible));
      if (!canAssignOthers) return res.status(403).render('pages/error', { title: 'Assignment not allowed', status: 403, message: 'You can assign this stage only when your profile is eligible for this client and support level.' });
      const selectedId = String(req.body.assignedToId || '').trim();
      if (selectedId) {
        selected = eligible.find((user) => String(user._id) === selectedId) || null;
        if (!selected) return res.status(400).render('pages/error', { title: 'Assignment not allowed', status: 400, message: 'Choose an eligible user for this client and support level.' });
      }
    }

    const assignedTo = selected
      ? { actorId: selected._id, name: selected.name, email: selected.email, userType: '', portal: stage.ownerSide === 'client' ? 'client' : 'agent' }
      : {};
    const assignmentResult = await assignRequestStage(organization._id, request._id, stageId, {
      assignedTo,
      actor: { actorId: actor._id, name: actor.name, email: actor.email, userType: assignment?.role || actor.userType, portal }
    });
    if (selected) {
      dispatchRequestMail({
        organization,
        request: assignmentResult.request,
        event: 'assigned',
        actor: { name: actor.name, email: actor.email, role: assignment?.role || actor.userType, portal },
        extra: `${stageId} assigned to ${selected.name || selected.email}.`
      });
    }
    const notice = selected ? `${stageId} assigned to ${selected.name || selected.email}.` : `${stageId} assignment cleared.`;
    return res.redirect(requestActionRedirect(portal, request._id, req.session.tenantSlug, { notice }));
  } catch (error) {
    if (redirectRequestActionError(error, req, res, portal)) return;
    next(error);
  }
}

async function handleTaskComment(req, res, next, portal) {
  try {
    const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.redirect(portalLoginPath(portal, req.session.tenantSlug));
    const { task, assignment } = await resolveTaskAccess({ organization, actor, portal, taskId: req.params.taskId });
    const actorSnapshot = { actorId: actor._id, name: actor.name, email: actor.email, userType: assignment?.role || actor.userType, portal };
    const attachments = await uploadCommentFiles(req.files || [], actorSnapshot);
    await addRequestTaskComment(organization._id, task.taskId, {
      body: req.body.body,
      visibility: portal === 'client' ? 'client_visible' : req.body.visibility,
      attachments,
      alsoPostToRequest: req.body.alsoPostToRequest === 'on',
      actor: actorSnapshot
    });
    res.redirect(withQuery(taskDetailPath(portal, task.taskId, req.session.tenantSlug), { notice: 'Task comment added.' }));
  } catch (error) {
    res.redirect(withQuery(taskDetailPath(portal, req.params.taskId, req.session.tenantSlug), { error: error.message }));
  }
}

async function handleTaskPageStatus(req, res, next, portal) {
  try {
    const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.redirect(portalLoginPath(portal, req.session.tenantSlug));
    const { request, task, assignment, context } = await resolveTaskAccess({ organization, actor, portal, taskId: req.params.taskId });
    const taskLevel = task.sourceStageId || request.currentSupportLevel || 'L1';
    const storedTaskStage = (request.activeStages || []).find((stage) => stage.localId === taskLevel) || null;
    const taskStage = effectiveStageAgainstPath(storedTaskStage, currentSupportPathForRequest(request, context));
    if (!canWorkSupportStage({ portal, actor, assignment, stage: taskStage, level: taskLevel })) {
      const error = new Error('Take ownership of this support stage, or ask a manager to assign it, before updating this task.'); error.status = 403; throw error;
    }
    let assignedTo = task.assignedTo || {};
    if (portal !== 'client' && req.body.assignedToId !== undefined) {
      const usersResponse = await listUsers(organization._id);
      const selected = (usersResponse.users || []).find((user) => String(user._id) === String(req.body.assignedToId || ''));
      assignedTo = selected ? { actorId: String(selected._id), name: selected.name, email: selected.email, userType: selected.userType || '', portal: 'agent' } : {};
    }
    const managementFields = portal === 'client' ? {} : {
      priority: req.body.priority,
      queue: req.body.queue,
      dueAt: req.body.dueAt,
      assignedTo
    };
    await updateRequestTaskStatus(organization._id, request._id, task.localId, {
      status: req.body.status,
      note: req.body.note,
      ...managementFields,
      actor: { actorId: actor._id, name: actor.name, email: actor.email, userType: assignment?.role || actor.userType, portal }
    });
    res.redirect(withQuery(taskDetailPath(portal, task.taskId, req.session.tenantSlug), { notice: 'Task updated.' }));
  } catch (error) {
    res.redirect(withQuery(taskDetailPath(portal, req.params.taskId, req.session.tenantSlug), { error: error.message }));
  }
}

async function handleStatusChange(req, res, next, portal) {
  try {
    const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.redirect(portalLoginPath(portal));
    const context = await getRequestPageContext({ organization, actor, portal });
    const { request } = await getServiceRequest(organization._id, req.params.requestId);
    const configuredBehavior = configuredBehaviorForRequest(request, context);
    const configuredSaasRequest = String(configuredBehavior?.formDefinitionKey || '').trim().toUpperCase().startsWith('SAAS_')
      || requestLooksLikeV23Incident(request, configuredBehavior, currentSupportPathForRequest(request, context));
    const v23SaasRequest = isV23SaasRequestRecord(request) || configuredSaasRequest;
    const saasIncident = v23SaasRequest && /\bincident\b/i.test(`${request.level1Type?.name || ''} ${request.level2Type?.name || ''} ${request.level3Type?.name || ''}`);
    const assignment = portal === 'admin' ? null : bestAssignmentForClient(actor, request.client?.id, context.clients, portal);
    const requestedStageId = String(req.body.stageId || request.currentSupportLevel || '').trim();
    const storedStage = (request.activeStages || []).find((item) => item.localId === requestedStageId)
      || (request.activeStages || []).find((item) => item.isPrimary)
      || null;
    const supportPath = currentSupportPathForRequest(request, context);
    const stage = effectiveStageAgainstPath(storedStage, supportPath);
    const actionLevel = stage?.localId || request.currentSupportLevel || 'L1';
    const stageUnassigned = !(stage?.assignedTo?.actorId || stage?.assignedTo?.email);
    const clientScopedSaasStage = v23SaasRequest && portal === 'client' && stage?.ownerSide === 'client' && stageUnassigned && assignmentMatchesStage(assignment, stage, actionLevel);
    const canAutoOwnSaasStage = v23SaasRequest && portal !== 'client' && stageUnassigned && assignmentMatchesStage(assignment, stage, actionLevel);
    if (!canWorkSupportStage({ portal, actor, assignment, stage, level: actionLevel }) && !canAutoOwnSaasStage && !clientScopedSaasStage) return res.status(403).render('pages/error', { title: 'Action not allowed', status: 403, message: 'This support stage is assigned to another owner or is outside your client/support scope.' });
    const configuredLevel2 = configuredLevel2ForRequest(request, context);
    const workflow = (stage?.workflow?.id ? context.workflows.find((item) => String(item._id) === String(stage.workflow.id)) : null)
      || (request.workflow?.id ? context.workflows.find((item) => String(item._id) === String(request.workflow.id)) : null)
      || configuredLevel2?.workflow
      || null;
    const definition = storedStage?.workflowDefinition?.statuses?.length
      ? storedStage.workflowDefinition
      : (stage?.configuredWorkflowDefinition?.statuses?.length
          ? stage.configuredWorkflowDefinition
          : (request.workflowDefinition?.statuses?.length ? request.workflowDefinition : workflowDefinitionFrom(workflow)));
    let assignedToPayload;
    if (canAutoOwnSaasStage) {
      assignedToPayload = { actorId: actor._id, name: actor.name, email: actor.email, userType: assignment?.role || actor.userType || '', portal: stage?.ownerSide === 'client' ? 'client' : 'agent' };
    }
    if (req.body.assignedToId !== undefined && String(req.body.assignedToId || '').trim()) {
      const usersResponse = await listUsers(organization._id);
      const eligible = eligibleStageAssignees(usersResponse.users || [], request.client?.id, context.clients, actionLevel, stage?.ownerSide || '');
      const selected = eligible.find((user) => String(user._id) === String(req.body.assignedToId || '').trim());
      if (!selected) return res.status(400).render('pages/error', { title: 'Assignment not allowed', status: 400, message: 'Choose an eligible user for this client and support stage.' });
      assignedToPayload = { actorId: selected._id, name: selected.name, email: selected.email, userType: '', portal: stage?.ownerSide === 'client' ? 'client' : 'agent' };
    }

    // v23.1.3 surfaces genuine blocking requirements inside the status-change
    // dialog instead of a generic task footer. Complete the submitted blocker(s)
    // first; the request service still rejects the transition if any remain open.
    const requestedBlockerIds = toArray(req.body.completeBlockingTaskIds).map((value) => String(value || '').trim()).filter(Boolean);
    if (requestedBlockerIds.length) {
      const currentStatusId = String(storedStage?.currentStatus?.localId || stage?.currentStatus?.localId || '').trim();
      const validBlockers = (request.tasks || []).filter((task) =>
        String(task.sourceStageId || '') === String(actionLevel)
          && String(task.sourceStatusId || '') === currentStatusId
          && task.isBlocking === true
          && !['done', 'cancelled'].includes(String(task.status || ''))
      );
      const validIds = new Set(validBlockers.map((task) => String(task.localId || '')));
      for (const blockerId of requestedBlockerIds) {
        if (!validIds.has(blockerId)) return res.status(400).render('pages/error', { title: 'Requirement changed', status: 400, message: 'A workflow requirement changed after this page was opened. Refresh the request and try again.' });
        const note = String(req.body[`blockingTaskNote__${blockerId}`] || '').trim();
        if (note.length < 3) return res.status(400).render('pages/error', { title: 'Requirement incomplete', status: 400, message: 'Complete each required workflow item with a short note before changing status.' });
        await updateRequestTaskStatus(organization._id, request._id, blockerId, {
          status: 'done',
          note,
          actor: { actorId: actor._id, name: actor.name, email: actor.email, userType: assignment?.role || actor.userType, portal }
        });
      }
    }

    const result = await changeRequestStatus(organization._id, req.params.requestId, {
      stageId: actionLevel,
      toStatusId: req.body.toStatusId,
      expectedFromStatusId: req.body.expectedFromStatusId,
      comment: req.body.comment,
      ...(assignedToPayload ? { assignedTo: assignedToPayload } : {}),
      actor: { actorId: actor._id, name: actor.name, email: actor.email, userType: assignment?.role || actor.userType, portal },
      workflowDefinition: definition,
      serviceModelKey: v23SaasRequest ? 'SUNTEC_SAAS_V23' : '',
      saasIncident
    });
    if (!result.noChange) {
      const changedStatusText = `${result.request?.currentStatus?.name || ''} ${result.request?.currentStatus?.customerLabel || ''}`;
      const previousCustomerLabel = String(stage?.currentStatus?.customerLabel || stage?.currentStatus?.name || '').trim();
      const nextCustomerLabel = String(result.request?.currentStatus?.customerLabel || result.request?.currentStatus?.name || '').trim();
      const mailEvent = /need\s*(info|information)/i.test(changedStatusText)
        ? 'information requested'
        : /resolved|resolution/i.test(changedStatusText)
          ? 'resolved'
          : 'status changed';
      dispatchRequestMail({
        organization,
        request: result.request,
        event: mailEvent,
        actor: { name: actor.name, email: actor.email, role: assignment?.role || actor.userType, portal },
        extra: `${actionLevel} status changed.`,
        customerStatusChanged: previousCustomerLabel !== nextCustomerLabel
      });
    }
    const statusLabel = result.request?.currentStatus?.customerLabel || result.request?.currentStatus?.name || 'the selected status';
    res.redirect(requestActionRedirect(portal, req.params.requestId, req.session.tenantSlug, {
      notice: result.noChange ? `The ${actionLevel} stage was already at ${statusLabel}.` : `${actionLevel} status changed to ${statusLabel}.`
    }));
  } catch (error) {
    if (redirectRequestActionError(error, req, res, portal)) return;
    next(error);
  }
}

async function handleSupportMove(req, res, next, portal) {
  try {
    const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.redirect(portalLoginPath(portal));
    const context = await getRequestPageContext({ organization, actor, portal });
    const { request } = await getServiceRequest(organization._id, req.params.requestId);
    const assignment = portal === 'admin' ? null : bestAssignmentForClient(actor, request.client?.id, context.clients, portal);
    const sourceLevel = String(req.body.expectedFromLevelId || request.currentSupportLevel || 'L1');
    const storedSourceStage = (request.activeStages || []).find((stage) => stage.localId === sourceLevel) || (request.activeStages || []).find((stage) => stage.isPrimary) || null;
    const supportPath = currentSupportPathForRequest(request, context);
    const configuredBehavior = configuredBehaviorForRequest(request, context);
    const configuredSaasRequest = String(configuredBehavior?.formDefinitionKey || '').trim().toUpperCase().startsWith('SAAS_')
      || requestLooksLikeV23Incident(request, configuredBehavior, currentSupportPathForRequest(request, context));
    const v23SaasRequest = isV23SaasRequestRecord(request) || configuredSaasRequest;
    const saasIncident = v23SaasRequest && /\bincident\b/i.test(`${request.level1Type?.name || ''} ${request.level2Type?.name || ''} ${request.level3Type?.name || ''}`);
    const sourceStage = effectiveStageAgainstPath(storedSourceStage, supportPath);
    const sourceStageUnassigned = !(sourceStage?.assignedTo?.actorId || sourceStage?.assignedTo?.email);
    const clientScopedSaasStage = v23SaasRequest && portal === 'client' && sourceStage?.ownerSide === 'client' && sourceStageUnassigned && assignmentMatchesStage(assignment, sourceStage, sourceLevel);
    const canAutoRouteSaasStage = v23SaasRequest && portal !== 'client' && sourceStageUnassigned && assignmentMatchesStage(assignment, sourceStage, sourceLevel);
    if (!canWorkSupportStage({ portal, actor, assignment, stage: sourceStage, level: sourceLevel }) && !canAutoRouteSaasStage && !clientScopedSaasStage) return res.status(403).render('pages/error', { title: 'Action not allowed', status: 403, message: 'This support stage is assigned to another owner or is outside your client/support scope.' });
    const result = await moveRequestSupportLevel(organization._id, req.params.requestId, {
      ruleId: req.body.ruleId,
      expectedFromLevelId: req.body.expectedFromLevelId,
      reason: req.body.reason,
      comment: req.body.comment,
      actor: { actorId: actor._id, name: actor.name, email: actor.email, userType: assignment?.role || actor.userType, portal },
      supportPathDefinition: supportPath?.levels?.length
        ? { levels: supportPath.levels || [], movementRules: supportPath.movementRules || [] }
        : (request.supportPathDefinition || { levels: [], movementRules: [] }),
      serviceModelKey: v23SaasRequest ? 'SUNTEC_SAAS_V23' : '',
      saasIncident
    });
    dispatchRequestMail({ organization, request: result.request, event: 'support level changed', actor: { name: actor.name, email: actor.email, role: assignment?.role || actor.userType, portal }, extra: `Support level moved to ${result.request?.currentSupportLevel || 'next level'}.` });
    res.redirect(requestActionRedirect(portal, req.params.requestId, req.session.tenantSlug, {
      notice: `Request moved to ${result.request?.currentSupportLevel || 'the next support level'}.`
    }));
  } catch (error) {
    if (redirectRequestActionError(error, req, res, portal)) return;
    next(error);
  }
}

async function handleRequestTaskStatus(req, res, next, portal) {
  try {
    const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.redirect(portalLoginPath(portal, req.session.tenantSlug));
    const context = await getRequestPageContext({ organization, actor, portal });
    const { request } = await getServiceRequest(organization._id, req.params.requestId);
    const task = (request.tasks || []).find((item) => item.localId === String(req.params.taskId || '').trim());
    if (!task) return res.status(404).render('pages/error', { title: 'Task not found', status: 404, message: 'This request task no longer exists.' });
    const assignment = portal === 'admin' ? null : bestAssignmentForClient(actor, request.client?.id, context.clients, portal);
    const actionLevel = task.sourceStageId || request.currentSupportLevel || 'L1';
    const storedTaskStage = (request.activeStages || []).find((stage) => stage.localId === actionLevel) || null;
    const taskStage = effectiveStageAgainstPath(storedTaskStage, currentSupportPathForRequest(request, context));
    if (!canWorkSupportStage({ portal, actor, assignment, stage: taskStage, level: actionLevel })) return res.status(403).render('pages/error', { title: 'Action not allowed', status: 403, message: 'Take ownership of this support stage, or ask a manager to assign it, before updating its tasks.' });
    await updateRequestTaskStatus(organization._id, req.params.requestId, req.params.taskId, {
      status: req.body.status,
      note: req.body.note,
      actor: { actorId: actor._id, name: actor.name, email: actor.email, userType: assignment?.role || actor.userType, portal }
    });
    res.redirect(requestDetailPath(portal, req.params.requestId, req.session.tenantSlug));
  } catch (error) { next(error); }
}


async function handleRequestClose(req, res, next, portal) {
  try {
    const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.redirect(portalLoginPath(portal, req.session.tenantSlug));
    const context = await getRequestPageContext({ organization, actor, portal });
    const { request } = await getServiceRequest(organization._id, req.params.requestId);
    const assignment = portal === 'admin' ? null : bestAssignmentForClient(actor, request.client?.id, context.clients, portal);
    const closeLevel = request.currentSupportLevel || 'L1';
    const storedCloseStage = (request.activeStages || []).find((stage) => stage.isPrimary) || (request.activeStages || []).find((stage) => stage.localId === closeLevel) || null;
    const closeStage = effectiveStageAgainstPath(storedCloseStage, currentSupportPathForRequest(request, context));
    if (portal !== 'admin' && !canWorkSupportStage({ portal, actor, assignment, stage: closeStage, level: closeLevel })) {
      return res.status(403).render('pages/error', { title: 'Action not allowed', status: 403, message: 'Take ownership of the active support stage, or ask a manager to assign it, before closing this request.' });
    }
    const result = await closeRequest(organization._id, req.params.requestId, {
      comment: req.body.comment,
      actor: { actorId: actor._id, name: actor.name, email: actor.email, userType: assignment?.role || actor.userType, portal }
    });
    dispatchRequestMail({ organization, request: result.request, event: 'closed', actor: { name: actor.name, email: actor.email, role: assignment?.role || actor.userType, portal }, extra: `Request closed. ${req.body.comment || ''}` });
    res.redirect(requestDetailPath(portal, req.params.requestId, req.session.tenantSlug));
  } catch (error) { next(error); }
}



function wantsJson(req) {
  return req.xhr || String(req.headers.accept || '').includes('application/json') || req.headers['x-requested-with'] === 'fetch';
}

async function handleReturnRequest(req, res, next, portal) {
  try {
    const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.redirect(portalLoginPath(portal, req.session.tenantSlug));
    const context = await getRequestPageContext({ organization, actor, portal });
    const { request } = await getServiceRequest(organization._id, req.params.requestId);
    const assignment = portal === 'admin' ? null : bestAssignmentForClient(actor, request.client?.id, context.clients, portal);
    if (portal === 'client' || !['L2', 'L3'].includes(String(request.currentSupportLevel || ''))) {
      return res.status(403).render('pages/error', { title: 'Action not allowed', status: 403, message: 'Only L2/L3 support users can return a request.' });
    }
    const returnLevel = request.currentSupportLevel || 'L1';
    const storedReturnStage = (request.activeStages || []).find((stage) => stage.isPrimary) || (request.activeStages || []).find((stage) => stage.localId === returnLevel) || null;
    const returnStage = effectiveStageAgainstPath(storedReturnStage, currentSupportPathForRequest(request, context));
    if (portal !== 'admin' && !canWorkSupportStage({ portal, actor, assignment, stage: returnStage, level: returnLevel })) {
      return res.status(403).render('pages/error', { title: 'Action not allowed', status: 403, message: 'Take ownership of the active support stage before returning this request.' });
    }
    const result = await returnRequest(organization._id, req.params.requestId, {
      reason: req.body.reason,
      comment: req.body.comment,
      visibility: req.body.visibility || 'client_visible',
      actor: { actorId: actor._id, name: actor.name, email: actor.email, userType: assignment?.role || actor.userType, portal }
    });
    dispatchRequestMail({ organization, request: result.request, event: 'returned', actor: { name: actor.name, email: actor.email, role: assignment?.role || actor.userType, portal }, extra: `Request returned. ${req.body.reason || ''} ${req.body.comment || ''}` });
    res.redirect(requestDetailPath(portal, req.params.requestId, req.session.tenantSlug));
  } catch (error) { next(error); }
}

async function handleAcknowledgeRequest(req, res, next, portal) {
  try {
    const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.redirect(portalLoginPath(portal, req.session.tenantSlug));
    const context = await getRequestPageContext({ organization, actor, portal });
    const { request } = await getServiceRequest(organization._id, req.params.requestId);
    const assignment = portal === 'admin' ? null : bestAssignmentForClient(actor, request.client?.id, context.clients, portal);
    const supportPath = currentSupportPathForRequest(request, context);
    const configuredBehavior = configuredBehaviorForRequest(request, context);
    const isSaasRequest = isV23SaasRequestRecord(request)
      || String(configuredBehavior?.formDefinitionKey || '').trim().toUpperCase().startsWith('SAAS_')
      || requestLooksLikeV23Incident(request, configuredBehavior, supportPath);
    const activeAcknowledgeStages = (request.activeStages || []).filter((stage) => stage?.isActive !== false);
    const acknowledgeStage = activeAcknowledgeStages.find((storedStage) => {
      const stage = effectiveStageAgainstPath(storedStage, supportPath) || storedStage;
      return canAcknowledgeSupportStage({
        portal,
        actor,
        assignment,
        stage,
        level: stage.localId || request.currentSupportLevel || 'L1',
        isSaasRequest
      });
    }) || null;
    if (portal !== 'admin' && !acknowledgeStage) {
      return res.status(403).render('pages/error', { title: 'Action not allowed', status: 403, message: 'You are not eligible to acknowledge any active support stage for this request.' });
    }
    const result = await acknowledgeRequest(organization._id, req.params.requestId, {
      comment: req.body.comment,
      actor: { actorId: actor._id, name: actor.name, email: actor.email, userType: assignment?.role || actor.userType, portal }
    });
    dispatchRequestMail({ organization, request: result.request, event: 'acknowledged', actor: { name: actor.name, email: actor.email, role: assignment?.role || actor.userType, portal }, extra: `Request acknowledged. ${req.body.comment || ''}` });
    res.redirect(requestDetailPath(portal, req.params.requestId, req.session.tenantSlug));
  } catch (error) { next(error); }
}

async function handleAddRequestComment(req, res, next, portal) {
  try {
    const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.redirect(portalLoginPath(portal, req.session.tenantSlug));
    const context = await getRequestPageContext({ organization, actor, portal });
    const { request } = await getServiceRequest(organization._id, req.params.requestId);
    const assignment = portal === 'admin' ? null : bestAssignmentForClient(actor, request.client?.id, context.clients, portal);
    if (portal !== 'admin' && !assignmentCanSeeRequest(assignment, request, portal)) {
      return res.status(404).render('pages/error', { title: 'Request not found', status: 404, message: 'This request is not visible in your current portal assignment.' });
    }
    const visibility = portal === 'client' ? 'client_visible' : (req.body.visibility || 'client_visible');
    const actorSnapshot = { actorId: actor._id, name: actor.name, email: actor.email, userType: assignment?.role || actor.userType, portal };
    const uploadedFiles = await uploadCommentFiles(req.files || [], actorSnapshot);
    const attachmentNames = toArray(req.body.commentAttachmentNames).map((fileName) => ({ fileName })).filter((item) => item.fileName);
    const response = await addRequestComment(organization._id, req.params.requestId, {
      body: req.body.body,
      visibility,
      attachments: [...uploadedFiles, ...attachmentNames],
      actor: actorSnapshot
    });
    dispatchRequestMail({ organization, request: response.request, event: 'comment added', actor: { name: actor.name, email: actor.email, role: assignment?.role || actor.userType, portal }, visibility, extra: `New ${visibility.replace('_', ' ')} comment: ${String(req.body.body || '').slice(0, 500)}` });
    if (wantsJson(req)) {
      return res.status(201).json({ comment: response.comment, request: response.request });
    }
    res.redirect(requestDetailPath(portal, req.params.requestId, req.session.tenantSlug));
  } catch (error) { next(error); }
}


async function handleClientLifecycleAction(req, res, next, portal) {
  try {
    const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.redirect(portalLoginPath(portal));
    if (portal !== 'client') {
      return res.status(403).render('pages/error', { title: 'Action not allowed', status: 403, message: 'This action is available only from the client portal.' });
    }

    const actorSnapshot = { actorId: actor._id, name: actor.name, email: actor.email, userType: 'clientUser', portal: 'client' };
    const uploadedFiles = await uploadCommentFiles(req.files || [], actorSnapshot);

    const result = await clientRequestAction(organization._id, req.params.requestId, {
      action: req.body.action,
      comment: req.body.comment,
      attachments: uploadedFiles,
      actor: actorSnapshot
    });

    const event = req.body.action === 'submit_information'
      ? 'information supplied'
      : req.body.action === 'accept_resolution'
        ? 'resolution accepted'
        : 'resolution rejected';

    dispatchRequestMail({
      organization,
      request: result.request,
      event,
      actor: { name: actor.name, email: actor.email, role: 'clientUser', portal: 'client' },
      extra: req.body.comment || ''
    });

    const notice = req.body.action === 'submit_information'
      ? 'Information submitted. The request is back with the support team.'
      : req.body.action === 'accept_resolution'
        ? 'Resolution accepted and request closed.'
        : 'The request has been reopened for further work.';

    res.redirect(requestActionRedirect(portal, req.params.requestId, req.session.tenantSlug, { notice }));
  } catch (error) {
    if (redirectRequestActionError(error, req, res, portal)) return;
    next(error);
  }
}

async function handleRequestClassificationUpdate(req, res, next, portal) {
  try {
    const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.redirect(portalLoginPath(portal));
    if (portal === 'client') {
      return res.status(403).render('pages/error', { title: 'Action not allowed', status: 403, message: 'Severity is controlled by the support team.' });
    }

    const context = await getRequestPageContext({ organization, actor, portal });
    const severity = findById(context.severities || [], req.body.severityId);
    const priority = findById(context.priorities || [], req.body.priorityId);
    if (!severity && req.body.severityId) {
      return res.status(400).render('pages/error', { title: 'Invalid severity', status: 400, message: 'Choose a configured severity.' });
    }
    if (!priority && req.body.priorityId) {
      return res.status(400).render('pages/error', { title: 'Invalid priority', status: 400, message: 'Choose a configured priority.' });
    }
    const classificationPayload = { actor: { actorId: actor._id, name: actor.name, email: actor.email, userType: actor.userType, portal } };
    if (req.body.severityId !== undefined) classificationPayload.severity = makeRef(severity, req.body.severityId);
    if (req.body.priorityId !== undefined) classificationPayload.priority = makeRef(priority, req.body.priorityId);
    const result = await updateRequestClassification(organization._id, req.params.requestId, classificationPayload);

    if (!result.noChange) {
      const classificationEvent = req.body.severityId !== undefined ? 'severity changed' : 'priority changed';
      const classificationParts = [];
      if (req.body.severityId !== undefined) classificationParts.push(`Severity: ${result.request?.severity?.code || result.request?.severity?.name || 'not selected'}`);
      if (req.body.priorityId !== undefined) classificationParts.push(`Priority: ${result.request?.priority?.code || result.request?.priority?.name || 'not selected'}`);
      dispatchRequestMail({
        organization,
        request: result.request,
        event: classificationEvent,
        actor: { name: actor.name, email: actor.email, role: actor.userType, portal },
        extra: `${classificationParts.join(' · ')}. SLA has been recalculated without resetting its start time.`
      });
    }

    res.redirect(requestActionRedirect(portal, req.params.requestId, req.session.tenantSlug, {
      notice: result.noChange ? 'Severity was unchanged.' : 'Severity updated and SLA recalculated.'
    }));
  } catch (error) {
    if (redirectRequestActionError(error, req, res, portal)) return;
    next(error);
  }
}

async function handleV23SaasFormDefinition(req, res, next, portal) {
  try {
    const { organization, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.status(401).json({ message: 'Authentication required.' });
    const result = await getV23SaasFormDefinition(organization._id, req.query.level1TypeId, req.query.level2TypeId, req.query.level3TypeId);
    res.json(result);
  } catch (error) {
    const status = Number(error?.status || error?.statusCode || error?.response?.status || 500);
    if (status === 404) return res.status(404).json({ message: 'No v23 SaaS binding for the selected request subtype.' });
    next(error);
  }
}

app.post('/:portal(admin|client|agent)/requests/:requestId/status', (req, res, next) => handleStatusChange(req, res, next, req.params.portal));
app.get('/:portal(admin|client|agent)/v23/form-definition', (req, res, next) => handleV23SaasFormDefinition(req, res, next, req.params.portal));
app.post('/:portal(admin|client|agent)/requests/:requestId/client-action', upload.array('attachments', 5), (req, res, next) => handleClientLifecycleAction(req, res, next, req.params.portal));
app.post('/:portal(admin|client|agent)/requests/:requestId/classification', (req, res, next) => handleRequestClassificationUpdate(req, res, next, req.params.portal));
app.post('/:portal(admin|client|agent)/requests/:requestId/stages/:stageId/assignee', (req, res, next) => handleStageAssignment(req, res, next, req.params.portal));
app.post('/:portal(admin|client|agent)/requests/:requestId/support-move', (req, res, next) => handleSupportMove(req, res, next, req.params.portal));
app.post('/:portal(admin|client|agent)/requests/:requestId/tasks/:taskId/status', (req, res, next) => handleRequestTaskStatus(req, res, next, req.params.portal));
app.post('/:portal(admin|client|agent)/requests/:requestId/close', (req, res, next) => handleRequestClose(req, res, next, req.params.portal));
app.post('/:portal(admin|client|agent)/requests/:requestId/return', (req, res, next) => handleReturnRequest(req, res, next, req.params.portal));
app.post('/:portal(admin|client|agent)/requests/:requestId/acknowledge', (req, res, next) => handleAcknowledgeRequest(req, res, next, req.params.portal));
app.post('/:portal(admin|client|agent)/requests/:requestId/comments', upload.array('attachments', 5), (req, res, next) => handleAddRequestComment(req, res, next, req.params.portal));

app.get('/:portal(admin|client|agent)/requests', async (req, res, next) => {
  try {
    const portal = req.params.portal;
    const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.redirect(portalLoginPath(portal));
    await renderRequestList(req, res, next, { organization, actor, portal });
  } catch (error) { next(error); }
});

app.get('/:portal(admin|client|agent)/requests/new', async (req, res, next) => {
  try {
    const portal = req.params.portal;
    const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.redirect(portalLoginPath(portal));
    await renderRequestNew(req, res, next, { organization, actor, portal });
  } catch (error) { next(error); }
});

app.post('/:portal(admin|client|agent)/requests', async (req, res, next) => {
  const portal = req.params.portal;
  try {
    const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.redirect(portalLoginPath(portal));
    const context = await getRequestPageContext({ organization, actor, portal });
    const payload = buildRequestPayload({ req, organization, portal, actor, context });
    const { request } = await createServiceRequest(organization._id, payload);
    dispatchRequestMail({ organization, request, event: 'created', actor: { name: actor.name, email: actor.email, role: actor.userType || portal, portal }, extra: 'A new request was created.' });
    await safeAudit(organization._id, { eventType: 'request_created', message: `Request ${request.requestNumber} created.`, targetType: 'request', targetId: request._id, targetLabel: request.requestNumber, actor: { name: actor.name, email: actor.email, role: actor.userType || portal, portal } });
    res.redirect(requestDetailPath(portal, request._id, req.session.tenantSlug));
  } catch (error) {
    try {
      const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
      if (!allowed) return res.redirect(portalLoginPath(portal));
      req.query = { clientId: req.body.clientId, level1TypeId: req.body.level1TypeId, level2TypeId: req.body.level2TypeId, level3TypeId: req.body.level3TypeId };
      return renderRequestNew(req, res, next, { organization, actor, portal, form: req.body, errorMessage: error.message });
    } catch { next(error); }
  }
});

app.get('/:portal(admin|client|agent)/requests/:requestId', async (req, res, next) => {
  try {
    const portal = req.params.portal;
    const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
    if (!allowed) return res.redirect(portalLoginPath(portal));
    await renderRequestDetail(req, res, next, { organization, actor, portal, requestId: req.params.requestId });
  } catch (error) { next(error); }
});

async function resolveTenantRouteAccess(req, res, next, tenant) {
  const tenantSlug = String(tenant || '').trim().toLowerCase();
  if (RESERVED_TENANT_SLUGS.has(tenantSlug)) return null;
  const portal = req.session.portal;
  if (!['client', 'agent'].includes(portal)) {
    res.redirect(`/${tenantSlug}/login`);
    return null;
  }
  const { organization, actor, allowed } = await resolvePortalAccess(req, portal);
  if (!allowed) {
    res.redirect(`/${tenantSlug}/login`);
    return null;
  }
  const activeSlug = organizationSlug(organization);
  if (activeSlug !== tenantSlug) {
    res.redirect(portalHomePath(portal, activeSlug));
    return null;
  }
  return { organization, actor, portal };
}


app.get('/:tenant/tasks', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    await renderTaskList(req, res, next, access);
  } catch (error) { next(error); }
});

app.get('/:tenant/tasks/:taskId', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    await renderTaskDetail(req, res, next, { ...access, taskId: req.params.taskId });
  } catch (error) { next(error); }
});

app.post('/:tenant/tasks/:taskId/comments', upload.array('attachments', 5), async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    return handleTaskComment(req, res, next, access.portal);
  } catch (error) { next(error); }
});

app.post('/:tenant/tasks/:taskId/status', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    return handleTaskPageStatus(req, res, next, access.portal);
  } catch (error) { next(error); }
});

app.post('/:tenant/requests/:requestId/status', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    return handleStatusChange(req, res, next, access.portal);
  } catch (error) { next(error); }
});

app.post('/:tenant/requests/:requestId/stages/:stageId/assignee', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    return handleStageAssignment(req, res, next, access.portal);
  } catch (error) { next(error); }
});

app.post('/:tenant/requests/:requestId/return', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    return handleReturnRequest(req, res, next, access.portal);
  } catch (error) { next(error); }
});


app.post('/:tenant/requests/:requestId/client-action', upload.array('attachments', 5), async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    return handleClientLifecycleAction(req, res, next, access.portal);
  } catch (error) { next(error); }
});

app.post('/:tenant/requests/:requestId/classification', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    return handleRequestClassificationUpdate(req, res, next, access.portal);
  } catch (error) { next(error); }
});

app.get('/:tenant/v23/form-definition', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    const resolved = await resolvePortalAccess(req, access.portal);
    if (!resolved?.allowed) return res.status(401).json({ message: 'Authentication required.' });
    const result = await getV23SaasFormDefinition(resolved.organization._id, req.query.level1TypeId, req.query.level2TypeId, req.query.level3TypeId);
    res.json(result);
  } catch (error) {
    const status = Number(error?.status || error?.statusCode || error?.response?.status || 500);
    if (status === 404) return res.status(404).json({ message: 'No v23 SaaS binding for the selected request subtype.' });
    next(error);
  }
});

app.get('/:tenant/:portal(admin|client|agent)/v23/form-definition', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    const resolved = await resolvePortalAccess(req, access.portal);
    if (!resolved?.allowed) return res.status(401).json({ message: 'Authentication required.' });
    const result = await getV23SaasFormDefinition(resolved.organization._id, req.query.level1TypeId, req.query.level2TypeId, req.query.level3TypeId);
    res.json(result);
  } catch (error) {
    const status = Number(error?.status || error?.statusCode || error?.response?.status || 500);
    if (status === 404) return res.status(404).json({ message: 'No v23 SaaS binding for the selected request subtype.' });
    next(error);
  }
});

app.post('/:tenant/requests/:requestId/close', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    return handleRequestClose(req, res, next, access.portal);
  } catch (error) { next(error); }
});


app.post('/:tenant/requests/:requestId/acknowledge', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    return handleAcknowledgeRequest(req, res, next, access.portal);
  } catch (error) { next(error); }
});

app.post('/:tenant/requests/:requestId/comments', upload.array('attachments', 5), async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    return handleAddRequestComment(req, res, next, access.portal);
  } catch (error) { next(error); }
});

app.post('/:tenant/requests/:requestId/support-move', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    return handleSupportMove(req, res, next, access.portal);
  } catch (error) { next(error); }
});

app.post('/:tenant/requests/:requestId/tasks/:taskId/status', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    return handleRequestTaskStatus(req, res, next, access.portal);
  } catch (error) { next(error); }
});

app.get('/:tenant/requests', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    await renderRequestList(req, res, next, access);
  } catch (error) { next(error); }
});

app.get('/:tenant/requests/new', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    await renderRequestNew(req, res, next, access);
  } catch (error) { next(error); }
});

app.post('/:tenant/requests', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    const { organization, actor, portal } = access;
    const context = await getRequestPageContext({ organization, actor, portal });
    const payload = buildRequestPayload({ req, organization, portal, actor, context });
    const { request } = await createServiceRequest(organization._id, payload);
    dispatchRequestMail({ organization, request, event: 'created', actor: { name: actor.name, email: actor.email, role: actor.userType || portal, portal }, extra: 'A new request was created.' });
    await safeAudit(organization._id, { eventType: 'request_created', message: `Request ${request.requestNumber} created.`, targetType: 'request', targetId: request._id, targetLabel: request.requestNumber, actor: { name: actor.name, email: actor.email, role: actor.userType || portal, portal } });
    res.redirect(requestDetailPath(portal, request._id, req.session.tenantSlug));
  } catch (error) {
    try {
      const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
      if (!access) return;
      req.query = { clientId: req.body.clientId, level1TypeId: req.body.level1TypeId, level2TypeId: req.body.level2TypeId, level3TypeId: req.body.level3TypeId };
      return renderRequestNew(req, res, next, { ...access, form: req.body, errorMessage: error.message });
    } catch { next(error); }
  }
});

app.get('/:tenant/requests/:requestId', async (req, res, next) => {
  try {
    const access = await resolveTenantRouteAccess(req, res, next, req.params.tenant);
    if (!access) return;
    await renderRequestDetail(req, res, next, { ...access, requestId: req.params.requestId });
  } catch (error) { next(error); }
});

// Legacy request URLs from v6-v9.
app.get('/:workspace/:portal(admin|client|agent)/requests*', (req, res) => {
  const tail = req.originalUrl.replace(`/${req.params.workspace}/${req.params.portal}`, '');
  if (req.params.portal === 'admin') return res.redirect(`/admin${tail || '/requests'}`);
  return res.redirect(`/${req.params.workspace}${tail || '/requests'}`);
});
app.get('/requests*', (req, res) => res.redirect(`/admin${req.originalUrl}`));

app.post('/logout', (req, res) => {
  const portal = req.session.portal || 'admin';
  const tenantSlug = req.session.tenantSlug || '';
  req.session.destroy(() => res.redirect(portalLoginPath(portal, tenantSlug)));
});

app.post('/session/clear', (req, res) => {
  req.session.destroy(() => res.redirect('/setup'));
});

app.use((req, res) => {
  res.status(404).render('pages/error', {
    title: 'Page not found',
    status: 404,
    message: 'This page is not available in Service Desk v19.7.'
  });
});

app.use((error, req, res, next) => {
  console.error(error);
  const status = Number(error?.status) || 500;
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && [400, 409, 422].includes(status) && !wantsJsonResponse(req)) {
    const referer = String(req.get('referer') || '').trim();
    if (referer) {
      try {
        const base = `${req.protocol}://${req.get('host')}`;
        const target = new URL(referer, base);
        if (target.host === req.get('host')) {
          req.session.globalFormError = String(error?.message || 'The form could not be saved.').slice(0, 700);
          return req.session.save(() => res.redirect(`${target.pathname}${target.search || ''}`));
        }
      } catch {}
    }
  }
  res.status(status).render('pages/error', {
    title: 'Something went wrong',
    status,
    message: error.message || 'Something went wrong while loading this page.'
  });
});

app.listen(config.port, () => {
  console.log(`Service Desk web gateway running on http://localhost:${config.port}`);
  runInBackground('SLA notifier bootstrap', async () => {
    try {
      const latest = await getLatestOrganization();
      if (latest?.organization?._id && latest.organization.status === 'active') {
        knownSlaOrganizations.add(String(latest.organization._id));
        await pollSlaNotifications();
      }
    } catch (error) {
      console.error(`[sla-notifier] bootstrap: ${error.message}`);
    }
  });
});
