/**
 * Service Manager v23.1.1 seed catalogue.
 *
 * This file deliberately contains configuration data only. It does not connect
 * to MongoDB and it does not create an organization or client.
 */

export const DEFAULT_WORKSPACE = 'suntecgroup';

export const UAT_USERS = Object.freeze([
  {
    name: 'Karthik V J',
    email: 'karthikvj@suntecsbs.com',
    role: 'clientUser',
    supportLevels: ['L1'],
    includeChildren: true
  },
  {
    name: 'Deepesh C',
    email: 'deepeshc@suntecgroup.com',
    role: 'agentManager',
    supportLevels: ['L1', 'L2', 'L3'],
    includeChildren: true
  },
  {
    name: 'Jisha S',
    email: 'jisha@suntecgroup.com',
    role: 'agentManager',
    supportLevels: ['L1', 'L2', 'L3'],
    includeChildren: true
  },
  {
    name: 'Nisha Rathinamani',
    email: 'nishar@suntecgroup.com',
    role: 'agentUser',
    supportLevels: ['L3'],
    includeChildren: true
  },
  {
    name: 'Anitha K P',
    email: 'anithakp@suntecgroup.com',
    role: 'agentUser',
    supportLevels: ['L3'],
    includeChildren: true
  },
  {
    name: 'Subramoni A',
    email: 'subramonia@suntecgroup.com',
    role: 'agentUser',
    supportLevels: ['L3'],
    includeChildren: true
  },
  {
    name: 'Rajani Ramakrishnan',
    email: 'rajanir@suntecsbs.com',
    role: 'partnerUser',
    supportLevels: ['L2'],
    includeChildren: true
  },
  {
    name: 'Rajani Ramakrishnan',
    email: 'rajanir@suntecgroup.com',
    role: 'agentUser',
    supportLevels: ['L3'],
    includeChildren: true
  },
  {
    name: 'Sudheer Padiyar',
    email: 'padiyars@suntecgroup.com',
    role: 'engagementManager',
    supportLevels: ['L1', 'L2', 'L3'],
    includeChildren: true
  },
  {
    name: 'Madhu M',
    email: 'madhu@suntecgroup.com',
    role: 'engagementManager',
    supportLevels: ['L1', 'L2', 'L3'],
    includeChildren: true
  }
]);

export const REQUEST_TAXONOMY = Object.freeze({
  family: {
    name: 'Request',
    key: 'REQUEST',
    icon: '◇',
    description: 'Primary request family for service management requests.',
    displayOrder: 10
  },
  issueTypes: [
    {
      name: 'Incident',
      key: 'INCIDENT',
      description: 'Unplanned interruption, degradation, security event, infrastructure event, or operational incident.',
      displayOrder: 10,
      subtypes: [
        ['Application', 'APPLICATION', 'Application or product behaviour incident.'],
        ['Security', 'SECURITY', 'Security-related incident or suspected security event.'],
        ['Infrastructure', 'INFRASTRUCTURE', 'Infrastructure, platform, network, database, or hosting incident.'],
        ['Operational', 'OPERATIONAL', 'Operational process, deployment, monitoring, email, tooling, or DR incident.']
      ]
    },
    {
      name: 'Service Request',
      key: 'SERVICE_REQUEST',
      description: 'Standard request for access, configuration, operational assistance, data handling, or service fulfilment.',
      displayOrder: 20,
      subtypes: [
        ['Application User Access', 'APPLICATION_USER_ACCESS', 'Application user access request.'],
        ['AWS User Access', 'AWS_USER_ACCESS', 'AWS user access request.'],
        ['Bastion Host Access', 'BASTION_HOST_ACCESS', 'Bastion host access request.'],
        ['Jenkins Access', 'JENKINS_ACCESS', 'Jenkins access request.'],
        ['Email Access', 'EMAIL_ACCESS', 'Email access or mailbox-related request.'],
        ['JIRA Access', 'JIRA_ACCESS', 'JIRA access request.'],
        ['Federated Access', 'FEDERATED_ACCESS', 'Federated access request.'],
        ['Privileged Access', 'PRIVILEGED_ACCESS', 'Privileged or elevated access request.'],
        ['Business Configuration', 'BUSINESS_CONFIGURATION', 'Business configuration request.'],
        ['Dynamic Reports', 'DYNAMIC_REPORTS', 'Dynamic report creation or modification request.'],
        ['DB Data through CICD Pipeline', 'DB_DATA_CICD', 'Database data request executed through the CICD pipeline.'],
        ['DR Drill / BCP', 'DR_DRILL_BCP', 'Disaster recovery drill or business continuity request.'],
        ['Adhoc AWS Environment Start / Stop', 'ADHOC_AWS_ENV_START_STOP', 'Adhoc AWS environment start or stop request.'],
        ['Log Level Change to Debug Mode', 'LOG_LEVEL_DEBUG', 'Temporary log-level change request.'],
        ['Firewall Rule Changes', 'FIREWALL_RULE_CHANGES', 'Firewall rule change request.'],
        ['File Transfer from AWS Environment', 'AWS_FILE_TRANSFER', 'File transfer from an AWS environment to an approved destination.'],
        ['Infrastructure Configuration Changes', 'INFRA_CONFIGURATION_CHANGES', 'Infrastructure configuration change request.'],
        ['Application Container Image Deletion', 'APP_CONTAINER_IMAGE_DELETE', 'Application container image deletion request.'],
        ['RDS Snapshot Changes', 'RDS_SNAPSHOT_CHANGES', 'RDS snapshot creation, retention, restore, or related change request.']
      ]
    },
    {
      name: 'Maintenance Request',
      key: 'MAINTENANCE_REQUEST',
      description: 'Planned, proactive, emergency, security-assurance, or disaster-recovery maintenance activity.',
      displayOrder: 30,
      subtypes: [
        ['Scheduled Maintenance', 'SCHEDULED_MAINTENANCE', 'Planned maintenance within an agreed window.'],
        ['Proactive Maintenance', 'PROACTIVE_MAINTENANCE', 'Proactive maintenance intended to prevent service degradation.'],
        ['Emergency Maintenance', 'EMERGENCY_MAINTENANCE', 'Urgent maintenance required to protect or restore service.'],
        ['Vulnerability Run', 'VULNERABILITY_RUN', 'Vulnerability assessment or remediation activity.'],
        ['Penetration Test Run', 'PENETRATION_TEST_RUN', 'Penetration-test execution or support activity.'],
        ['Actual DR', 'ACTUAL_DR', 'Actual disaster-recovery invocation or maintenance activity.']
      ]
    },
    {
      name: 'Problem',
      key: 'PROBLEM',
      description: 'Problem-management request for identifying and permanently resolving the cause of one or more incidents.',
      displayOrder: 40,
      subtypes: [
        ['General Problem', 'GENERAL_PROBLEM', 'General problem-management record.']
      ]
    },
    {
      name: 'Change Request',
      key: 'CHANGE_REQUEST',
      description: 'Controlled request to change an application, infrastructure, security, operational, or tooling component.',
      displayOrder: 50,
      subtypes: [
        ['Application', 'APPLICATION', 'Application change request.'],
        ['Infrastructure', 'INFRASTRUCTURE', 'Infrastructure change request.'],
        ['Security', 'SECURITY', 'Security change request.'],
        ['Operational', 'OPERATIONAL', 'Operational process or configuration change request.'],
        ['Tools', 'TOOLS', 'Tooling or platform-tool change request.']
      ]
    },
    {
      name: 'Query',
      key: 'QUERY',
      description: 'Question, information request, or assistance request that does not require incident handling.',
      displayOrder: 60,
      subtypes: [
        ['General Query', 'GENERAL_QUERY', 'General service or support query.'],
        ['Information Request', 'INFORMATION_REQUEST', 'Request for information, clarification, or documentation.'],
        ['Assistance Request', 'ASSISTANCE_REQUEST', 'Request for operational or technical assistance.']
      ]
    }
  ]
});

export function taxonomyCounts() {
  return {
    families: 1,
    issueTypes: REQUEST_TAXONOMY.issueTypes.length,
    subtypes: REQUEST_TAXONOMY.issueTypes.reduce((sum, item) => sum + item.subtypes.length, 0)
  };
}

export function validateSeedCatalogue() {
  const errors = [];
  const allowedRoles = new Set(['clientUser', 'partnerUser', 'agentUser', 'agentManager', 'engagementManager']);
  const allowedLevels = new Set(['L1', 'L2', 'L3']);

  const emails = new Set();
  for (const user of UAT_USERS) {
    const email = String(user.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) errors.push(`Invalid user email: ${user.name}`);
    if (emails.has(email)) errors.push(`Duplicate user email: ${email}`);
    emails.add(email);
    if (!allowedRoles.has(user.role)) errors.push(`Invalid user role: ${user.role}`);
    if (!Array.isArray(user.supportLevels) || !user.supportLevels.length || user.supportLevels.some((level) => !allowedLevels.has(level))) {
      errors.push(`Invalid support levels for ${email}`);
    }
  }

  const issueKeys = new Set();
  for (const issueType of REQUEST_TAXONOMY.issueTypes) {
    if (issueKeys.has(issueType.key)) errors.push(`Duplicate Issue Type key: ${issueType.key}`);
    issueKeys.add(issueType.key);
    const subtypeKeys = new Set();
    for (const [, key] of issueType.subtypes) {
      if (subtypeKeys.has(key)) errors.push(`Duplicate subtype key below ${issueType.key}: ${key}`);
      subtypeKeys.add(key);
    }
  }

  return { ok: errors.length === 0, errors, counts: taxonomyCounts() };
}
