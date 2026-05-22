const https = require('https');

function normalizeText(value = '') {
  return String(value || '').trim();
}

function isOpenAiEnabled() {
  return Boolean(normalizeText(process.env.OPENAI_API_KEY));
}

function getOpenAiModel() {
  return normalizeText(process.env.OPENAI_MODEL) || 'gpt-4o-mini';
}

function safeJsonParse(text = '') {
  try {
    return JSON.parse(text);
  } catch (_) {
    const match = String(text || '').match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]); } catch (__) { return null; }
  }
}

function callOpenAiChat({ messages, temperature = 0.2, responseFormat = null, maxTokens = 700 }) {
  if (!isOpenAiEnabled()) return Promise.resolve(null);
  const payload = JSON.stringify({
    model: getOpenAiModel(),
    messages,
    temperature,
    max_tokens: maxTokens,
    ...(responseFormat ? { response_format: responseFormat } : {})
  });

  const timeoutMs = Math.max(1500, Number(process.env.OPENAI_TIMEOUT_MS || 8000));
  return new Promise((resolve) => {
    const req = https.request({
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      timeout: timeoutMs,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return resolve(null);
        const parsed = safeJsonParse(body);
        return resolve(parsed?.choices?.[0]?.message?.content || null);
      });
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.write(payload);
    req.end();
  });
}

async function extractAssistantIntentWithOpenAi({ message, heuristicIntent, tenantConfig = {}, accessibleEntities = [] }) {
  if (!isOpenAiEnabled()) return null;
  const entityHints = accessibleEntities.slice(0, 30).map((entity) => ({
    id: String(entity._id || ''),
    name: entity.name || '',
    acronym: entity.acronym || '',
    path: entity.path || ''
  }));
  const content = await callOpenAiChat({
    responseFormat: { type: 'json_object' },
    maxTokens: 500,
    messages: [
      { role: 'system', content: 'You classify service-desk assistant messages. Return only compact JSON. Never invent issue numbers or entity ids. Treat phrases like raise/create/open/log a new issue as intent only, not as title or description. Do not say enough details are present unless the user has supplied a real business/technical problem or request with meaningful detail.' },
      { role: 'user', content: JSON.stringify({
        message,
        heuristicIntent,
        allowedIntents: ['CREATE_ISSUE','GET_ISSUE_STATUS','LIST_ISSUES','ADD_COMMENT','CHANGE_STATUS','ASSIGN_ISSUE','PUSH_TO_JIRA','EXPLAIN_SLA','SUMMARIZE_ISSUE','CUSTOMER_UPDATE_DRAFT','ESCALATION_DRAFT','REPORT_ANSWER','UNKNOWN'],
        tenantConfig,
        accessibleEntities: entityHints,
        expectedShape: { intent: 'one allowed intent', confidence: 0.0, issueNumber: '', fields: { title: 'empty unless a real issue title is present', description: 'empty unless real issue/request details are present', priority: '', category: '', requestType: '', product: '', entityHint: '', entityId: '', status: '', assigneeHint: '', commentText: '' } }
      }) }
    ]
  });
  const parsed = safeJsonParse(content);
  if (!parsed || !parsed.intent) return null;
  return parsed;
}

function buildIssueContext(issue, comments = [], user = {}) {
  const visibleComments = user.role === 'client' ? comments.filter((comment) => comment.visibility !== 'INTERNAL') : comments;
  return {
    issueNumber: issue.issueNumber,
    title: issue.title,
    description: issue.description,
    status: issue.status,
    priority: issue.priority,
    category: issue.category,
    product: issue.product,
    entity: issue.entityId?.path || issue.entityId?.name || issue.entitySnapshot?.path || '',
    assignee: issue.assignedToUserId?.name || issue.assigneeSnapshot?.name || '',
    jira: issue.jira ? { issueKey: issue.jira.issueKey || '', status: issue.jira.currentStatusName || '', pushStatus: issue.jira.pushStatus || '' } : {},
    sla: issue.sla || {},
    comments: visibleComments.slice(0, 8).map((comment) => ({
      at: comment.createdAt,
      by: comment.authorUserId?.name || comment.authorUserId?.email || comment.authorRole || 'User',
      visibility: comment.visibility || 'EXTERNAL',
      text: comment.commentText || ''
    }))
  };
}

async function generateIssueNarrative({ mode, issue, comments, user }) {
  if (!isOpenAiEnabled()) return null;
  const instructions = {
    summary: 'Write a crisp internal issue summary with current state, likely blockers, SLA risk, and next action. Use only the provided facts.',
    customer_update: 'Draft a customer-ready update. Be transparent, calm, professional, and avoid internal-only details or blame. Do not promise dates unless present in facts.',
    escalation: 'Draft an internal escalation note for a support lead/manager. Include impact, age/SLA risk, owner, current blocker, Jira link/status if present, and requested action.'
  }[mode] || 'Summarize the issue using only provided facts.';
  return callOpenAiChat({
    temperature: 0.25,
    maxTokens: 650,
    messages: [
      { role: 'system', content: `${instructions} Keep it concise. Do not make up facts.` },
      { role: 'user', content: JSON.stringify(buildIssueContext(issue, comments, user)) }
    ]
  });
}

async function generateReportAnswer({ question, issues, total, user }) {
  if (!isOpenAiEnabled()) return null;
  const issueRows = issues.slice(0, 80).map((issue) => ({
    issueNumber: issue.issueNumber,
    title: issue.title,
    status: issue.status,
    customerStatus: issue.customerStatus,
    priority: issue.priority,
    category: issue.category,
    product: issue.product,
    entity: issue.entityId?.path || issue.entityId?.name || '',
    assignee: issue.assignedToUserId?.name || '',
    createdAt: issue.createdAt,
    updatedAt: issue.updatedAt,
    responseSla: issue.sla?.responseStatus || 'NO_SLA',
    resolutionSla: issue.sla?.resolutionStatus || 'NO_SLA'
  }));
  return callOpenAiChat({
    temperature: 0.2,
    maxTokens: 800,
    messages: [
      { role: 'system', content: 'Answer service-desk reporting questions from the supplied scoped issue rows only. Mention that the answer is based on the permitted scope. Include counts and practical observations.' },
      { role: 'user', content: JSON.stringify({ question, total, role: user.role, issues: issueRows }) }
    ]
  });
}

module.exports = {
  isOpenAiEnabled,
  extractAssistantIntentWithOpenAi,
  generateIssueNarrative,
  generateReportAnswer
};
