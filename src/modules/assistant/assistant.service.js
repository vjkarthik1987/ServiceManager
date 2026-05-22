const mongoose = require('mongoose');
const { Issue, ISSUE_STATUSES } = require('../issues/issue.model');
const { IssueComment } = require('../issues/issue-comment.model');
const { IssueActivity } = require('../issues/issue-activity.model');
const { KnowledgeDocument } = require('../knowledge/knowledge-document.model');
const { Entity } = require('../entities/entity.model');
const { User } = require('../users/user.model');
const { createUserForTenant } = require('../users/user.service');
const { UserEntityMembership } = require('../memberships/membership.model');
const { generateIssueNumber, createIssueActivity } = require('../issues/issue.service');
const { resolveRouting } = require('../routing/routing.service');
const { resolveEffectiveEntityJiraConfig } = require('../entities/entity.service');
const { resolveAgreementBundle, buildSlaSnapshot, buildCommitmentSnapshots, evaluateIssueSla } = require('../sla/sla.service');
const { logAudit } = require('../audit/audit.service');
const { getAccessibleEntityIdsForUser, userHasEntityAccess, validateAssignableAgentForEntity } = require('../../utils/access');
const { getClientStatusPresentation } = require('../workflows/workflow-visibility.service');
const { getTenantJiraConnection } = require('../integrations/jira/jira-connection.service');
const { enqueueJiraPush } = require('../queue/queue.service');
const { canCreateIssue, isClientUser, isInternalAgent } = require('../../utils/roles');
const { isOpenAiEnabled, extractAssistantIntentWithOpenAi, generateIssueNarrative, generateReportAnswer } = require('./openai-intelligence.service');

const ASSISTANT_CREATE_ROLES = new Set(['client', 'agent', 'agent_user', 'agent_manager', 'superadmin']);
const ISSUE_NUMBER_PATTERN = /\b([A-Z0-9]{3,8}-\d{2,})\b/i;
const PRIORITY_VALUES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL', 'BLOCKER'];
const REQUEST_TYPES = ['BUG', 'CR', 'QUERY'];
const OPEN_STATUS_VALUES = ['NEW', 'OPEN', 'UNDER_REVIEW', 'APPROVED', 'IN_PROGRESS', 'WAITING_FOR_CLIENT', 'ANSWERED', 'UAT', 'READY_TO_CLOSE'];
const HIGH_PRIORITY_VALUES = ['HIGH', 'CRITICAL', 'BLOCKER', 'S1', 'S2', 'P1', 'P2', 'SEV1', 'SEV2'];
const ASSISTANT_SEARCH_LIMIT = 50;
const WAITING_FOR_CLIENT_STATUSES = new Set(['WAITING_FOR_CLIENT']);
const ASSISTANT_JIRA_PUSH_ROLES = new Set(['agent', 'agent_user', 'agent_manager', 'superadmin']);

function normalizeText(value = '') {
  return String(value || '').trim();
}

function normalizeKey(value = '') {
  return normalizeText(value).toUpperCase().replace(/[\s-]+/g, '_');
}

function compactText(value = '') {
  return normalizeText(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function stripOuterEntityNoise(value = '') {
  return normalizeText(value)
    .replace(/^[\s:;,.()\[\]{}"']+|[\s:;,.()\[\]{}"']+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeAssistantCommandText(value = '') {
  return compactText(value)
    .replace(/\breaise\b/g, 'raise')
    .replace(/\braies\b/g, 'raise')
    .replace(/\brais\b/g, 'raise')
    .replace(/\bcreat\b/g, 'create')
    .replace(/\bcrreate\b/g, 'create')
    .replace(/\bticketss\b/g, 'tickets')
    .replace(/\bisssue\b/g, 'issue')
    .replace(/\bissuse\b/g, 'issue')
    .replace(/\bisuue\b/g, 'issue')
    .replace(/\bissu\b/g, 'issue')
    .replace(/\bprblem\b/g, 'problem')
    .replace(/\bproblm\b/g, 'problem')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCreateIssueCommandOnly(message = '') {
  let text = normalizeAssistantCommandText(message);
  text = text
    .replace(/^(please|pls|kindly)\s+/, '')
    .replace(/^(can|could|shall|should|may)\s+(we|i|you)\s+/, '')
    .replace(/^i\s+(want|need|would like)\s+to\s+/, '')
    .replace(/^let us\s+/, '')
    .replace(/^lets\s+/, '')
    .replace(/\s+(please|pls)$/,'')
    .trim();
  return /^(raise|create|open|log|submit|report)( a| an| one| new| a new| another| fresh)? (issue|ticket|bug|query|cr|problem|incident|defect)$/.test(text)
    || /^(new|another|fresh) (issue|ticket|bug|query|cr|problem|incident|defect)$/.test(text)
    || /^(raise|create|open|log|submit|report) (issue|ticket|bug|query|cr|problem|incident|defect)$/.test(text);
}

function looksLikeEntityOnly(message = '', accessibleEntities = []) {
  const text = stripOuterEntityNoise(message);
  if (!text || text.length > 120 || /[.!?]/.test(text)) return false;
  const lower = text.toLowerCase();
  if (/\b(not working|error|failed|failing|slow|unable|cannot|can't|issue|problem|bug|crash|timeout|wrong|missing)\b/i.test(text)) return false;
  return accessibleEntities.some((entity) => {
    const values = [entity.name, entity.path, entity.acronym].filter(Boolean).map((item) => normalizeText(item).toLowerCase());
    return values.some((value) => value && (value === lower || value.includes(lower) || lower.includes(value)));
  });
}

function isUsableIssueTitle(title = '') {
  const text = normalizeText(title);
  const compact = compactText(text);
  if (!text || text.length < 8) return false;
  if (isCreateIssueCommandOnly(text)) return false;
  if (/^(issue|ticket|bug|query|cr|problem|incident|defect)$/i.test(compact)) return false;
  return true;
}

function isUsableIssueDescription(description = '') {
  const text = normalizeText(description);
  const compact = compactText(text);
  if (!text || text.length < 15) return false;
  if (isCreateIssueCommandOnly(text)) return false;
  if (/^(raise|create|open|log|submit|report|new) (issue|ticket|bug|query|cr|problem|incident|defect)$/i.test(compact)) return false;
  return /\b(error|failed|failing|slow|unable|cannot|can't|not working|wrong|missing|timeout|crash|login|access|payment|invoice|report|data|sync|jira|api|performance|security|configuration|need|request|change|query|clarification|issue|problem)\b/i.test(text)
    || text.split(/\s+/).length >= 5;
}

function isAffirmative(message = '') {
  return /^(yes|y|yeah|yep|ok|okay|confirm|confirmed|go ahead|create it|please create|do it)$/i.test(normalizeText(message));
}

function isNegative(message = '') {
  return /^(no|n|cancel|stop|dont|don't|do not|not now)$/i.test(normalizeText(message));
}

function getTenantIssueConfig(tenant = null) {
  return {
    priorities: Array.isArray(tenant?.issueConfig?.priorities) && tenant.issueConfig.priorities.length ? tenant.issueConfig.priorities : PRIORITY_VALUES,
    categories: Array.isArray(tenant?.issueConfig?.categories) && tenant.issueConfig.categories.length ? tenant.issueConfig.categories : ['General', 'Access', 'Billing', 'Configuration', 'Data', 'Integration', 'Performance', 'Security', 'Support', 'Bug'],
    sources: Array.isArray(tenant?.issueConfig?.sources) && tenant.issueConfig.sources.length ? tenant.issueConfig.sources : ['portal', 'api', 'internal'],
    requestTypes: REQUEST_TYPES
  };
}

function matchOption(value = '', options = [], fallback = '') {
  const raw = normalizeText(value);
  if (raw) {
    const exact = options.find((item) => normalizeText(item).toLowerCase() === raw.toLowerCase());
    if (exact) return exact;
  }
  return fallback || options[0] || '';
}

function roleLabel(role = '') {
  return {
    client: 'Client User',
    agent: 'Agent User',
    agent_user: 'Agent User',
    agent_manager: 'Agent Manager',
    superadmin: 'Super Admin',
    engagement_manager: 'Engagement Manager'
  }[role] || role || 'User';
}

function reporterTypeForUser(user) {
  if (isClientUser(user?.role)) return 'client_user';
  if (isInternalAgent(user?.role)) return 'agent';
  if (user?.role === 'superadmin') return 'superadmin';
  return 'system';
}

function canAssistantCreateIssue(user) {
  return ASSISTANT_CREATE_ROLES.has(user?.role) || canCreateIssue(user?.role);
}

function canAssistantViewIssue(user, issue) {
  if (!user || !issue) return false;
  if (['agent', 'agent_user', 'agent_manager', 'superadmin'].includes(user.role)) return true;
  return (issue.customerVisibility || 'VISIBLE_TO_CUSTOMER') === 'VISIBLE_TO_CUSTOMER';
}

function getScopedVisibilityFilter(user) {
  if (user?.role === 'client') {
    return {
      $or: [
        { customerVisibility: 'VISIBLE_TO_CUSTOMER' },
        { customerVisibility: { $exists: false } },
        { customerVisibility: null },
        { customerVisibility: '' }
      ]
    };
  }
  return null;
}

function addAndCondition(filter, condition) {
  if (!condition || typeof condition !== 'object') return filter;
  filter.$and = [
    ...(Array.isArray(filter.$and) ? filter.$and : []),
    condition
  ];
  return filter;
}

function getCustomerFacingStatus(issue) {
  const presentation = getClientStatusPresentation(null, issue?.status || 'NEW');
  return presentation?.clientLabel || issue?.status || 'NEW';
}

function sanitizeResponseIssue(issue, user) {
  const isClient = user?.role === 'client';
  evaluateIssueSla(issue);
  return {
    id: String(issue._id),
    issueNumber: issue.issueNumber,
    title: issue.title,
    entityName: issue.entityId?.name || issue.entitySnapshot?.name || '',
    entityPath: issue.entityId?.path || issue.entitySnapshot?.path || '',
    status: isClient ? getCustomerFacingStatus(issue) : issue.status,
    customerStatus: getCustomerFacingStatus(issue),
    internalStatus: isClient ? undefined : issue.status,
    priority: issue.priority,
    category: issue.category,
    requestType: issue.requestType || 'BUG',
    assignedTo: isClient ? undefined : (issue.assignedToUserId?.name || issue.assigneeSnapshot?.name || 'Unassigned'),
    sla: {
      responseStatus: issue.sla?.responseStatus || 'NO_SLA',
      resolutionStatus: issue.sla?.resolutionStatus || 'NO_SLA',
      responseDueAt: issue.sla?.responseDueAt || null,
      resolutionDueAt: issue.sla?.resolutionDueAt || null
    },
    jira: isClient ? undefined : {
      issueKey: issue.jira?.issueKey || '',
      currentStatusName: issue.jira?.currentStatusName || '',
      pushStatus: issue.jira?.pushStatus || 'NOT_PUSHED'
    },
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt
  };
}

function extractIssueNumber(text = '') {
  const match = normalizeText(text).match(ISSUE_NUMBER_PATTERN);
  return match ? match[1].toUpperCase() : '';
}

function extractPriority(text = '', priorities = PRIORITY_VALUES) {
  const normalized = normalizeText(text).toUpperCase();
  return priorities.find((priority) => normalized.includes(normalizeText(priority).toUpperCase())) || '';
}

function normalizeSeverityToken(value = '') {
  return normalizeText(value).toUpperCase().replace(/[\s_-]+/g, '');
}

function getHighSeverityValues(priorities = PRIORITY_VALUES) {
  const highTokens = new Set(HIGH_PRIORITY_VALUES.map(normalizeSeverityToken));
  return priorities.filter((priority) => highTokens.has(normalizeSeverityToken(priority)));
}

function escapeRegex(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSeverityFilter(text = '', priorities = PRIORITY_VALUES) {
  const normalized = normalizeText(text).toUpperCase();
  const compact = normalized.replace(/[\s_-]+/g, '');
  for (const priority of priorities) {
    const token = normalizeSeverityToken(priority);
    if (!token) continue;
    if (new RegExp('\\b' + escapeRegex(token) + '\\b').test(normalized) || compact.includes(token)) {
      return priority;
    }
  }
  const explicit = normalized.match(/\b(?:SEVERITY|PRIORITY|SEV|P)\s*[:#-]?\s*(S?\d|P?\d|HIGH|CRITICAL|BLOCKER|LOW|MEDIUM)\b/i);
  if (explicit) {
    const wanted = normalizeSeverityToken(explicit[1]);
    return priorities.find((priority) => normalizeSeverityToken(priority) === wanted || normalizeSeverityToken(priority).endsWith(wanted)) || explicit[1].toUpperCase();
  }
  return '';
}

function extractRequestType(text = '') {
  const normalized = normalizeText(text).toUpperCase();
  if (/\b(CR|CHANGE REQUEST|CHANGE)\b/.test(normalized)) return 'CR';
  if (/\b(QUERY|QUESTION|CLARIFICATION)\b/.test(normalized)) return 'QUERY';
  if (/\b(BUG|DEFECT|ERROR|FAIL|FAILING|BROKEN|ISSUE)\b/.test(normalized)) return 'BUG';
  return '';
}

function titleCaseIssueTitle(value = '') {
  const smallWords = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'via', 'with']);
  return normalizeText(value)
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      const clean = word.toLowerCase();
      if (index > 0 && smallWords.has(clean)) return clean;
      if (/^(API|ERP|SLA|JIRA|REST|URL|SSO|UAT|DB|CSV|PDF|UI|UX)$/i.test(word)) return word.toUpperCase();
      return clean.charAt(0).toUpperCase() + clean.slice(1);
    })
    .join(' ');
}

function buildSmartIssueTitle(description = '') {
  const text = normalizeText(description);
  if (!text) return '';
  const lower = text.toLowerCase();
  const systems = [];
  [
    ['ERP', /\berp\b/i],
    ['REST API', /\brest api\b|\bapi\b/i],
    ['Jira', /\bjira\b/i],
    ['Warehouse Database', /warehouse.*database|legacy warehouse/i],
    ['Inventory', /inventory/i],
    ['Login', /login|signin|sign in|authentication/i],
    ['Report', /report|dashboard/i],
    ['Billing', /billing|invoice|payment/i]
  ].forEach(([label, regex]) => { if (regex.test(text) && !systems.includes(label)) systems.push(label); });

  let failure = '';
  if (/sync|synchroni[sz]/i.test(text)) failure = 'Sync Failure';
  else if (/integration|interface/i.test(text)) failure = 'Integration Failure';
  else if (/bottleneck|slow|latency|performance|timeout/i.test(text)) failure = 'Performance Bottleneck';
  else if (/mismatch|wrong|incorrect|inconsistent/i.test(text)) failure = 'Data Mismatch';
  else if (/failed|failing|failure|error|not working|broken/i.test(text)) failure = 'Failure';
  else if (/delay|delayed/i.test(text)) failure = 'Delay';
  else if (/request|change/i.test(text)) failure = 'Change Request';

  let impact = '';
  if (/inventory mismatch|inventory mismatches/i.test(text)) impact = 'Causing Inventory Mismatches';
  else if (/supply chain delay|supply chain delays/i.test(text)) impact = 'Causing Supply Chain Delays';
  else if (/all users|users impacted|massive|widespread|critical/i.test(text)) impact = 'Impacting Users';
  else if (/roll-?out|release|deployment/i.test(text)) impact = 'During Rollout';

  const primary = systems.slice(0, 2).join(' / ');
  let title = [primary, failure, impact].filter(Boolean).join(' ');
  if (!title) {
    title = text
      .replace(/^(an?|the)\s+/i, '')
      .replace(/\b(experienced|causing|resulting in|while|smoothly|massive|widespread)\b/gi, '')
      .replace(/[^a-z0-9\s/.-]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(/\s+/)
      .slice(0, 10)
      .join(' ');
  }
  title = titleCaseIssueTitle(title).replace(/\s+/g, ' ').trim();
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length > 12) title = words.slice(0, 12).join(' ');
  return title.slice(0, 140);
}

function extractStatusFilters(text = '') {
  const raw = normalizeText(text);
  const normalized = raw.toLowerCase().replace(/[,_/]+/g, ' ');
  const explicitStatusContext = /\b(status|state)\b|\b(statuses|states)\b|\b(either|or|and)\b.*\b(open|new|closed|resolved|approved|answered|uat)\b/i.test(raw)
    || /\b(open|new|closed|resolved|approved|answered|uat)\b.*\b(or|and)\b/i.test(raw);
  const statuses = [];
  const add = (status) => { if (status && !statuses.includes(status)) statuses.push(status); };
  const phraseMap = [
    ['WAITING_FOR_CLIENT', /\b(waiting for client|waiting for customer|client input|customer input)\b/i],
    ['UNDER_REVIEW', /\b(under review|in review|review)\b/i],
    ['IN_PROGRESS', /\b(in progress|progressing|working on|work in progress)\b/i],
    ['READY_TO_CLOSE', /\b(ready to close|ready for closure)\b/i]
  ];
  phraseMap.forEach(([status, regex]) => { if (regex.test(raw)) add(status); });
  const tokenMap = {
    new: 'NEW',
    open: 'OPEN',
    approved: 'APPROVED',
    answered: 'ANSWERED',
    uat: 'UAT',
    resolved: 'RESOLVED',
    closed: 'CLOSED'
  };
  Object.entries(tokenMap).forEach(([token, status]) => {
    if (new RegExp('\\b' + token + '\\b', 'i').test(normalized)) add(status);
  });

  // Plain "open issues" should still mean active/open bucket. Exact status filtering is used when the user says status/state, or uses explicit OR/AND status language.
  if (!explicitStatusContext && statuses.length === 1 && statuses[0] === 'OPEN') return [];
  return statuses;
}

function extractCategoryFilter(text = '', categories = []) {
  const lower = normalizeText(text).toLowerCase();
  return (categories || []).find((category) => {
    const cat = normalizeText(category).toLowerCase();
    return cat && new RegExp('\\b' + escapeRegex(cat) + '\\b', 'i').test(lower);
  }) || '';
}


function extractProductHint(message = '', tenant = null) {
  const text = normalizeText(message);
  const explicit = text.match(/\b(?:product|module|application|app)\s+([a-z0-9][a-z0-9\s._-]{1,60})/i);
  if (explicit) return explicit[1].replace(/\b(is|with|where|that|about|severity|priority)\b.*$/i, '').trim();
  const configured = Array.isArray(tenant?.issueConfig?.products) ? tenant.issueConfig.products : [];
  const lower = text.toLowerCase();
  const matched = configured.find((product) => product && lower.includes(String(product).toLowerCase()));
  return matched || '';
}

function inferCategoryFromText(message = '', categories = []) {
  const lower = normalizeText(message).toLowerCase();
  const direct = categories.find((item) => item && lower.includes(normalizeText(item).toLowerCase()));
  if (direct) return direct;
  const hints = [
    ['Access', /login|password|signin|sign in|access|permission|role|auth/],
    ['Billing', /invoice|billing|payment|charge|amount|price|tax/],
    ['Integration', /api|webhook|integration|sync|jira|interface|sftp/],
    ['Performance', /slow|latency|timeout|performance|hang|loading/],
    ['Security', /security|vulnerability|breach|unauthori[sz]ed/],
    ['Data', /data|report|wrong value|mismatch|missing record|duplicate/],
    ['Configuration', /config|configuration|setup|mapping|rule/],
    ['Bug', /bug|error|failed|failing|crash|broken|exception|not working/],
    ['Support', /help|support|query|clarification/]
  ];
  const found = hints.find(([, regex]) => regex.test(lower));
  if (!found) return '';
  return categories.find((item) => normalizeText(item).toLowerCase() === found[0].toLowerCase()) || found[0];
}

function inferPriorityFromText(message = '', priorities = PRIORITY_VALUES) {
  const explicit = extractSeverityFilter(message, priorities) || extractPriority(message, priorities);
  if (explicit) return explicit;
  const lower = normalizeText(message).toLowerCase();
  const desired = /critical|production down|all users|outage|blocked|blocker|sev\s*1|s1/.test(lower)
    ? 'CRITICAL'
    : /urgent|major|high|many users|sev\s*2|s2|p1|p2/.test(lower)
      ? 'HIGH'
      : /minor|low|cosmetic/.test(lower)
        ? 'LOW'
        : '';
  if (!desired) return '';
  const exact = priorities.find((item) => normalizeSeverityToken(item) === normalizeSeverityToken(desired));
  if (exact) return exact;
  const normalizedPriorities = priorities.map((item) => ({ raw: item, token: normalizeSeverityToken(item) }));
  if (desired === 'CRITICAL') {
    const severe = normalizedPriorities.find((item) => ['S1', 'P1', 'SEV1', 'CRITICAL', 'BLOCKER'].includes(item.token));
    if (severe) return severe.raw;
  }
  if (desired === 'HIGH') {
    const high = normalizedPriorities.find((item) => ['S2', 'P2', 'SEV2', 'HIGH'].includes(item.token));
    if (high) return high.raw;
  }
  if (desired === 'LOW') {
    const low = normalizedPriorities.find((item) => ['S4', 'P4', 'LOW'].includes(item.token));
    if (low) return low.raw;
  }
  return priorities[0] || desired;
}


function formatOptionList(options = []) {
  return (options || []).filter(Boolean).slice(0, 12).join(' / ');
}

function parseSchemaSelectionMessage(message = '', masters = {}) {
  const text = normalizeText(message);
  const parsed = {};
  const priority = inferPriorityFromText(text, masters.priorities || PRIORITY_VALUES);
  if (priority) parsed.priority = priority;
  const category = inferCategoryFromText(text, masters.categories || []);
  if (category) parsed.category = category;
  const requestType = extractRequestType(text);
  if (requestType) parsed.requestType = requestType;
  const product = extractProductHint(text, { issueConfig: { products: masters.products || [] } });
  if (product) parsed.product = product;

  const parts = text.split(/[,|/;\n]+/).map((item) => normalizeText(item)).filter(Boolean);
  for (const part of parts) {
    if (!parsed.requestType) {
      const rt = (masters.requestTypes || REQUEST_TYPES).find((item) => normalizeKey(item) === normalizeKey(part));
      if (rt) parsed.requestType = normalizeKey(rt);
    }
    if (!parsed.priority) {
      const pr = (masters.priorities || PRIORITY_VALUES).find((item) => normalizeText(item).toLowerCase() === part.toLowerCase() || normalizeSeverityToken(item) === normalizeSeverityToken(part));
      if (pr) parsed.priority = pr;
    }
    if (!parsed.category) {
      const cat = (masters.categories || []).find((item) => normalizeText(item).toLowerCase() === part.toLowerCase());
      if (cat) parsed.category = cat;
    }
  }
  return parsed;
}

function hasExplicitSchemaChoice(data = {}, key = '') {
  return Boolean(data.schemaExplicit && data.schemaExplicit[key]);
}

function buildSchemaQuestion(data = {}, tenant = null) {
  const masters = getTenantIssueConfig(tenant);
  const suggested = {
    requestType: normalizeKey(data.requestType || extractRequestType(data.rawMessage || '')) || 'BUG',
    priority: data.priority || inferPriorityFromText(data.rawMessage || '', masters.priorities) || '',
    category: data.category || inferCategoryFromText(data.rawMessage || '', masters.categories) || ''
  };
  if (!suggested.priority) suggested.priority = masters.priorities.includes('MEDIUM') ? 'MEDIUM' : (masters.priorities[1] || masters.priorities[0] || 'MEDIUM');
  if (!suggested.category) suggested.category = masters.categories[0] || 'General';

  const lines = [
    'I have the issue details. Before I create it, classify it using the configured schema:',
    `Type: ${formatOptionList(masters.requestTypes || REQUEST_TYPES)}${suggested.requestType ? ` (suggested: ${suggested.requestType})` : ''}`,
    `Severity: ${formatOptionList(masters.priorities)}${suggested.priority ? ` (suggested: ${suggested.priority})` : ''}`,
    `Category: ${formatOptionList(masters.categories)}${suggested.category ? ` (suggested: ${suggested.category})` : ''}`
  ];
  const products = Array.isArray(tenant?.issueConfig?.products) ? tenant.issueConfig.products.filter(Boolean) : [];
  if (products.length && !normalizeText(data.product)) lines.push(`Product: ${formatOptionList(products)}`);
  lines.push('Reply like: “BUG, HIGH, Access” — or reply “yes” to accept the suggestions.');
  return { reply: lines.join('\n'), suggested };
}

function needsSchemaQuestion(data = {}, tenant = null) {
  if (data.schemaConfirmed) return false;
  if (!isUsableIssueTitle(data.title) || !isUsableIssueDescription(data.description)) return false;
  return true;
}

function buildCreateConfirmation(data = {}, entity = null) {
  const lines = [
    'I have enough details to raise this issue. Please confirm:',
    `Title: ${normalizeText(data.title)}`,
    `Description: ${normalizeText(data.description)}`,
    `Client/entity: ${entity ? (entity.path || entity.name) : normalizeText(data.entityHint || data.entityId)}`,
    `Severity: ${normalizeText(data.priority || 'MEDIUM')}`,
    `Category: ${normalizeText(data.category || 'General')}`,
    `Type: ${normalizeText(data.requestType || 'BUG')}`
  ];
  if (normalizeText(data.product)) lines.push(`Product: ${normalizeText(data.product)}`);
  lines.push('Reply “yes” to create it, or “no” to cancel.');
  return lines.join('\n');
}

function extractTitleAndDescription(message = '') {
  const text = normalizeText(message);
  if (!text || isCreateIssueCommandOnly(text)) return { title: '', description: '' };

  let cleaned = text
    .replace(/^(please\s+)?(raise|create|open|log|submit|report)\s+(an?\s+|new\s+)?(issue|ticket|bug|query|cr|problem|incident|defect)\s*(for)?\s*/i, '')
    .replace(/^(status\s+of|what'?s\s+the\s+status\s+of)\s+/i, '')
    .trim();

  cleaned = cleaned.replace(/^[:;,\.\-–—\s]+/, '').trim();
  if (!cleaned || isCreateIssueCommandOnly(cleaned)) return { title: '', description: '' };

  const titleMatch = cleaned.match(/(?:^|\b)(?:title|summary)\s*[:=-]\s*([^\n.;]+)(?:[\n.;]|$)/i);
  const descMatch = cleaned.match(/(?:^|\b)(?:description|details|detail)\s*[:=-]\s*([\s\S]+)$/i);
  if (titleMatch || descMatch) {
    const description = normalizeText(descMatch ? descMatch[1] : cleaned);
    const explicitTitle = normalizeText(titleMatch ? titleMatch[1] : '');
    const title = isUsableIssueTitle(explicitTitle) ? explicitTitle.slice(0, 140) : buildSmartIssueTitle(description);
    return { title: isUsableIssueTitle(title) ? title : '', description: isUsableIssueDescription(description) ? description : '' };
  }

  const parts = cleaned.split(/\s+[-–—:]\s+/).filter(Boolean);
  const rawDescription = (parts.length > 1 ? parts.slice(1).join(' - ') : cleaned).trim();
  const possibleExplicitShortTitle = parts.length > 1 ? normalizeText(parts[0]) : '';
  const title = isUsableIssueTitle(possibleExplicitShortTitle) && possibleExplicitShortTitle.split(/\s+/).length <= 12
    ? possibleExplicitShortTitle.slice(0, 140)
    : buildSmartIssueTitle(rawDescription || cleaned);
  return {
    title: isUsableIssueTitle(title) ? title : '',
    description: isUsableIssueDescription(rawDescription) ? rawDescription : ''
  };
}

async function getAccessibleEntities(user) {
  const ids = await getAccessibleEntityIdsForUser(user);
  if (!ids.length) return [];
  return Entity.find({ tenantId: user.tenantId, _id: { $in: ids }, isActive: true })
    .select('name path acronym metadata type')
    .sort({ path: 1 })
    .lean();
}

async function resolveEntityFromHint({ user, entityHint = '', entityId = '' }) {
  const entities = await getAccessibleEntities(user);
  if (!entities.length) return { entity: null, entities, reason: 'NO_SCOPE' };

  if (entityId && mongoose.Types.ObjectId.isValid(entityId)) {
    const entity = entities.find((item) => String(item._id) === String(entityId));
    if (entity) return { entity, entities, reason: 'ID_MATCH' };
  }

  const hintRaw = stripOuterEntityNoise(entityHint);
  const hint = hintRaw.toLowerCase();
  const hintCompact = hint.replace(/[^a-z0-9]+/g, '');
  if (hint) {
    const scored = entities.map((entity) => {
      const candidates = [entity.name, entity.path, entity.acronym].filter(Boolean).map((value) => normalizeText(value).toLowerCase());
      let score = 0;
      for (const candidate of candidates) {
        const cc = candidate.replace(/[^a-z0-9]+/g, '');
        if (candidate === hint || cc === hintCompact) score = Math.max(score, 100);
        else if (candidate.includes(hint) || hint.includes(candidate) || cc.includes(hintCompact) || hintCompact.includes(cc)) score = Math.max(score, 80);
        else {
          const words = hint.split(/\s+/).filter((w) => w.length >= 3);
          const matched = words.filter((w) => candidate.includes(w)).length;
          if (matched) score = Math.max(score, 40 + matched * 10);
        }
      }
      return { entity, score };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
    if (scored.length === 1 || (scored[0] && scored[0].score >= 80 && scored[0].score > (scored[1]?.score || 0))) {
      return { entity: scored[0].entity, entities, reason: 'TEXT_MATCH' };
    }
    if (scored.length > 1) return { entity: null, entities: scored.slice(0, 8).map((item) => item.entity), reason: 'AMBIGUOUS' };
  }

  if (entities.length === 1) return { entity: entities[0], entities, reason: 'ONLY_ONE' };
  return { entity: null, entities, reason: 'NEEDS_SELECTION' };
}

function extractEntityHint(message = '', accessibleEntities = []) {
  const raw = stripOuterEntityNoise(message);
  const lower = raw.toLowerCase();
  const explicit = lower.match(/\b(?:for|client|entity)\s+([a-z0-9][a-z0-9\s._()\/-]{1,80})/i);
  if (explicit) return stripOuterEntityNoise(explicit[1].replace(/\b(is|with|where|that|about|has|having)\b.*$/i, ''));
  const found = accessibleEntities.find((entity) => {
    const candidates = [entity.acronym, entity.name, entity.path].filter(Boolean).map((item) => normalizeText(item).toLowerCase());
    return candidates.some((candidate) => candidate && (lower.includes(candidate) || candidate.includes(lower.replace(/\([^)]*$/, '').trim())));
  });
  return found ? (found.acronym || found.name) : '';
}


function getEntityDescendantIds(entity, accessibleEntities = []) {
  if (!entity) return [];
  const basePath = normalizeText(entity.path);
  const baseId = String(entity._id);
  return accessibleEntities
    .filter((candidate) => {
      if (String(candidate._id) === baseId) return true;
      if (!basePath) return false;
      const candidatePath = normalizeText(candidate.path);
      return candidatePath && (candidatePath === basePath || candidatePath.startsWith(`${basePath}/`));
    })
    .map((candidate) => candidate._id);
}

function resolveEntityMentionForIssueQuery(message = '', accessibleEntities = []) {
  const raw = normalizeText(message);
  if (!raw || !accessibleEntities.length) return null;

  const upperTokens = new Set((raw.toUpperCase().match(/\b[A-Z0-9]{3,12}\b/g) || [])
    .filter((token) => !['HOW', 'MANY', 'OPEN', 'ISSUE', 'ISSUES', 'TICKET', 'TICKETS', 'THERE', 'WITH', 'CLIENT', 'ENTITY', 'FOR', 'ARE', 'THE', 'ALL', 'COUNT', 'TOTAL', 'NUMBER'].includes(token)));

  const acronymMatches = accessibleEntities.filter((entity) => {
    const acronym = normalizeText(entity.acronym).toUpperCase();
    return acronym && upperTokens.has(acronym);
  });
  if (acronymMatches.length === 1) {
    const entity = acronymMatches[0];
    return {
      entity,
      entityIds: getEntityDescendantIds(entity, accessibleEntities),
      label: entity.acronym || entity.name || entity.path || 'selected entity'
    };
  }

  const hint = extractEntityHint(message, accessibleEntities);
  if (!hint) return null;
  const hintLower = normalizeText(hint).toLowerCase();
  const hintCompact = hintLower.replace(/[^a-z0-9]+/g, '');
  const matches = accessibleEntities.filter((entity) => {
    const candidates = [entity.acronym, entity.name, entity.path].filter(Boolean).map((value) => normalizeText(value).toLowerCase());
    return candidates.some((candidate) => {
      const compact = candidate.replace(/[^a-z0-9]+/g, '');
      return candidate === hintLower || compact === hintCompact;
    });
  });
  if (matches.length === 1) {
    const entity = matches[0];
    return {
      entity,
      entityIds: getEntityDescendantIds(entity, accessibleEntities),
      label: entity.acronym || entity.name || entity.path || 'selected entity'
    };
  }
  return null;
}

function detectIntentWithoutDraft(message = '') {
  const text = normalizeAssistantCommandText(message);
  const issueNumber = extractIssueNumber(message);

  if (isCreateIssueCommandOnly(message)) return 'CREATE_ISSUE';

  if (issueNumber && /\b(push|send|move)\b.*\b(jira|execution)\b/.test(text)) return 'PUSH_TO_JIRA';
  if (issueNumber && /\b(jira)\b.*\b(push|send|create)\b/.test(text)) return 'PUSH_TO_JIRA';

  if (issueNumber && /\b(why|explain|sla|breach|breached|overdue|due|left|remaining|time left|stage|bottleneck|consumed)\b/.test(text)) return 'EXPLAIN_SLA';
  if (issueNumber && /\b(summary|summari[sz]e|recap|brief|what happened|history|tell me about)\b/.test(text)) return 'SUMMARIZE_ISSUE';
  if (issueNumber && /\b(customer update|customer-ready|customer ready|client update|reply to customer|response to customer)\b/.test(text)) return 'CUSTOMER_UPDATE_DRAFT';
  if (issueNumber && /\b(escalat|manager note|lead note|internal escalation)\b/.test(text)) return 'ESCALATION_DRAFT';

  if (issueNumber && /\b(add|post|write|put|leave|record|create)\b.*\b(comment|comments|note|notes|reply|replies|update|updates)\b/.test(text)) return 'ADD_COMMENT';
  if (issueNumber && /\b(comment|comments|note|notes|reply|replies)\b.*\b(on|to|for)\b/.test(text)) return 'ADD_COMMENT';
  if (issueNumber && /\b(assign|allocate|give)\b.*\b(to)\b/.test(text)) return 'ASSIGN_ISSUE';
  if (issueNumber && /\b(mark|move|change|set|update)\b.*\b(status|waiting for client|waiting for customer|in progress|resolved|closed|open|under review|uat|answered|approved)\b/.test(text)) return 'CHANGE_STATUS';
  if (issueNumber && /\b(waiting for client|waiting for customer|mark .*waiting|move .*waiting)\b/.test(text)) return 'CHANGE_STATUS';

  if (isOperationalCountQuestion(message)) return 'OPERATIONAL_QUERY';
  if (/\b(report|reporting|analytics|trend|breakdown|how many|count|compare|summarise|summarize|insight|insights)\b.*\b(issue|issues|ticket|tickets|sla|severity|status|agent|client|entity|product)\b/.test(text)) return 'REPORT_ANSWER';
  if (/\b(show|list|find|search|display|give|fetch|get)\b.*\b(issue|issues|ticket|tickets)\b/.test(text)) return 'LIST_ISSUES';
  if (/\b(my|all|open|active|pending|breached|overdue|assigned|severity|priority|s1|s2|p1|p2|critical|blocker|high severity|high priority)\b.*\b(issue|issues|ticket|tickets)\b/.test(text)) return 'LIST_ISSUES';

  if (issueNumber || /\b(status|where is|progress)\b/.test(text)) return 'GET_ISSUE_STATUS';
  if (/\b(create|add|provision)\b.*\b(user|account|client user|agent user|agent manager|superadmin|super admin)\b/.test(text)) return 'CREATE_USER';
  if (/\b(raise|create|open|log|submit|report)\b.*\b(issue|ticket|bug|query|cr|problem|incident|defect)\b/.test(text)) return 'CREATE_ISSUE';
  return 'UNKNOWN';
}

function shouldInterruptDraft(message = '', draft = null) {
  if (!draft?.intent) return false;
  if (isAffirmative(message) || isNegative(message)) return false;
  const freshIntent = detectIntentWithoutDraft(message);
  if (freshIntent === 'UNKNOWN') return false;
  if (freshIntent !== draft.intent) return true;
  if (freshIntent === 'CREATE_ISSUE' && isCreateIssueCommandOnly(message)) return true;
  if (extractIssueNumber(message) && draft.intent === 'CREATE_ISSUE') return true;
  return false;
}

function detectIntent(message = '', draft = null) {
  const freshIntent = detectIntentWithoutDraft(message);
  if (shouldInterruptDraft(message, draft)) return freshIntent;

  if (draft?.intent === 'CREATE_ISSUE') return 'CREATE_ISSUE';
  if (draft?.intent === 'ADD_COMMENT') return 'ADD_COMMENT';
  if (draft?.intent === 'CHANGE_STATUS') return 'CHANGE_STATUS';
  if (draft?.intent === 'ASSIGN_ISSUE') return 'ASSIGN_ISSUE';
  if (draft?.intent === 'EXPLAIN_SLA') return 'EXPLAIN_SLA';
  if (draft?.intent === 'SUMMARIZE_ISSUE') return 'SUMMARIZE_ISSUE';
  if (draft?.intent === 'PUSH_TO_JIRA') return 'PUSH_TO_JIRA';
  if (draft?.intent === 'CUSTOMER_UPDATE_DRAFT') return 'CUSTOMER_UPDATE_DRAFT';
  if (draft?.intent === 'ESCALATION_DRAFT') return 'ESCALATION_DRAFT';
  if (draft?.intent === 'REPORT_ANSWER') return 'REPORT_ANSWER';
  if (draft?.intent === 'CREATE_USER') return 'CREATE_USER';

  return freshIntent;
}
function mergeDraftWithMessage({ message, draft, tenant, accessibleEntities }) {
  const masters = getTenantIssueConfig(tenant);
  const merged = {
    ...(draft?.data || {}),
    rawMessage: message
  };

  if (isNegative(message)) {
    merged.cancelled = true;
    return merged;
  }
  if (isAffirmative(message) && draft?.intent === 'CREATE_ISSUE') {
    if (merged.awaitingSchemaSelection) {
      merged.priority = merged.suggestedSchema?.priority || merged.priority;
      merged.category = merged.suggestedSchema?.category || merged.category;
      merged.requestType = merged.suggestedSchema?.requestType || merged.requestType || 'BUG';
      merged.schemaConfirmed = true;
      merged.awaitingSchemaSelection = false;
      merged.schemaExplicit = { ...(merged.schemaExplicit || {}), acceptedSuggestions: true };
      return merged;
    }
    if (merged.awaitingConfirmation) {
      merged.confirmed = true;
      return merged;
    }
  }

  const entityOnly = looksLikeEntityOnly(message, accessibleEntities);
  const commandOnly = isCreateIssueCommandOnly(message);
  if (entityOnly && !merged.entityId) {
    merged.entityHint = stripOuterEntityNoise(message);
    return merged;
  }
  if (commandOnly) return merged;

  if (merged.awaitingSchemaSelection) {
    const parsedSchema = parseSchemaSelectionMessage(message, masters);
    merged.schemaExplicit = { ...(merged.schemaExplicit || {}) };
    ['priority', 'category', 'requestType', 'product'].forEach((key) => {
      if (parsedSchema[key]) {
        merged[key] = parsedSchema[key];
        merged.schemaExplicit[key] = true;
      }
    });
    if (merged.priority && merged.category && merged.requestType) {
      merged.schemaConfirmed = true;
      merged.awaitingSchemaSelection = false;
    }
    return merged;
  }

  const extracted = extractTitleAndDescription(message);
  if (!merged.title && extracted.title) merged.title = extracted.title;
  if (!merged.description && extracted.description) merged.description = extracted.description;

  merged.schemaExplicit = { ...(merged.schemaExplicit || {}) };
  const priority = inferPriorityFromText(message, masters.priorities);
  if (priority) { merged.priority = priority; merged.schemaExplicit.priority = true; }

  const requestType = extractRequestType(message);
  if (requestType) { merged.requestType = requestType; merged.schemaExplicit.requestType = true; }

  const category = inferCategoryFromText(message, masters.categories);
  if (category) { merged.category = category; merged.schemaExplicit.category = true; }

  const product = extractProductHint(message, tenant);
  if (product) merged.product = product;

  if (!merged.entityHint && !merged.entityId) merged.entityHint = extractEntityHint(message, accessibleEntities);
  return merged;
}


function mergeAiFieldsIntoCreateData(data = {}, ai = {}) {
  const fields = ai?.fields || {};
  const merged = { ...data };
  const safeTitle = isUsableIssueTitle(fields.title) ? normalizeText(fields.title) : '';
  const safeDescription = isUsableIssueDescription(fields.description) ? normalizeText(fields.description) : '';
  if (!normalizeText(merged.title) && safeTitle) merged.title = safeTitle;
  if (!normalizeText(merged.description) && safeDescription) merged.description = safeDescription;
  ['priority', 'category', 'requestType', 'product', 'entityHint', 'entityId'].forEach((key) => {
    if (!normalizeText(merged[key]) && normalizeText(fields[key])) merged[key] = normalizeText(fields[key]);
  });
  if (!isUsableIssueTitle(merged.title)) delete merged.title;
  if (!isUsableIssueDescription(merged.description)) delete merged.description;
  return merged;
}

function aiField(ai = {}, key = '') {
  return normalizeText(ai?.fields?.[key]);
}

function missingFieldsForCreate(data = {}, entityResolution = {}) {
  const missing = [];
  if (!isUsableIssueTitle(data.title)) missing.push('title');
  if (!isUsableIssueDescription(data.description)) missing.push('description');
  if (!entityResolution.entity) missing.push('entity');
  return missing;
}

function buildMissingFieldPrompt(missing = [], entityResolution = {}) {
  if (missing.includes('entity')) {
    const options = (entityResolution.entities || []).slice(0, 8).map((entity) => `${entity.name}${entity.acronym ? ` (${entity.acronym})` : ''}`).join(', ');
    if (entityResolution.reason === 'NO_SCOPE') return 'I cannot find any active entity in your scope. Please check your assignments.';
    if (entityResolution.reason === 'AMBIGUOUS') return `Which client/entity should I raise it for? I found: ${options}.`;
    return `Which client/entity should I raise it for? Available in your scope: ${options}.`;
  }
  if (missing.includes('title') && missing.includes('description')) return 'Please describe the issue. Include what is failing/requested, where it happens, and the impact. I will derive the title from that.';
  if (missing.includes('title')) return 'Please share a clearer short title for the issue.';
  if (missing.includes('description')) return 'Please share a little more detail: what is happening, where, and the impact.';
  return 'Please share the missing details.';
}


function extractEmailFromText(message = '') {
  const match = String(message || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : '';
}

function extractUserRoleFromText(message = '') {
  const text = compactText(message);
  if (/super ?admin/.test(text)) return 'superadmin';
  if (/agent manager/.test(text)) return 'agent_manager';
  if (/support head/.test(text)) return 'support_head';
  if (/regional head/.test(text)) return 'regional_head';
  if (/engagement manager/.test(text)) return 'engagement_manager';
  if (/agent user|\bagent\b/.test(text)) return 'agent_user';
  return 'client';
}

function extractNameFromUserCreateText(message = '', email = '') {
  let text = normalizeText(message)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig, ' ')
    .replace(/\b(create|add|provision|new|a|an|user|account|client user|agent user|agent manager|engagement manager|superadmin|super admin|with email|email|for|in|under|entity|client)\b/ig, ' ')
    .replace(/[:;,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text && email) text = email.split('@')[0].replace(/[._-]+/g, ' ');
  return text || '';
}

async function createUserFromAssistant({ tenant, user, message, draft = null }) {
  if (user.role !== 'superadmin') {
    return { intent: 'CREATE_USER', done: true, reply: 'Only a superadmin can create users from chat.', draft: null };
  }
  const data = { ...(draft?.data || {}) };
  data.email = extractEmailFromText(message) || data.email || '';
  data.role = extractUserRoleFromText(message) || data.role || 'client';
  data.name = extractNameFromUserCreateText(message, data.email) || data.name || '';

  const accessibleEntities = await getAccessibleEntities(user);
  const entityResolution = await resolveEntityFromHint({ user, entityHint: message, entityId: data.entityId || '' }).catch(() => ({ entity: null }));
  if (entityResolution.entity) data.entityId = String(entityResolution.entity._id);

  const missing = [];
  if (!data.name) missing.push('name');
  if (!data.email) missing.push('email');
  if (data.role === 'client' && !data.entityId) missing.push('entity/client scope');
  if (['agent','agent_user','agent_manager'].includes(data.role)) {
    return { intent: 'CREATE_USER', done: true, reply: 'Agent users and agent managers must first be added to the Approved Agent User Pool. After that, create them from the Users page so the governance check is preserved.', draft: null };
  }
  if (missing.length) {
    return {
      intent: 'CREATE_USER',
      done: false,
      reply: `I can create the user, but I need: ${missing.join(', ')}. Example: “Create client user Priya Nair priya@example.com for AX Bank”.`,
      draft: { intent: 'CREATE_USER', data }
    };
  }
  const { user: created, provisioningEmail } = await createUserForTenant({
    tenantId: tenant._id,
    tenant,
    name: data.name,
    email: data.email,
    password: 'password',
    role: data.role,
    entityId: data.entityId || undefined,
    entityIds: data.entityId ? [data.entityId] : [],
    createdByUser: user
  });
  await logAudit({ tenantId: tenant._id, actorUserId: user._id, action: 'assistant.user.created', entityType: 'user', entityId: created._id, after: { name: created.name, email: created.email, role: created.role } });
  return { intent: 'CREATE_USER', done: true, reply: `Created ${roleLabel(created.role)} ${created.name} (${created.email}). Temporary password: password.${provisioningEmail?.delivered ? ' Credentials email sent to the user.' : ' Credentials email was not sent because mail is not configured or failed.'}`, draft: null };
}

async function createIssueFromAssistant({ tenant, user, data }) {
  if (!canAssistantCreateIssue(user)) {
    const error = new Error('Your role can check issue status, but cannot raise issues from the assistant.');
    error.status = 403;
    throw error;
  }

  const masters = getTenantIssueConfig(tenant);
  const entityResolution = await resolveEntityFromHint({ user, entityHint: data.entityHint, entityId: data.entityId });
  const entity = entityResolution.entity;
  if (!entity) {
    const error = new Error(buildMissingFieldPrompt(['entity'], entityResolution));
    error.status = 400;
    error.entityResolution = entityResolution;
    throw error;
  }
  if (!(await userHasEntityAccess(user, entity._id))) {
    const error = new Error('You do not have access to this entity.');
    error.status = 403;
    throw error;
  }

  const priority = matchOption(data.priority, masters.priorities, masters.priorities[1] || masters.priorities[0] || 'MEDIUM');
  const category = matchOption(data.category, masters.categories, masters.categories[0] || 'General');
  const requestType = REQUEST_TYPES.includes(normalizeKey(data.requestType || 'BUG')) ? normalizeKey(data.requestType || 'BUG') : 'BUG';
  const source = user.role === 'client' ? 'portal' : (masters.sources.includes('api') ? 'api' : masters.sources[0] || 'portal');

  const [routing, resolvedJira, agreementBundle] = await Promise.all([
    resolveRouting({ tenantId: tenant._id, entityId: entity._id, category, priority }),
    resolveEffectiveEntityJiraConfig({ tenantId: tenant._id, entityId: entity._id }),
    resolveAgreementBundle({ tenantId: tenant._id, entityId: entity._id, category, priority, executionMode: 'NATIVE', supportGroupId: null })
  ]);

  const now = new Date();
  const slaPolicy = agreementBundle.bundle?.SLA || null;
  const slaSnapshot = buildSlaSnapshot({ policy: slaPolicy, startedAt: now, severity: priority });
  const commitments = buildCommitmentSnapshots(agreementBundle.bundle, now, priority);
  const issueNumber = await generateIssueNumber({ tenantId: tenant._id, entity });
  const customerVisibility = user.role === 'client' ? 'VISIBLE_TO_CUSTOMER' : 'VISIBLE_TO_CUSTOMER';

  const issue = await Issue.create({
    tenantId: tenant._id,
    entityId: entity._id,
    issueNumber,
    title: normalizeText(data.title).slice(0, 180),
    description: normalizeText(data.description).slice(0, 5000),
    status: 'NEW',
    priority,
    category,
    product: normalizeText(data.product) || entity.metadata?.product || '',
    createdByUserId: user._id,
    lastUpdatedByUserId: user._id,
    assignedToUserId: null,
    assignmentMode: 'UNASSIGNED',
    assignedByUserId: null,
    supportGroupId: routing.supportGroupId || null,
    routingRuleId: routing.routingRuleId || null,
    routingStatus: routing.routingStatus || 'NOT_ROUTED',
    routingDecision: {
      matched: Boolean(routing.routingRuleId),
      reason: routing.routingRuleId ? 'Matched routing rule' : 'No routing rule matched; defaults applied',
      evaluatedAt: now,
      trace: [
        { step: 'assistant', value: 'issue_created' },
        { step: 'category', value: category },
        { step: 'priority', value: priority },
        { step: 'entityId', value: String(entity._id) }
      ]
    },
    reporterType: reporterTypeForUser(user),
    triageStatus: 'NOT_TRIAGED',
    requestType,
    triageNotes: '',
    triagedByUserId: null,
    triagedAt: null,
    executionMode: 'NATIVE',
    executionState: 'NOT_STARTED',
    jiraDraft: resolvedJira.config ? {
      projectKey: resolvedJira.config.projectKey || routing.jiraProjectKey || '',
      issueTypeId: resolvedJira.config.issueTypeId || '',
      issueTypeName: resolvedJira.config.issueTypeName || '',
      metadataSource: resolvedJira.source || 'NONE',
      fields: {},
      appliedMappings: []
    } : {
      projectKey: routing.jiraProjectKey || '',
      issueTypeId: '',
      issueTypeName: '',
      metadataSource: 'NONE',
      fields: {},
      appliedMappings: []
    },
    jira: {
      projectKey: resolvedJira.config?.projectKey || routing.jiraProjectKey || '',
      pushStatus: 'NOT_PUSHED',
      pushErrorMessage: ''
    },
    sla: {
      ...slaSnapshot,
      stageStatus: [{ status: 'NEW', fromStatus: '', enteredAt: now, exitedAt: null, durationMinutes: 0, excludeFromFinalSla: false }]
    },
    commitments,
    slaEvents: [{ eventType: 'SLA_STARTED', at: now, policyName: slaSnapshot.policyName || '', commitmentCount: commitments.length }],
    attachments: [],
    tags: ['assistant-created'],
    source,
    customerVisibility
  });

  await Promise.allSettled([
    createIssueActivity({ tenantId: tenant._id, issueId: issue._id, entityId: issue.entityId, type: 'ISSUE_CREATED', metadata: { issueNumber: issue.issueNumber, role: user.role }, performedByUserId: user._id, performedByRole: reporterTypeForUser(user) }),
    logAudit({ tenantId: tenant._id, actorUserId: user._id, action: 'assistant.issue.created', entityType: 'issue', entityId: issue._id, after: { issueNumber: issue.issueNumber, entityId: String(issue.entityId), status: issue.status, priority, category, requestType } })
  ]);

  const populated = await Issue.findOne({ _id: issue._id, tenantId: tenant._id })
    .populate('entityId', 'name path acronym type')
    .populate('assignedToUserId', 'name email role')
    .lean();

  return populated;
}

async function getIssueStatusFromAssistant({ tenant, user, issueNumber }) {
  const normalizedIssueNumber = normalizeText(issueNumber).toUpperCase();
  if (!normalizedIssueNumber) {
    const error = new Error('Please share the issue number, for example ABCD-1001.');
    error.status = 400;
    throw error;
  }

  const allowedEntityIds = await getAccessibleEntityIdsForUser(user);
  const visibilityFilter = getScopedVisibilityFilter(user);
  const filter = {
    tenantId: tenant._id,
    issueNumber: normalizedIssueNumber,
    entityId: { $in: allowedEntityIds }
  };
  if (visibilityFilter) filter.$and = [visibilityFilter];

  const issue = await Issue.findOne(filter)
    .populate('entityId', 'name path acronym type')
    .populate('assignedToUserId', 'name email role')
    .populate('createdByUserId', 'name email role')
    .lean();

  if (!issue || !canAssistantViewIssue(user, issue)) {
    const error = new Error('I could not find that issue in your permitted scope.');
    error.status = 404;
    throw error;
  }
  return issue;
}


function getStartOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}


function normalizeUserRoleFilter(message = '') {
  const text = normalizeAssistantCommandText(message);
  if (/\b(client user|client users|customer user|customer users)\b/.test(text)) return { roles: ['client'], label: 'client user' };
  if (/\b(agent manager|agent managers|support lead|support leads)\b/.test(text)) return { roles: ['agent_manager'], label: 'agent manager' };
  if (/\b(agent user|agent users|agents|agent)\b/.test(text)) return { roles: ['agent', 'agent_user'], label: 'agent user' };
  if (/\b(super admin|superadmin|super admins|superadmins)\b/.test(text)) return { roles: ['superadmin'], label: 'super admin' };
  if (/\b(engagement manager|engagement managers)\b/.test(text)) return { roles: ['engagement_manager'], label: 'engagement manager' };
  if (/\b(user|users)\b/.test(text)) return { roles: [], label: 'user' };
  return null;
}

function isUserCountQuestion(message = '') {
  const text = normalizeAssistantCommandText(message);
  if (!/\b(how many|count|number of|total)\b/.test(text)) return false;
  return /\b(user|users|agent|agents|client user|client users|customer user|customer users|agent manager|agent managers|superadmin|super admin|engagement manager)\b/.test(text);
}

function isProactiveOpsQuestion(message = '') {
  const text = normalizeAssistantCommandText(message);
  return /\b(need attention|attention today|work on next|what should i work|priority|prioritise|prioritize|at risk|sla risk|risky clients|clients risky|changed since yesterday|what changed|why.*sla.*bad|operational summary|daily summary|health)\b/.test(text);
}

async function getScopedUserIdsForAssistant({ tenant, user, allowedEntityIds = [] }) {
  if (user?.role === 'superadmin') return null;
  if (!allowedEntityIds.length) return [];
  const memberships = await UserEntityMembership.find({
    tenantId: tenant._id,
    entityId: { $in: allowedEntityIds },
    status: 'active'
  }).select('userId').lean();
  return [...new Set(memberships.map((m) => String(m.userId)).filter(Boolean))];
}

async function answerUserCountQuestion({ tenant, user, message }) {
  const roleFilter = normalizeUserRoleFilter(message) || { roles: [], label: 'user' };
  const activeOnly = !/\b(inactive|disabled|deactivated)\b/i.test(message);
  const inactiveOnly = /\b(inactive|disabled|deactivated)\b/i.test(message);
  const { allowedEntityIds } = await getPermittedIssueBaseFilter({ tenant, user });
  const scopedUserIds = await getScopedUserIdsForAssistant({ tenant, user, allowedEntityIds });
  const filter = { tenantId: tenant._id };
  if (Array.isArray(scopedUserIds)) filter._id = { $in: scopedUserIds };
  if (roleFilter.roles.length === 1) filter.role = roleFilter.roles[0];
  else if (roleFilter.roles.length > 1) filter.role = { $in: roleFilter.roles };
  if (inactiveOnly) filter.isActive = false;
  else if (activeOnly) filter.isActive = true;

  const [total, active, inactive] = await Promise.all([
    User.countDocuments(filter),
    User.countDocuments({ ...filter, isActive: true }),
    User.countDocuments({ ...filter, isActive: false })
  ]);
  const noun = roleFilter.label || 'user';
  const statusLabel = inactiveOnly ? 'inactive ' : (activeOnly ? 'active ' : '');
  let reply = `There ${total === 1 ? 'is' : 'are'} ${total} ${statusLabel}${noun}${total === 1 ? '' : 's'} in your permitted scope.`;
  if (!activeOnly && !inactiveOnly) reply += ` Active: ${active}. Inactive: ${inactive}.`;
  if (/\b(breakdown|by role|role wise|role-wise)\b/i.test(message)) {
    const breakdown = await User.aggregate([
      { $match: filter },
      { $group: { _id: '$role', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);
    if (breakdown.length) reply += `\nBreakdown: ${breakdown.map((item) => `${roleLabel(item._id)}: ${item.count}`).join(', ')}.`;
  }
  return { intent: 'OPERATIONAL_QUERY', done: true, reply, total, draft: null };
}

function issueRiskScore(issue = {}) {
  let score = 0;
  const reasons = [];
  const priority = normalizeSeverityToken(issue.priority || '');
  if (['S1', 'P1', 'SEV1', 'CRITICAL', 'BLOCKER'].includes(priority)) { score += 40; reasons.push(`${issue.priority} severity`); }
  else if (['S2', 'P2', 'SEV2', 'HIGH'].includes(priority)) { score += 25; reasons.push(`${issue.priority} severity`); }
  if (issue.sla?.responseStatus === 'BREACHED' || issue.sla?.resolutionStatus === 'BREACHED') { score += 45; reasons.push('SLA breached'); }
  const dueAt = issue.sla?.resolutionDueAt ? new Date(issue.sla.resolutionDueAt) : null;
  if (dueAt && !Number.isNaN(dueAt.getTime())) {
    const hoursLeft = (dueAt - new Date()) / 36e5;
    if (hoursLeft >= 0 && hoursLeft <= 8) { score += 25; reasons.push(`resolution SLA due in ${Math.max(1, Math.round(hoursLeft))}h`); }
  }
  if (!issue.assignedToUserId) { score += 20; reasons.push('unassigned'); }
  if (issue.jira?.pushStatus === 'FAILED' || issue.executionState === 'FAILED') { score += 25; reasons.push('Jira push failed'); }
  if (issue.jira?.outboundState === 'QUEUED' || issue.executionState === 'READY_FOR_EXECUTION') { score += 10; reasons.push('Jira push pending'); }
  const updatedAt = issue.updatedAt ? new Date(issue.updatedAt) : null;
  if (updatedAt && !Number.isNaN(updatedAt.getTime())) {
    const daysIdle = (new Date() - updatedAt) / 864e5;
    if (daysIdle >= 3 && !['CLOSED', 'RESOLVED'].includes(issue.status)) { score += 15; reasons.push(`${Math.floor(daysIdle)}d without update`); }
  }
  if (issue.status === 'WAITING_FOR_CLIENT') { score += 5; reasons.push('waiting for client'); }
  return { score, reasons };
}

async function answerProactiveOpsQuestion({ tenant, user, message }) {
  const { filter, allowedEntityIds } = await getPermittedIssueBaseFilter({ tenant, user });
  if (!allowedEntityIds.length) {
    return { intent: 'PROACTIVE_INSIGHT', done: true, reply: 'No permitted issue scope found, so I cannot compute operational attention items.', total: 0, draft: null };
  }
  const openFilter = { ...filter, status: { $in: OPEN_STATUS_VALUES } };
  const issues = await Issue.find(openFilter)
    .populate('entityId', 'name path acronym type')
    .populate('assignedToUserId', 'name email role')
    .sort({ updatedAt: -1 })
    .limit(200)
    .lean();
  const ranked = issues.map((issue) => ({ issue, ...issueRiskScore(issue) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  const breached = issues.filter((issue) => issue.sla?.responseStatus === 'BREACHED' || issue.sla?.resolutionStatus === 'BREACHED').length;
  const unassigned = issues.filter((issue) => !issue.assignedToUserId).length;
  const jiraFailed = issues.filter((issue) => issue.jira?.pushStatus === 'FAILED' || issue.executionState === 'FAILED').length;
  const high = issues.filter((issue) => ['S1', 'S2', 'P1', 'P2', 'SEV1', 'SEV2', 'CRITICAL', 'BLOCKER', 'HIGH'].includes(normalizeSeverityToken(issue.priority))).length;

  const lines = [];
  lines.push(`Operational scan complete. I found ${issues.length} open/active issue${issues.length === 1 ? '' : 's'} in your permitted scope.`);
  lines.push(`Risk signals: ${breached} SLA-breached, ${high} high-severity, ${unassigned} unassigned, ${jiraFailed} Jira-failed.`);
  if (!ranked.length) {
    lines.push('Nothing looks urgent from the available SLA, severity, assignment and Jira signals. Nice, unusually calm for a service desk.');
  } else {
    lines.push('Top attention items:');
    ranked.forEach((item, index) => {
      const issue = sanitizeResponseIssue(item.issue, user);
      const entity = issue.entityName || issue.entityPath || 'No entity';
      lines.push(`${index + 1}. ${issue.issueNumber} — ${issue.title}`);
      lines.push(`   ${issue.status} · ${issue.priority || 'No severity'} · ${entity} · ${item.reasons.join(', ')}`);
    });
  }
  lines.push('Suggested next move: clear SLA-breached/high-severity items first, then unblock Jira failures and unassigned tickets.');
  return { intent: 'PROACTIVE_INSIGHT', done: true, reply: lines.join('\n'), total: ranked.length, draft: null };
}

function isEntityCountQuestion(message = '') {
  if (isUserCountQuestion(message)) return false;
  const text = normalizeAssistantCommandText(message);
  return /\b(how many|count|number of|total)\b.*\b(entit(?:y|ies)|client|clients|subclient|subclients)\b/.test(text)
    || /\b(entit(?:y|ies)|client|clients|subclient|subclients)\b.*\b(how many|count|number of|total)\b/.test(text);
}

function isIssueUpdatedTodayQuestion(message = '') {
  const text = normalizeAssistantCommandText(message);
  return /\b(how many|count|number of|total)\b.*\b(issue|issues|ticket|tickets)\b.*\b(updated|touched|changed|modified)\b.*\b(today)\b/.test(text)
    || /\b(issue|issues|ticket|tickets)\b.*\b(updated|touched|changed|modified)\b.*\b(today)\b/.test(text);
}

function isJiraNotPushedQuestion(message = '') {
  const text = normalizeAssistantCommandText(message);
  return /\b(how many|count|number of|total|show|list|find)\b.*\b(issue|issues|ticket|tickets)\b.*\b(not|never|pending|yet to|without|un)?\s*(pushed|sent|moved)\b.*\b(jira)\b/.test(text)
    || /\b(issue|issues|ticket|tickets)\b.*\b(not pushed|not sent|never pushed|yet to be pushed|without jira|no jira)\b/.test(text)
    || /\b(jira)\b.*\b(not pushed|not sent|pending push|without issue key|no issue key)\b/.test(text);
}

function isOperationalCountQuestion(message = '') {
  return isUserCountQuestion(message) || isEntityCountQuestion(message) || isIssueUpdatedTodayQuestion(message) || isJiraNotPushedQuestion(message) || isProactiveOpsQuestion(message);
}

function isIssueCountQuestion(message = '') {
  const text = normalizeAssistantCommandText(message);
  const hasCountIntent = /\b(how many|count|number of|total)\b/.test(text);
  const hasIssueSubject = /\b(issue|issues|ticket|tickets)\b/.test(text);
  const explicitListIntent = /\b(show|list|display|give me all|fetch all|open all|full list|complete list|details|detail view)\b/.test(text);
  return hasCountIntent && hasIssueSubject && !explicitListIntent;
}


function isIssueListQuestion(message = '') {
  const text = normalizeAssistantCommandText(message);
  return /\b(show|list|display|give|fetch|get|find)\b.*\b(issue|issues|ticket|tickets|it|them|those)\b/.test(text)
    || /^(show|list|display|open)\s+(it|them|those|same)$/i.test(text);
}

function isIssueFollowupMessage(message = '', context = null) {
  const text = normalizeAssistantCommandText(message);
  if (!context?.lastIssueQuery?.sourceMessage) return false;
  return /\b(show|list|display|open)\s+(it|them|those|same)\b/.test(text)
    || /\b(of those|from those|among those|same client|same entity|same status|same filter|same filters|what about|how about|only those|filter those)\b/.test(text)
    || /^(show it|show them|list them|list it|open it|open them|same|what about .+|how about .+)$/i.test(text);
}

function buildContextualIssueMessage(message = '', context = null) {
  const previous = normalizeText(context?.lastIssueQuery?.sourceMessage || '');
  const current = normalizeText(message);
  const currentNorm = normalizeAssistantCommandText(current);
  if (!previous) return current;
  if (/^(show|list|display|open)\s+(it|them|those|same)$/i.test(currentNorm)) return previous.replace(/\b(how many|count|number of|total)\b/ig, 'show');
  if (/\b(of those|from those|among those|same client|same entity|same status|same filter|same filters|only those|filter those)\b/i.test(current)) {
    return `${previous} ${current.replace(/\b(of those|from those|among those|same client|same entity|same status|same filter|same filters|only those|filter those)\b/ig, ' ')}`;
  }
  if (/\b(what about|how about)\b/i.test(current)) {
    return `${previous} ${current.replace(/\b(what about|how about)\b/ig, ' ')}`;
  }
  return `${previous} ${current}`;
}

function responseModeForIssueQuestion(message = '', context = null) {
  if (isIssueListQuestion(message)) return 'list';
  if (isIssueCountQuestion(message) || /\b(how many|count|number of|total)\b/i.test(message)) return 'count';
  return context?.lastIssueQuery?.responseMode || 'list';
}

function buildIssueQueryContext({ sourceMessage = '', effectiveMessage = '', responseMode = 'list', result = {} }) {
  return {
    lastIssueQuery: {
      sourceMessage: normalizeText(effectiveMessage || sourceMessage),
      userMessage: normalizeText(sourceMessage),
      responseMode,
      flags: result.flags || {},
      filterMeta: result.filterMeta || {},
      total: Number(result.total || 0),
      updatedAt: new Date().toISOString()
    }
  };
}

async function getPermittedIssueBaseFilter({ tenant, user }) {
  const allowedEntityIds = await getAccessibleEntityIdsForUser(user);
  const filter = {
    tenantId: tenant._id,
    entityId: { $in: allowedEntityIds }
  };
  const visibilityFilter = getScopedVisibilityFilter(user);
  if (visibilityFilter) filter.$and = [visibilityFilter];
  return { filter, allowedEntityIds };
}

async function answerOperationalCountQuestion({ tenant, user, message }) {
  const text = normalizeAssistantCommandText(message);

  if (isUserCountQuestion(message)) {
    return answerUserCountQuestion({ tenant, user, message });
  }

  if (isProactiveOpsQuestion(message)) {
    return answerProactiveOpsQuestion({ tenant, user, message });
  }

  if (isEntityCountQuestion(message)) {
    const accessibleEntities = await getAccessibleEntities(user);
    const total = accessibleEntities.length;
    const activeClients = accessibleEntities.filter((entity) => String(entity.type || '').toUpperCase() === 'CLIENT').length;
    const activeSubclients = accessibleEntities.filter((entity) => String(entity.type || '').toUpperCase() === 'SUBCLIENT').length;
    const breakdown = activeClients || activeSubclients
      ? ` Breakdown: ${activeClients} client${activeClients === 1 ? '' : 's'}, ${activeSubclients} subclient${activeSubclients === 1 ? '' : 's'}.`
      : '';
    return {
      intent: 'OPERATIONAL_QUERY',
      done: true,
      reply: `There ${total === 1 ? 'is' : 'are'} ${total} active entit${total === 1 ? 'y' : 'ies'} in your permitted scope.${breakdown}`,
      total,
      draft: null
    };
  }

  if (isIssueUpdatedTodayQuestion(message)) {
    const { filter, allowedEntityIds } = await getPermittedIssueBaseFilter({ tenant, user });
    if (!allowedEntityIds.length) {
      return { intent: 'OPERATIONAL_QUERY', done: true, reply: 'There are 0 issues updated today in your permitted scope.', total: 0, draft: null };
    }
    const start = getStartOfToday();
    const updatedFilter = { ...filter, updatedAt: { $gte: start } };
    const activityFilter = { tenantId: tenant._id, entityId: { $in: allowedEntityIds }, createdAt: { $gte: start } };
    const [updatedIssues, totalIssues, activityCount, commentCount] = await Promise.all([
      Issue.countDocuments(updatedFilter),
      Issue.countDocuments(filter),
      IssueActivity.countDocuments(activityFilter),
      IssueComment.countDocuments({ tenantId: tenant._id, createdAt: { $gte: start } })
    ]);
    return {
      intent: 'OPERATIONAL_QUERY',
      done: true,
      reply: `There ${updatedIssues === 1 ? 'is' : 'are'} ${updatedIssues} issue${updatedIssues === 1 ? '' : 's'} with updatedAt today in your permitted scope. Total permitted issues: ${totalIssues}. Activity records created today: ${activityCount}. Comments created today: ${commentCount}.`,
      total: updatedIssues,
      draft: null
    };
  }

  if (isJiraNotPushedQuestion(message)) {
    const { filter, allowedEntityIds } = await getPermittedIssueBaseFilter({ tenant, user });
    if (!allowedEntityIds.length) {
      return { intent: 'OPERATIONAL_QUERY', done: true, reply: 'There are 0 issues not pushed to Jira in your permitted scope.', total: 0, draft: null };
    }
    const notPushedFilter = {
      ...filter,
      $and: [
        ...(Array.isArray(filter.$and) ? filter.$and : []),
        {
          $or: [
            { 'jira.issueKey': { $exists: false } },
            { 'jira.issueKey': '' },
            { 'jira.issueKey': null },
            { 'jira.pushStatus': { $in: ['NOT_PUSHED', 'FAILED'] } },
            { executionState: { $in: ['NOT_STARTED', 'READY_FOR_EXECUTION', 'FAILED'] } }
          ]
        }
      ]
    };
    const pushedFilter = {
      ...filter,
      $and: [
        ...(Array.isArray(filter.$and) ? filter.$and : []),
        {
          $or: [
            { 'jira.issueKey': { $exists: true, $ne: '' } },
            { 'jira.pushStatus': 'PUSHED' },
            { executionState: { $in: ['PUSHED_TO_JIRA', 'SYNCED'] } }
          ]
        }
      ]
    };
    const [notPushed, pushed, total, queued, failed] = await Promise.all([
      Issue.countDocuments(notPushedFilter),
      Issue.countDocuments(pushedFilter),
      Issue.countDocuments(filter),
      Issue.countDocuments({ ...filter, 'jira.outboundState': 'QUEUED' }),
      Issue.countDocuments({ ...filter, $or: [{ 'jira.pushStatus': 'FAILED' }, { executionState: 'FAILED' }] })
    ]);
    const listRequested = /\b(show|list|find|which)\b/.test(text);
    let lines = [`There ${notPushed === 1 ? 'is' : 'are'} ${notPushed} issue${notPushed === 1 ? '' : 's'} not pushed to Jira in your permitted scope.`];
    lines.push(`Total permitted issues: ${total}. Already pushed/synced: ${pushed}. Queued for Jira push: ${queued}. Failed Jira push/state: ${failed}.`);
    lines.push('This is based on Jira linkage fields such as jira.issueKey, jira.pushStatus, jira.outboundState, and executionState — not inferred from issue status.');
    if (listRequested && notPushed) {
      const sample = await Issue.find(notPushedFilter).select('issueNumber title status priority jira executionState').sort({ updatedAt: -1 }).limit(10).lean();
      if (sample.length) {
        lines.push('Latest examples:');
        sample.forEach((issue, index) => lines.push(`${index + 1}. ${issue.issueNumber} — ${issue.title} · ${issue.status} · ${issue.priority || 'No severity'} · Jira ${issue.jira?.pushStatus || 'NOT_PUSHED'} · ${issue.executionState || 'NOT_STARTED'}`));
      }
    }
    return {
      intent: 'OPERATIONAL_QUERY',
      done: true,
      reply: lines.join('\n'),
      total: notPushed,
      draft: null
    };
  }

  return null;
}

function classifyIssueSearch(message = '', tenant = null) {
  const text = normalizeText(message).toLowerCase();
  const masters = getTenantIssueConfig(tenant);
  const severity = extractSeverityFilter(message, masters.priorities);
  const highSeverityValues = getHighSeverityValues(masters.priorities);
  const statusValues = extractStatusFilters(message);
  const category = extractCategoryFilter(message, masters.categories);
  const requestType = extractRequestType(message);
  const hasJiraContext = /\bjira\b/.test(text);
  const jiraPendingOnly = /\bjira\b.*\b(pending|queued|queue|ready|waiting)\b/.test(text)
    || /\b(pending|queued|queue|ready|waiting)\b.*\bjira\b/.test(text);
  const explicitOpenWord = /\b(open|active|unresolved)\b/.test(text);
  return {
    // Plain "pending issues" can mean active, but "Jira pending" maps to Jira push queue, not open status.
    openOnly: !statusValues.length && (explicitOpenWord || (!hasJiraContext && /\bpending\b/.test(text))),
    statusValues,
    category,
    requestType,
    jiraPendingOnly,
    assignedToMe: /\b(assigned to me|my assigned|assigned)\b/.test(text),
    breachedOnly: /\b(breached|sla breach|sla breached|overdue)\b/.test(text),
    highSeverityOnly: /\b(high severity|high priority|critical|blocker|severity high|priority high)\b/.test(text),
    severity,
    highSeverityValues,
    waitingForClient: /\b(waiting for client|waiting for me|client input|customer input)\b/.test(text),
    recentlyUpdated: /\b(updated today|touched today|recent|recently updated)\b/.test(text),
    all: /\b(all|every|complete list)\b/.test(text)
  };
}

function normalizeIssueFilterForDebug(filter = {}) {
  const debug = {};
  if (filter.status) debug.status = filter.status;
  if (filter.priority) debug.priority = filter.priority;
  if (filter.category) debug.category = filter.category;
  if (filter.requestType) debug.requestType = filter.requestType;
  if (filter.assignedToUserId) debug.assignedToUserId = String(filter.assignedToUserId);
  if (filter.executionMode) debug.executionMode = filter.executionMode;
  if (filter.executionState) debug.executionState = filter.executionState;
  if (filter.updatedAt) debug.updatedAt = filter.updatedAt;
  return debug;
}

function addScopedOrCondition(filter, orConditions = []) {
  const cleaned = Array.isArray(orConditions) ? orConditions.filter(Boolean) : [];
  if (!cleaned.length) return filter;
  addAndCondition(filter, { $or: cleaned });
  return filter;
}

function buildAssistantIssueFilterSummary(flags = {}) {
  const parts = [];
  if (flags.statusValues?.length) parts.push(`Status: ${flags.statusValues.join(' OR ')}`);
  else if (flags.openOnly) parts.push('Status: open/active bucket');
  if (flags.waitingForClient) parts.push('Status: WAITING_FOR_CLIENT');
  if (flags.jiraPendingOnly) parts.push('Jira: pending push/queue');
  if (flags.assignedToMe) parts.push('Assignment: assigned to me');
  if (flags.severity) parts.push(`Severity: ${flags.severity}`);
  else if (flags.highSeverityOnly) parts.push('Severity: high/critical bucket');
  if (flags.category) parts.push(`Category: ${flags.category}`);
  if (flags.requestType) parts.push(`Type: ${flags.requestType}`);
  if (flags.breachedOnly) parts.push('SLA: breached');
  if (flags.recentlyUpdated) parts.push('Updated: today/recent');
  if (flags.entityLabel) parts.push(`Entity: ${flags.entityLabel}`);
  return parts;
}

async function buildAssistantIssueQuery({ tenant, user, message, flags: incomingFlags = null }) {
  const allowedEntityIds = await getAccessibleEntityIdsForUser(user);
  const flags = incomingFlags || classifyIssueSearch(message, tenant);
  const meta = {
    allowedEntityCount: allowedEntityIds.length,
    filtersApplied: [],
    countVsListSafe: true,
    scopeApplied: true
  };

  if (!allowedEntityIds.length) {
    return {
      filter: { tenantId: tenant._id, entityId: { $in: [] } },
      flags,
      meta: { ...meta, filtersApplied: ['Scope: no permitted entities'] },
      limit: ASSISTANT_SEARCH_LIMIT
    };
  }

  const accessibleEntities = await getAccessibleEntities(user);
  const entityMention = resolveEntityMentionForIssueQuery(message, accessibleEntities);
  const scopedEntityIds = entityMention?.entityIds?.length
    ? entityMention.entityIds.filter((id) => allowedEntityIds.some((allowedId) => String(allowedId) === String(id)))
    : allowedEntityIds;
  if (entityMention?.label) flags.entityLabel = entityMention.label;

  const filter = {
    tenantId: tenant._id,
    entityId: { $in: scopedEntityIds }
  };

  const visibilityFilter = getScopedVisibilityFilter(user);
  if (visibilityFilter) addAndCondition(filter, visibilityFilter);

  // Status filters: explicit status values win over generic open bucket. Jira-pending is separate from issue status.
  if (flags.statusValues?.length) {
    filter.status = { $in: flags.statusValues };
  } else if (flags.openOnly) {
    filter.status = { $in: OPEN_STATUS_VALUES };
  }
  if (flags.waitingForClient) filter.status = 'WAITING_FOR_CLIENT';

  if (flags.jiraPendingOnly) {
    filter.executionMode = 'JIRA';
    addScopedOrCondition(filter, [
      { executionState: 'READY_FOR_EXECUTION' },
      { 'jira.outboundState': 'QUEUED' },
      { 'jira.outboundState': 'IN_FLIGHT' },
      { 'jira.pushStatus': 'NOT_PUSHED' },
      { 'jira.issueKey': { $exists: false } },
      { 'jira.issueKey': '' },
      { 'jira.issueKey': null }
    ]);
  }

  if (flags.assignedToMe && user.role !== 'client') filter.assignedToUserId = user._id;
  if (flags.category) filter.category = flags.category;
  if (flags.requestType) filter.requestType = flags.requestType;
  if (flags.severity) filter.priority = flags.severity;
  else if (flags.highSeverityOnly) filter.priority = { $in: flags.highSeverityValues.length ? flags.highSeverityValues : HIGH_PRIORITY_VALUES };

  if (flags.breachedOnly) {
    addScopedOrCondition(filter, [
      { 'sla.responseStatus': 'BREACHED' },
      { 'sla.resolutionStatus': 'BREACHED' }
    ]);
  }
  if (flags.recentlyUpdated) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    filter.updatedAt = { $gte: today };
  }

  meta.filtersApplied = buildAssistantIssueFilterSummary(flags);
  meta.debugFilter = normalizeIssueFilterForDebug(filter);
  const limit = flags.all ? 100 : ASSISTANT_SEARCH_LIMIT;
  return { filter, flags, meta, limit };
}

async function runAssistantIssueQuery({ tenant, user, message, includeIssues = true }) {
  const query = await buildAssistantIssueQuery({ tenant, user, message });
  const findQuery = includeIssues
    ? Issue.find(query.filter)
      .populate('entityId', 'name path acronym type')
      .populate('assignedToUserId', 'name email role')
      .sort({ updatedAt: -1, createdAt: -1 })
      .limit(query.limit)
      .lean()
    : Promise.resolve([]);

  const [issues, total] = await Promise.all([
    findQuery,
    Issue.countDocuments(query.filter)
  ]);

  return { issues, total, flags: query.flags, filterMeta: query.meta };
}

async function listIssuesFromAssistant({ tenant, user, message, includeIssues = true }) {
  return runAssistantIssueQuery({ tenant, user, message, includeIssues });
}

function buildIssueListReply(result = {}, user, message = '') {
  const issues = Array.isArray(result) ? result : (result.issues || []);
  const total = Array.isArray(result) ? issues.length : Number(result.total || issues.length || 0);
  const flags = result.flags || classifyIssueSearch(message);
  const labelParts = [];
  if (flags.assignedToMe && user.role !== 'client') labelParts.push('assigned to you');
  if (flags.statusValues?.length) labelParts.push(`status ${flags.statusValues.join(' or ')}`);
  else if (flags.openOnly) labelParts.push('open');
  if (flags.jiraPendingOnly) labelParts.push('Jira pending');
  if (flags.waitingForClient) labelParts.push('waiting for client');
  if (flags.breachedOnly) labelParts.push('SLA-breached');
  if (flags.severity) labelParts.push(`${flags.severity} severity`);
  else if (flags.highSeverityOnly) labelParts.push('high severity');
  if (flags.category) labelParts.push(`${flags.category} category`);
  if (flags.requestType) labelParts.push(`${flags.requestType} type`);
  if (flags.recentlyUpdated) labelParts.push('updated today');
  if (flags.entityLabel) labelParts.push(`for ${flags.entityLabel}`);
  const label = labelParts.length ? labelParts.join(', ') : 'matching';

  if (!issues.length) return `I could not find any ${label} issues in your permitted scope.`;

  const shown = issues.length;
  const suffix = total > shown ? ` Showing the latest ${shown}.` : '';
  const lines = [`Found ${total} ${label} issue${total === 1 ? '' : 's'} in your permitted scope.${suffix}`];
  issues.forEach((issue, index) => {
    const item = sanitizeResponseIssue(issue, user);
    const entity = item.entityName || item.entityPath || 'No entity';
    const assignee = item.assignedTo ? ` · ${item.assignedTo}` : '';
    lines.push(`${index + 1}. ${item.issueNumber} — ${item.title}`);
    lines.push(`   ${item.status} · ${item.priority || 'No severity'} · ${entity}${assignee}`);
  });
  return lines.join('\n');
}


function buildIssueCountReply(result = {}, user, message = '') {
  const total = Number(result.total || 0);
  const flags = result.flags || classifyIssueSearch(message);
  const labelParts = [];
  if (flags.assignedToMe && user.role !== 'client') labelParts.push('assigned to you');
  if (flags.statusValues?.length) labelParts.push(`status ${flags.statusValues.join(' or ')}`);
  else if (flags.openOnly) labelParts.push('open');
  if (flags.jiraPendingOnly) labelParts.push('Jira pending');
  if (flags.waitingForClient) labelParts.push('waiting for client');
  if (flags.breachedOnly) labelParts.push('SLA-breached');
  if (flags.severity) labelParts.push(`${flags.severity} severity`);
  else if (flags.highSeverityOnly) labelParts.push('high severity');
  if (flags.category) labelParts.push(`${flags.category} category`);
  if (flags.requestType) labelParts.push(`${flags.requestType} type`);
  if (flags.recentlyUpdated) labelParts.push('updated today');
  if (flags.entityLabel) labelParts.push(`for ${flags.entityLabel}`);
  const label = labelParts.length ? labelParts.join(', ') : 'matching';
  const base = `There ${total === 1 ? 'is' : 'are'} ${total} ${label} issue${total === 1 ? '' : 's'} in your permitted scope.`;
  if (/\b(filters used|explain filters|what filters|show filters)\b/i.test(message) && Array.isArray(result.filterMeta?.filtersApplied) && result.filterMeta.filtersApplied.length) {
    return `${base}\nFilters used: ${result.filterMeta.filtersApplied.join('; ')}.`;
  }
  return base;
}


function extractCommentText(message = '') {
  const text = normalizeText(message);
  const issueNumber = extractIssueNumber(text);
  let cleaned = text;
  if (issueNumber) cleaned = cleaned.replace(new RegExp(escapeRegex(issueNumber), 'i'), '').trim();
  cleaned = cleaned
    .replace(/^\s*(please\s+)?(add|post|write|put|leave|record|create)\s+(a\s+|an\s+|the\s+)?(comment|comments|note|notes|reply|replies|update|updates)\s*(to|on|for)?\s*/i, '')
    .replace(/^\s*(comment|comments|note|notes|reply|replies)\s*(on|to|for)?\s*/i, '')
    .replace(/^\s*(saying|that|as|with)\s*/i, '')
    .replace(/^\s*[:\-–—]\s*/, '')
    .trim();
  return cleaned;
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function minutesBetween(start, end = new Date()) {
  if (!start) return 0;
  const from = new Date(start);
  const to = new Date(end);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0;
  return Math.max(0, Math.round((to - from) / 60000));
}

function formatDuration(minutes = 0) {
  const mins = Math.max(0, Math.round(Number(minutes || 0)));
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  if (hours < 24) return rem ? `${hours}h ${rem}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours ? `${days}d ${remHours}h` : `${days}d`;
}

function explainSlaForIssue(issue, user) {
  const item = sanitizeResponseIssue(issue, user);
  const now = new Date();
  const sla = issue.sla || {};
  const responseDueAt = sla.responseDueAt ? new Date(sla.responseDueAt) : null;
  const resolutionDueAt = sla.resolutionDueAt ? new Date(sla.resolutionDueAt) : null;
  const stages = Array.isArray(sla.stageStatus) ? sla.stageStatus : [];
  const completedStages = stages.map((stage) => {
    const isOpen = !stage.exitedAt;
    const duration = isOpen ? minutesBetween(stage.enteredAt, now) : Number(stage.durationMinutes || minutesBetween(stage.enteredAt, stage.exitedAt));
    return {
      status: stage.status || 'UNKNOWN',
      duration,
      excluded: Boolean(stage.excludeFromFinalSla) || WAITING_FOR_CLIENT_STATUSES.has(stage.status)
    };
  });
  const countedMinutes = completedStages.filter((stage) => !stage.excluded).reduce((sum, stage) => sum + stage.duration, 0);
  const excludedMinutes = completedStages.filter((stage) => stage.excluded).reduce((sum, stage) => sum + stage.duration, 0);
  const longest = [...completedStages].sort((a, b) => b.duration - a.duration)[0];
  const lines = [
    `SLA view for ${item.issueNumber} — ${item.title}`,
    `Current status: ${item.status}`,
    `Response SLA: ${item.sla.responseStatus}${responseDueAt ? ` · due ${formatDateTime(responseDueAt)}` : ''}`,
    `Resolution SLA: ${item.sla.resolutionStatus}${resolutionDueAt ? ` · due ${formatDateTime(resolutionDueAt)}` : ''}`,
    `Counted working time so far: ${formatDuration(countedMinutes)}`
  ];
  if (excludedMinutes) lines.push(`Excluded / paused time: ${formatDuration(excludedMinutes)}${stages.some((stage) => WAITING_FOR_CLIENT_STATUSES.has(stage.status)) ? ' — waiting-for-client time is not counted.' : ''}`);
  if (longest) lines.push(`Largest time bucket: ${longest.status} for ${formatDuration(longest.duration)}${longest.excluded ? ' (excluded)' : ''}.`);
  if (resolutionDueAt && item.sla.resolutionStatus !== 'BREACHED') {
    const remaining = Math.max(0, Math.round((resolutionDueAt - now) / 60000));
    lines.push(`Approx. resolution time left: ${formatDuration(remaining)}.`);
  }
  if (item.sla.responseStatus === 'BREACHED' || item.sla.resolutionStatus === 'BREACHED') {
    lines.push('Suggested next action: review ownership, latest customer response, and whether the issue should be escalated.');
  } else if (item.status === 'WAITING_FOR_CLIENT') {
    lines.push('Suggested next action: wait for client input or send a reminder if the issue has been idle too long.');
  } else {
    lines.push('Suggested next action: keep the ticket moving before the next SLA checkpoint.');
  }
  return lines.join('\n');
}

async function summarizeIssueForAssistant({ tenant, user, issueNumber }) {
  const issue = await getIssueStatusFromAssistant({ tenant, user, issueNumber });
  const comments = await IssueComment.find({ tenantId: tenant._id, issueId: issue._id })
    .sort({ createdAt: -1 })
    .limit(5)
    .populate('authorUserId', 'name email role')
    .lean();
  const item = sanitizeResponseIssue(issue, user);
  const lines = [
    `${item.issueNumber} — ${item.title}`,
    `Entity: ${item.entityPath || item.entityName || 'Not available'}`,
    `Status: ${item.status} · Severity: ${item.priority || 'Not set'} · Category: ${item.category || 'Not set'}`,
    `Created: ${formatDateTime(item.createdAt)} · Last updated: ${formatDateTime(item.updatedAt)}`,
    `SLA: response ${item.sla.responseStatus}, resolution ${item.sla.resolutionStatus}`
  ];
  if (item.assignedTo) lines.push(`Owner: ${item.assignedTo}`);
  if (item.jira?.issueKey) lines.push(`Jira: ${item.jira.issueKey}${item.jira.currentStatusName ? ` (${item.jira.currentStatusName})` : ''}`);
  if (normalizeText(issue.description)) lines.push(`Description: ${normalizeText(issue.description).slice(0, 420)}${normalizeText(issue.description).length > 420 ? '…' : ''}`);
  const visibleComments = user.role === 'client' ? comments.filter((comment) => comment.visibility !== 'INTERNAL') : comments;
  if (visibleComments.length) {
    lines.push('Latest notes:');
    visibleComments.slice(0, 3).forEach((comment) => {
      const who = comment.authorUserId?.name || comment.authorUserId?.email || 'User';
      lines.push(`- ${who}: ${normalizeText(comment.commentText).slice(0, 180)}${normalizeText(comment.commentText).length > 180 ? '…' : ''}`);
    });
  }
  const aiReply = await generateIssueNarrative({ mode: 'summary', issue, comments: visibleComments, user });
  return { issue, reply: aiReply || lines.join('\n') };
}
function extractTargetStatus(message = '') {
  const text = normalizeText(message).toLowerCase();
  const map = [
    ['WAITING_FOR_CLIENT', /waiting\s+for\s+client|waiting\s+for\s+customer|client\s+input|customer\s+input/],
    ['IN_PROGRESS', /in\s+progress|working|started/],
    ['UNDER_REVIEW', /under\s+review|review/],
    ['READY_TO_CLOSE', /ready\s+to\s+close|close\s+review/],
    ['RESOLVED', /resolved|fixed|done/],
    ['CLOSED', /closed|close it|close\s+issue/],
    ['OPEN', /\bopen\b|reopen/],
    ['UAT', /\buat\b|testing/],
    ['ANSWERED', /answered|responded/],
    ['APPROVED', /approved/]
  ];
  const found = map.find(([, regex]) => regex.test(text));
  return found ? found[0] : '';
}

function extractAssigneeHint(message = '') {
  const text = normalizeText(message);
  const match = text.match(/\b(?:assign|allocate)\b.*?\bto\b\s+(.+)$/i);
  if (!match) return '';
  return match[1].replace(ISSUE_NUMBER_PATTERN, '').replace(/[.?!]+$/g, '').trim();
}

async function getScopedIssueForAction({ tenant, user, issueNumber }) {
  const issue = await getIssueStatusFromAssistant({ tenant, user, issueNumber });
  return Issue.findOne({ _id: issue._id, tenantId: tenant._id })
    .populate('entityId', 'name path acronym type')
    .populate('assignedToUserId', 'name email role');
}

async function addCommentFromAssistant({ tenant, user, issueNumber, commentText, internal = false }) {
  const issue = await getScopedIssueForAction({ tenant, user, issueNumber });
  if (!issue) {
    const error = new Error('I could not find that issue in your permitted scope.');
    error.status = 404;
    throw error;
  }
  if (!normalizeText(commentText)) {
    return { done: false, reply: `What comment should I add to ${issueNumber}?`, draft: { intent: 'ADD_COMMENT', data: { issueNumber } } };
  }
  const visibility = user.role === 'client' ? 'EXTERNAL' : (internal ? 'INTERNAL' : 'EXTERNAL');
  const comment = await IssueComment.create({
    tenantId: tenant._id,
    issueId: issue._id,
    entityId: issue.entityId._id || issue.entityId,
    commentText: normalizeText(commentText),
    authorUserId: user._id,
    authorRole: reporterTypeForUser(user),
    visibility,
    attachments: []
  });
  issue.lastUpdatedByUserId = user._id;
  await issue.save();
  await Promise.allSettled([
    createIssueActivity({ tenantId: tenant._id, issueId: issue._id, entityId: issue.entityId._id || issue.entityId, type: 'COMMENT_ADDED', metadata: { commentId: String(comment._id), visibility, source: 'assistant' }, performedByUserId: user._id, performedByRole: reporterTypeForUser(user) }),
    logAudit({ tenantId: tenant._id, actorUserId: user._id, action: 'assistant.issue.comment.created', entityType: 'issue_comment', entityId: comment._id, after: { issueId: String(issue._id), issueNumber: issue.issueNumber, visibility } })
  ]);
  return { done: true, reply: `Added ${visibility.toLowerCase()} comment to ${issue.issueNumber}.`, issue };
}

async function changeStatusFromAssistant({ tenant, user, issueNumber, status }) {
  if (!['agent', 'agent_user', 'agent_manager', 'superadmin'].includes(user.role)) {
    const error = new Error('Only internal users can change issue status from the assistant.');
    error.status = 403;
    throw error;
  }
  const issue = await getScopedIssueForAction({ tenant, user, issueNumber });
  if (!issue) {
    const error = new Error('I could not find that issue in your permitted scope.');
    error.status = 404;
    throw error;
  }
  const targetStatus = normalizeKey(status);
  if (!targetStatus || !ISSUE_STATUSES.includes(targetStatus)) {
    return { done: false, reply: `Which status should I move ${issueNumber} to? Supported statuses: ${ISSUE_STATUSES.join(', ')}.`, draft: { intent: 'CHANGE_STATUS', data: { issueNumber } } };
  }
  const beforeStatus = issue.status;
  if (beforeStatus === targetStatus) return { done: true, reply: `${issue.issueNumber} is already ${targetStatus}.`, issue };
  issue.status = targetStatus;
  issue.lastUpdatedByUserId = user._id;
  const now = new Date();
  issue.sla = issue.sla || {};
  issue.sla.stageStatus = Array.isArray(issue.sla.stageStatus) ? issue.sla.stageStatus : [];
  const activeStage = issue.sla.stageStatus.find((stage) => !stage.exitedAt);
  if (activeStage) {
    activeStage.exitedAt = now;
    activeStage.durationMinutes = Math.max(0, Math.round((now - new Date(activeStage.enteredAt || now)) / 60000));
    activeStage.excludeFromFinalSla = String(activeStage.status || '') === 'WAITING_FOR_CLIENT';
  }
  issue.sla.stageStatus.push({ status: targetStatus, fromStatus: beforeStatus || '', enteredAt: now, exitedAt: null, durationMinutes: 0, excludeFromFinalSla: targetStatus === 'WAITING_FOR_CLIENT' });
  if (targetStatus === 'WAITING_FOR_CLIENT' && !issue.sla.pausedAt) issue.sla.pausedAt = now;
  if (targetStatus !== 'WAITING_FOR_CLIENT' && issue.sla.pausedAt) {
    issue.sla.totalPausedMinutes = Number(issue.sla.totalPausedMinutes || 0) + Math.max(0, Math.round((now - new Date(issue.sla.pausedAt)) / 60000));
    issue.sla.pausedAt = null;
  }
  await issue.save();
  await Promise.allSettled([
    createIssueActivity({ tenantId: tenant._id, issueId: issue._id, entityId: issue.entityId._id || issue.entityId, type: 'STATUS_CHANGED', metadata: { before: beforeStatus, after: targetStatus, source: 'assistant' }, performedByUserId: user._id, performedByRole: reporterTypeForUser(user) }),
    logAudit({ tenantId: tenant._id, actorUserId: user._id, action: 'assistant.issue.status.updated', entityType: 'issue', entityId: issue._id, before: { status: beforeStatus }, after: { status: targetStatus } })
  ]);
  return { done: true, reply: `Moved ${issue.issueNumber} from ${beforeStatus} to ${targetStatus}.`, issue };
}

async function assignIssueFromAssistant({ tenant, user, issueNumber, assigneeHint }) {
  if (!['agent_manager', 'superadmin'].includes(user.role)) {
    const error = new Error('Only agent managers and superadmins can assign issues from the assistant.');
    error.status = 403;
    throw error;
  }
  const issue = await getScopedIssueForAction({ tenant, user, issueNumber });
  if (!issue) {
    const error = new Error('I could not find that issue in your permitted scope.');
    error.status = 404;
    throw error;
  }
  const hint = normalizeText(assigneeHint);
  if (!hint) {
    return { done: false, reply: `Who should I assign ${issueNumber} to?`, draft: { intent: 'ASSIGN_ISSUE', data: { issueNumber } } };
  }
  const escaped = escapeRegex(hint);
  const candidates = await User.find({
    tenantId: tenant._id,
    isActive: true,
    role: { $in: ['agent', 'agent_user'] },
    $or: [
      { email: new RegExp(escaped, 'i') },
      { name: new RegExp(escaped, 'i') }
    ]
  }).limit(5);
  if (candidates.length !== 1) {
    const names = candidates.map((candidate) => candidate.name || candidate.email).join(', ');
    return { done: false, reply: candidates.length ? `I found multiple matching agents: ${names}. Please use the exact email.` : `I could not find an active agent matching “${hint}”.`, draft: { intent: 'ASSIGN_ISSUE', data: { issueNumber } } };
  }
  const assignee = await validateAssignableAgentForEntity({ tenantId: tenant._id, agentUserId: candidates[0]._id, entityId: issue.entityId._id || issue.entityId });
  const beforeAssignedToUserId = issue.assignedToUserId ? String(issue.assignedToUserId._id || issue.assignedToUserId) : '';
  const beforeName = issue.assignedToUserId ? (issue.assignedToUserId.name || issue.assignedToUserId.email || 'Assigned') : 'Unassigned';
  const afterName = assignee.name || assignee.email;
  issue.assignedToUserId = assignee._id;
  issue.assignmentMode = 'PUSH';
  issue.assignedByUserId = user._id;
  issue.lastUpdatedByUserId = user._id;
  await issue.save();
  await Promise.allSettled([
    createIssueActivity({ tenantId: tenant._id, issueId: issue._id, entityId: issue.entityId._id || issue.entityId, type: 'ASSIGNED', metadata: { before: beforeName, after: afterName, beforeAssignedToUserId, afterAssignedToUserId: String(assignee._id), source: 'assistant' }, performedByUserId: user._id, performedByRole: reporterTypeForUser(user) }),
    logAudit({ tenantId: tenant._id, actorUserId: user._id, action: 'assistant.issue.assigned', entityType: 'issue', entityId: issue._id, before: { assignedToUserId: beforeAssignedToUserId }, after: { assignedToUserId: String(assignee._id), assignedToName: afterName } })
  ]);
  const populated = await Issue.findOne({ _id: issue._id, tenantId: tenant._id }).populate('entityId', 'name path acronym type').populate('assignedToUserId', 'name email role').lean();
  return { done: true, reply: `Assigned ${issue.issueNumber} to ${afterName}.`, issue: populated };
}


function getIntakeConfigFromConnection(connection = {}) {
  const intake = connection.intake || {};
  const hasExplicitConfig = Boolean(
    intake.projectKey || intake.issueTypeName || typeof intake.minimalMode === 'boolean' || typeof intake.isActive === 'boolean'
  );
  const isActive = intake.isActive === true || (!('isActive' in intake) && hasExplicitConfig);
  return {
    minimalMode: isActive ? intake.minimalMode !== false : false,
    projectKey: String(intake.projectKey || '').trim().toUpperCase(),
    issueTypeName: String(intake.issueTypeName || 'Bug').trim() || 'Bug',
    isActive
  };
}

async function pushIssueToJiraFromAssistant({ tenant, user, issueNumber }) {
  if (!ASSISTANT_JIRA_PUSH_ROLES.has(user.role)) {
    const error = new Error('Only internal users can push issues to Jira from the assistant. Client users can track status, but Jira execution is controlled by the service team.');
    error.status = 403;
    throw error;
  }
  const issue = await getScopedIssueForAction({ tenant, user, issueNumber });
  if (!issue) {
    const error = new Error('I could not find that issue in your permitted scope.');
    error.status = 404;
    throw error;
  }
  if (issue.jira?.issueKey || issue.jira?.pushStatus === 'PUSHED') {
    return { done: true, reply: `${issue.issueNumber} is already pushed to Jira${issue.jira?.issueKey ? ` as ${issue.jira.issueKey}` : ''}.`, issue };
  }

  const connection = await getTenantJiraConnection({ tenantId: tenant._id, includeSecret: true });
  if (!connection || !connection.isActive) {
    const error = new Error('Active Jira configuration is required before pushing issues.');
    error.status = 400;
    throw error;
  }
  if (connection.lastValidationStatus !== 'SUCCESS') {
    const error = new Error('Jira configuration must be validated before pushing issues.');
    error.status = 400;
    throw error;
  }

  const intake = getIntakeConfigFromConnection(connection);
  const projectKey = intake.isActive && intake.minimalMode
    ? intake.projectKey
    : String(issue.jiraDraft?.projectKey || issue.jira?.projectKey || connection.projectKeyDefault || intake.projectKey || '').trim().toUpperCase();
  const issueTypeId = intake.isActive && intake.minimalMode ? '' : String(issue.jiraDraft?.issueTypeId || connection.issueTypeIdDefault || '').trim();
  const issueTypeName = intake.isActive && intake.minimalMode
    ? intake.issueTypeName
    : String(issue.jiraDraft?.issueTypeName || connection.issueTypeNameDefault || intake.issueTypeName || 'Bug').trim();

  if (!projectKey) {
    const error = new Error('No Jira project key could be resolved for this issue. Configure intake project key or issue/entity Jira mapping.');
    error.status = 400;
    throw error;
  }
  if (!issueTypeId && !issueTypeName) {
    const error = new Error('No Jira issue type could be resolved for this issue. Configure issue type in Admin Console or Jira connection.');
    error.status = 400;
    throw error;
  }

  issue.jira = issue.jira || {};
  issue.jiraDraft = issue.jiraDraft || {};
  issue.jira.projectKey = projectKey;
  issue.jira.pushStatus = 'NOT_PUSHED';
  issue.jira.pushErrorMessage = '';
  issue.jira.outboundState = 'QUEUED';
  issue.jira.outboundAttemptedAt = new Date();
  issue.executionMode = 'JIRA';
  issue.executionState = 'READY_FOR_EXECUTION';
  issue.lastUpdatedByUserId = user._id;
  issue.jiraDraft.projectKey = projectKey;
  issue.jiraDraft.issueTypeId = issueTypeId;
  issue.jiraDraft.issueTypeName = issueTypeName;
  await issue.save();

  const job = await enqueueJiraPush({ tenantId: tenant._id, issueId: issue._id, triggeredByUserId: user._id, requestedProjectKey: projectKey, issueTypeId, issueTypeName });
  const refreshed = await Issue.findById(issue._id).populate('entityId', 'name path acronym type').populate('assignedToUserId', 'name email role').lean();
  const pushedKey = refreshed?.jira?.issueKey || '';
  const status = refreshed?.jira?.pushStatus || 'NOT_PUSHED';
  const queuedText = job?.status && !pushedKey ? ` Queue status: ${job.status}.` : '';
  return {
    done: true,
    reply: pushedKey ? `Pushed ${issue.issueNumber} to Jira as ${pushedKey}.` : `Jira push started for ${issue.issueNumber}. Current status: ${status}.${queuedText}`,
    issue: refreshed || issue
  };
}

function buildStatusReply(issue, user) {
  const item = sanitizeResponseIssue(issue, user);
  const lines = [
    `${item.issueNumber} — ${item.title}`,
    `Status: ${item.status}`,
    `Priority: ${item.priority || 'Not set'}`,
    `Entity: ${item.entityPath || item.entityName || 'Not available'}`,
    `SLA: response ${item.sla.responseStatus}, resolution ${item.sla.resolutionStatus}`
  ];
  if (item.assignedTo) lines.push(`Assigned to: ${item.assignedTo}`);
  if (item.jira?.issueKey) lines.push(`Jira: ${item.jira.issueKey}${item.jira.currentStatusName ? ` (${item.jira.currentStatusName})` : ''}`);
  return lines.join('\n');
}


function tokenizeKnowledgeQuery(message = '') {
  const stop = new Set(['what','where','when','which','show','tell','give','about','from','with','that','this','have','does','issue','issues','ticket','tickets','the','and','for','you','can','based','uploaded','knowledge','database','ai']);
  return compactText(message).split(' ').filter((word) => word.length >= 3 && !stop.has(word)).slice(0, 8);
}

function trimKnowledgeSnippet(text = '', tokens = []) {
  const raw = normalizeText(text).replace(/\s+/g, ' ');
  if (!raw) return '';
  const lower = raw.toLowerCase();
  let index = -1;
  for (const token of tokens) {
    index = lower.indexOf(token.toLowerCase());
    if (index >= 0) break;
  }
  const start = Math.max(0, index >= 0 ? index - 120 : 0);
  const snippet = raw.slice(start, start + 420);
  return (start > 0 ? '…' : '') + snippet + (start + 420 < raw.length ? '…' : '');
}

async function answerFromKnowledge({ tenant, user, message, accessibleEntities = [] }) {
  const tokens = tokenizeKnowledgeQuery(message);
  if (!tokens.length) return null;
  const accessibleIds = (accessibleEntities || []).map((entity) => String(entity._id));
  const visibility = isClientUser(user?.role)
    ? [
        { visibilityScope: 'ALL_CUSTOMERS' },
        { visibilityScope: 'SPECIFIC_CUSTOMERS', scopedEntityIds: { $in: accessibleIds } }
      ]
    : [
        { visibilityScope: { $in: ['ALL_CUSTOMERS', 'INTERNAL_ONLY'] } },
        { visibilityScope: 'SPECIFIC_CUSTOMERS', scopedEntityIds: { $in: accessibleIds } }
      ];
  const regexes = tokens.map((token) => new RegExp(escapeRegex(token), 'i'));
  const docs = await KnowledgeDocument.find({
    tenantId: tenant._id,
    learningStatus: { $in: ['PARSED', 'UPLOADED'] },
    $and: [
      { $or: visibility },
      { $or: regexes.flatMap((regex) => [{ title: regex }, { rawText: regex }, { tags: regex }]) }
    ]
  }).sort({ createdAt: -1 }).limit(5).lean();
  if (!docs.length) return null;
  const lines = docs.slice(0, 3).map((doc, index) => {
    const snippet = trimKnowledgeSnippet(doc.rawText || doc.title || '', tokens);
    return `**${index + 1}. ${doc.title || doc.originalName || 'Knowledge item'}**
${snippet || 'This item matched your question, but does not contain a clean extract.'}
Scope: ${doc.visibilityScope ? doc.visibilityScope.replace(/_/g, ' ').toLowerCase() : 'internal'}`;
  });
  return {
    intent: 'KNOWLEDGE_ANSWER',
    done: true,
    reply: `Here is what I found from the uploaded knowledge base.\n\n${lines.join('\\n\\n')}\n\nSuggested next step: use this as guidance, but verify against the current ticket context before replying to the customer or closing the issue. I only used knowledge items allowed for your role and client scope.`,
    total: docs.length,
    draft: null,
    aiEnabled: false
  };}

async function handleAssistant({ tenant, user, message, draft = null, context = null }) {
  const accessibleEntities = await getAccessibleEntities(user);
  const interruptedDraft = shouldInterruptDraft(message, draft);
  const effectiveDraft = interruptedDraft ? null : draft;
  const heuristicIntent = detectIntent(message, effectiveDraft);

  if (heuristicIntent === 'OPERATIONAL_QUERY') {
    const operationalAnswer = await answerOperationalCountQuestion({ tenant, user, message });
    if (operationalAnswer) return operationalAnswer;
  }

  if (isIssueFollowupMessage(message, context)) {
    const effectiveMessage = buildContextualIssueMessage(message, context);
    const responseMode = responseModeForIssueQuestion(message, context);
    const result = await listIssuesFromAssistant({ tenant, user, message: effectiveMessage, includeIssues: responseMode !== 'count' });
    return {
      intent: responseMode === 'count' ? 'REPORT_ANSWER' : 'LIST_ISSUES',
      done: true,
      reply: responseMode === 'count' ? buildIssueCountReply(result, user, effectiveMessage) : buildIssueListReply(result, user, effectiveMessage),
      issues: responseMode === 'count' ? [] : result.issues.map((issue) => sanitizeResponseIssue(issue, user)),
      total: result.total,
      draft: null,
      context: buildIssueQueryContext({ sourceMessage: message, effectiveMessage, responseMode, result }),
      contextualFollowup: true
    };
  }

  if (isIssueCountQuestion(message)) {
    const result = await listIssuesFromAssistant({ tenant, user, message, includeIssues: false });
    return {
      intent: 'REPORT_ANSWER',
      done: true,
      reply: buildIssueCountReply(result, user, message),
      issues: [],
      total: result.total,
      draft: null,
      context: buildIssueQueryContext({ sourceMessage: message, effectiveMessage: message, responseMode: 'count', result }),
      aiEnabled: false
    };
  }

  const ai = await extractAssistantIntentWithOpenAi({
    message,
    heuristicIntent,
    tenantConfig: getTenantIssueConfig(tenant),
    accessibleEntities
  });
  const aiIntentAllowed = ai?.confidence >= 0.65 && ai.intent && (!interruptedDraft || ai.intent === heuristicIntent);
  const intent = aiIntentAllowed ? ai.intent : heuristicIntent;
  draft = effectiveDraft;

  if (intent === 'OPERATIONAL_QUERY') {
    const operationalAnswer = await answerOperationalCountQuestion({ tenant, user, message });
    if (operationalAnswer) return operationalAnswer;
  }

  if (intent === 'CREATE_USER') {
    return createUserFromAssistant({ tenant, user, message, draft });
  }

  if (intent === 'ADD_COMMENT') {
    const issueNumber = extractIssueNumber(message) || normalizeText(draft?.data?.issueNumber);
    if (!issueNumber) {
      return { intent, done: false, reply: 'Which issue should I add the comment to? Please share the issue number.', draft: { intent: 'ADD_COMMENT', data: {} } };
    }
    const commentText = extractCommentText(message) || aiField(ai, 'commentText') || normalizeText(draft?.data?.commentText);
    const internal = /\binternal\b/i.test(message);
    const result = await addCommentFromAssistant({ tenant, user, issueNumber, commentText, internal });
    return { intent, done: result.done, reply: result.reply, issue: result.issue ? sanitizeResponseIssue(result.issue, user) : undefined, draft: result.draft || null };
  }

  if (intent === 'CHANGE_STATUS') {
    const issueNumber = extractIssueNumber(message) || normalizeText(draft?.data?.issueNumber);
    if (!issueNumber) {
      return { intent, done: false, reply: 'Which issue should I update? Please share the issue number.', draft: { intent: 'CHANGE_STATUS', data: {} } };
    }
    const status = extractTargetStatus(message) || aiField(ai, 'status') || normalizeText(draft?.data?.status);
    const result = await changeStatusFromAssistant({ tenant, user, issueNumber, status });
    return { intent, done: result.done, reply: result.reply, issue: result.issue ? sanitizeResponseIssue(result.issue, user) : undefined, draft: result.draft || null };
  }

  if (intent === 'ASSIGN_ISSUE') {
    const issueNumber = extractIssueNumber(message) || normalizeText(draft?.data?.issueNumber);
    if (!issueNumber) {
      return { intent, done: false, reply: 'Which issue should I assign? Please share the issue number.', draft: { intent: 'ASSIGN_ISSUE', data: {} } };
    }
    const assigneeHint = extractAssigneeHint(message) || aiField(ai, 'assigneeHint') || normalizeText(draft?.data?.assigneeHint);
    const result = await assignIssueFromAssistant({ tenant, user, issueNumber, assigneeHint });
    return { intent, done: result.done, reply: result.reply, issue: result.issue ? sanitizeResponseIssue(result.issue, user) : undefined, draft: result.draft || null };
  }

  if (intent === 'PUSH_TO_JIRA') {
    const issueNumber = extractIssueNumber(message) || normalizeText(draft?.data?.issueNumber);
    if (!issueNumber) {
      return { intent, done: false, reply: 'Which issue should I push to Jira? Please share the issue number.', draft: { intent: 'PUSH_TO_JIRA', data: {} } };
    }
    const result = await pushIssueToJiraFromAssistant({ tenant, user, issueNumber });
    return { intent, done: result.done, reply: result.reply, issue: result.issue ? sanitizeResponseIssue(result.issue, user) : undefined, draft: null };
  }

  if (intent === 'CUSTOMER_UPDATE_DRAFT' || intent === 'ESCALATION_DRAFT') {
    const issueNumber = extractIssueNumber(message) || ai?.issueNumber || normalizeText(draft?.data?.issueNumber);
    if (!issueNumber) {
      return { intent, done: false, reply: 'Which issue should I draft this for? Please share the issue number.', draft: { intent, data: {} } };
    }
    if (intent === 'ESCALATION_DRAFT' && !['agent', 'agent_user', 'agent_manager', 'superadmin'].includes(user.role)) {
      const error = new Error('Only internal users can generate escalation drafts.');
      error.status = 403;
      throw error;
    }
    const issue = await getIssueStatusFromAssistant({ tenant, user, issueNumber });
    const comments = await IssueComment.find({ tenantId: tenant._id, issueId: issue._id })
      .sort({ createdAt: -1 })
      .limit(8)
      .populate('authorUserId', 'name email role')
      .lean();
    const mode = intent === 'CUSTOMER_UPDATE_DRAFT' ? 'customer_update' : 'escalation';
    const aiReply = await generateIssueNarrative({ mode, issue, comments, user });
    const fallback = intent === 'CUSTOMER_UPDATE_DRAFT'
      ? `Customer-ready update for ${issue.issueNumber}: We are currently tracking this issue as ${getCustomerFacingStatus(issue)}. The team is reviewing the latest details and will update you as soon as there is meaningful progress.`
      : `Escalation draft for ${issue.issueNumber}: ${issue.title}\nStatus: ${issue.status}\nSeverity: ${issue.priority || 'Not set'}\nSLA: response ${issue.sla?.responseStatus || 'NO_SLA'}, resolution ${issue.sla?.resolutionStatus || 'NO_SLA'}\nRequested action: Please review ownership, blocker, and next step.`;
    return { intent, done: true, reply: aiReply || fallback, issue: sanitizeResponseIssue(issue, user), draft: null, aiEnabled: isOpenAiEnabled() };
  }

  if (intent === 'EXPLAIN_SLA') {
    const issueNumber = extractIssueNumber(message) || normalizeText(draft?.data?.issueNumber);
    if (!issueNumber) {
      return { intent, done: false, reply: 'Which issue should I explain the SLA for? Please share the issue number.', draft: { intent: 'EXPLAIN_SLA', data: {} } };
    }
    const issue = await getIssueStatusFromAssistant({ tenant, user, issueNumber });
    return {
      intent,
      done: true,
      reply: explainSlaForIssue(issue, user),
      issue: sanitizeResponseIssue(issue, user),
      draft: null
    };
  }

  if (intent === 'SUMMARIZE_ISSUE') {
    const issueNumber = extractIssueNumber(message) || normalizeText(draft?.data?.issueNumber);
    if (!issueNumber) {
      return { intent, done: false, reply: 'Which issue should I summarize? Please share the issue number.', draft: { intent: 'SUMMARIZE_ISSUE', data: {} } };
    }
    const result = await summarizeIssueForAssistant({ tenant, user, issueNumber });
    return {
      intent,
      done: true,
      reply: result.reply,
      issue: sanitizeResponseIssue(result.issue, user),
      draft: null
    };
  }

  if (intent === 'REPORT_ANSWER') {
    const countLike = isIssueCountQuestion(message) || /\b(how many|count|number of|total)\b/i.test(message);
    const result = await listIssuesFromAssistant({ tenant, user, message, includeIssues: !countLike });
    const deterministicReply = countLike ? buildIssueCountReply(result, user, message) : buildIssueListReply(result, user, message);
    const aiReply = countLike ? '' : await generateReportAnswer({ question: message, issues: result.issues, total: result.total, user });
    return {
      intent,
      done: true,
      reply: aiReply || deterministicReply,
      issues: countLike ? [] : result.issues.map((issue) => sanitizeResponseIssue(issue, user)),
      total: result.total,
      draft: null,
      context: buildIssueQueryContext({ sourceMessage: message, effectiveMessage: message, responseMode: countLike ? 'count' : 'list', result }),
      aiEnabled: isOpenAiEnabled() && !countLike
    };
  }

  if (intent === 'LIST_ISSUES') {
    const countLike = isIssueCountQuestion(message);
    const result = await listIssuesFromAssistant({ tenant, user, message, includeIssues: !countLike });
    return {
      intent,
      done: true,
      reply: countLike ? buildIssueCountReply(result, user, message) : buildIssueListReply(result, user, message),
      issues: countLike ? [] : result.issues.map((issue) => sanitizeResponseIssue(issue, user)),
      total: result.total,
      draft: null,
      context: buildIssueQueryContext({ sourceMessage: message, effectiveMessage: message, responseMode: countLike ? 'count' : 'list', result })
    };
  }

  if (intent === 'GET_ISSUE_STATUS') {
    const issueNumber = extractIssueNumber(message) || normalizeText(draft?.data?.issueNumber);
    if (!issueNumber) {
      return {
        intent,
        done: false,
        reply: 'Please share the issue number, for example ABCD-1001.',
        draft: { intent: 'GET_ISSUE_STATUS', data: {} }
      };
    }
    const issue = await getIssueStatusFromAssistant({ tenant, user, issueNumber });
    return {
      intent,
      done: true,
      reply: buildStatusReply(issue, user),
      issue: sanitizeResponseIssue(issue, user),
      draft: null
    };
  }

  if (intent === 'CREATE_ISSUE') {
    let data = mergeDraftWithMessage({ message, draft, tenant, accessibleEntities });
    data = mergeAiFieldsIntoCreateData(data, ai);
    if (data.cancelled) {
      return { intent, done: false, reply: 'Okay, I cancelled the issue creation draft.', draft: null };
    }
    const entityResolution = await resolveEntityFromHint({ user, entityHint: data.entityHint, entityId: data.entityId });
    const missing = missingFieldsForCreate(data, entityResolution);
    if (missing.length) {
      return {
        intent,
        done: false,
        reply: buildMissingFieldPrompt(missing, entityResolution),
        missingFields: missing,
        entityOptions: (entityResolution.entities || accessibleEntities).slice(0, 8).map((entity) => ({ id: String(entity._id), name: entity.name, path: entity.path, acronym: entity.acronym })),
        draft: { intent: 'CREATE_ISSUE', data }
      };
    }

    if (needsSchemaQuestion(data, tenant)) {
      data.entityId = String(entityResolution.entity._id);
      data.entityHint = entityResolution.entity.acronym || entityResolution.entity.name;
      const schemaQuestion = buildSchemaQuestion(data, tenant);
      data.suggestedSchema = schemaQuestion.suggested;
      data.awaitingSchemaSelection = true;
      data.awaitingConfirmation = false;
      return {
        intent,
        done: false,
        reply: schemaQuestion.reply,
        draft: { intent: 'CREATE_ISSUE', data }
      };
    }

    if (!data.confirmed) {
      data.entityId = String(entityResolution.entity._id);
      data.entityHint = entityResolution.entity.acronym || entityResolution.entity.name;
      data.priority = data.priority || data.suggestedSchema?.priority || inferPriorityFromText(data.rawMessage || '', getTenantIssueConfig(tenant).priorities) || 'MEDIUM';
      data.category = data.category || data.suggestedSchema?.category || inferCategoryFromText(data.rawMessage || '', getTenantIssueConfig(tenant).categories) || 'General';
      data.requestType = data.requestType || data.suggestedSchema?.requestType || extractRequestType(data.rawMessage || '') || 'BUG';
      data.awaitingConfirmation = true;
      data.awaitingSchemaSelection = false;
      return {
        intent,
        done: false,
        reply: buildCreateConfirmation(data, entityResolution.entity),
        draft: { intent: 'CREATE_ISSUE', data }
      };
    }

    data.entityId = String(entityResolution.entity._id);
    const issue = await createIssueFromAssistant({ tenant, user, data });
    const item = sanitizeResponseIssue(issue, user);
    return {
      intent,
      done: true,
      reply: `Created ${item.issueNumber} for ${item.entityName || item.entityPath}. Status: ${item.status}.`,
      issue: item,
      draft: null
    };
  }

  const knowledgeAnswer = await answerFromKnowledge({ tenant, user, message, accessibleEntities });
  if (knowledgeAnswer) return knowledgeAnswer;

  return {
    intent: 'UNKNOWN',
    done: false,
    reply: `I can help you raise an issue, get/search issues, answer from uploaded AI knowledge, count users, scan operational risks, add comments, change status, assign issues, push to Jira, summarize issues, explain SLA, or draft customer updates, escalation notes, report answers, or smart issue creation. Try: “Show my open issues”, “What does the uploaded issue database say about payment failures?”, “Show S1 open issues”, “Add comments to ABCD-1001 saying logs uploaded”, “Push ABCD-1001 to Jira”, “Why is ABCD-1001 breached?”, “Summarize ABCD-1001”, “Draft a customer update for ABCD-1001”, “Give issue report by severity”, or “Create issue for Client A: payment timeout affecting all users, severity high”.

Your current role is ${roleLabel(user.role)}, and I will only use your permitted scope.`,
    draft: null
  };
}
module.exports = {
  handleAssistant,
  extractIssueNumber,
  sanitizeResponseIssue,
  listIssuesFromAssistant
};
