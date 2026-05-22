const AGENT_ASSIGNABLE_ROLES = ['agent', 'agent_user'];
const INTERNAL_WORK_ROLES = ['agent', 'agent_user', 'agent_manager', 'support_head', 'superadmin'];
const STATUS_CHANGE_ROLES = ['client', 'agent', 'agent_user', 'agent_manager', 'support_head', 'superadmin'];
const VIEW_ONLY_ROLES = ['engagement_manager', 'regional_head'];

function normalizeRole(input = '') {
  if (input && typeof input === 'object' && input.role) return String(input.role);
  return String(input || '');
}

function isLegacyAgent(role = '') { return normalizeRole(role) === 'agent'; }
function isAgentUser(role = '') { return ['agent', 'agent_user'].includes(normalizeRole(role)); }
function isAgentManager(role = '') { return ['agent_manager', 'support_head'].includes(normalizeRole(role)); }
function isSupportHead(role = '') { return normalizeRole(role) === 'support_head'; }
function isRegionalHead(role = '') { return normalizeRole(role) === 'regional_head'; }
function isInternalAgent(role = '') { return INTERNAL_WORK_ROLES.includes(normalizeRole(role)); }
function isClientUser(role = '') { return normalizeRole(role) === 'client'; }
function isEngagementManager(role = '') { return normalizeRole(role) === 'engagement_manager'; }
function canAssign(role = '') { return ['agent_manager', 'support_head', 'superadmin'].includes(normalizeRole(role)); }
function canTakeOwnership(role = '') { return ['agent', 'agent_user', 'agent_manager', 'support_head', 'superadmin'].includes(normalizeRole(role)); }
function canTriage(role = '') { return ['agent', 'agent_user', 'agent_manager', 'support_head', 'superadmin'].includes(normalizeRole(role)); }
function canCreateIssue(role = '') { return ['superadmin', 'client', 'agent', 'agent_user', 'agent_manager', 'support_head'].includes(normalizeRole(role)); }
function roleLabel(role = '') {
  const key = normalizeRole(role);
  return {
    superadmin: 'Superadmin',
    agent: 'Agent User',
    agent_user: 'Agent User',
    agent_manager: 'Agent Manager',
    client: 'Client User',
    engagement_manager: 'Engagement Manager',
    regional_head: 'Regional Head',
    support_head: 'Support Head'
  }[key] || key;
}

module.exports = {
  AGENT_ASSIGNABLE_ROLES,
  INTERNAL_WORK_ROLES,
  STATUS_CHANGE_ROLES,
  VIEW_ONLY_ROLES,
  isLegacyAgent,
  isAgentUser,
  isAgentManager,
  isInternalAgent,
  isClientUser,
  isEngagementManager,
  isRegionalHead,
  isSupportHead,
  canAssign,
  canTakeOwnership,
  canTriage,
  canCreateIssue,
  roleLabel
};
