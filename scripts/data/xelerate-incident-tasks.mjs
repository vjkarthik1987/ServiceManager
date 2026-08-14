function task(localId, title, description, ownerSide, queue, isBlocking, visibility, displayOrder) {
  return { localId, title, description, ownerSide, queue, isBlocking, visibility, displayOrder };
}

function status(name, tasks) {
  return { name, tasks };
}

function pauseStatuses(prefix, ownerSide, queue, visibility) {
  return [
    status('On Hold', [
      task(`${prefix}_hold_reason`, 'Record hold reason', 'Record why work is on hold, what is awaited, the responsible owner, and the expected resume date.', ownerSide, queue, false, visibility, 10)
    ]),
    status('Under Monitoring', [
      task(`${prefix}_monitor_condition`, 'Monitor incident condition', 'Monitor the affected service for recurrence and record the observation result before leaving monitoring.', ownerSide, queue, true, visibility, 10)
    ]),
    status('Deferred', [
      task(`${prefix}_defer_details`, 'Record deferral justification', 'Record the deferral justification, review date, dependency, and accountable owner.', ownerSide, queue, false, visibility, 10)
    ])
  ];
}

function closureStatuses(prefix, workOwner, workQueue, finalOwner = workOwner, finalQueue = workQueue) {
  return [
    status('Resolved', [
      task(`${prefix}_resolution_summary`, 'Record final resolution', 'Document the final resolution, affected environment, evidence, and the date from which service was stable.', workOwner, workQueue, true, 'client_visible', 10),
      task(`${prefix}_complete_rca`, 'Complete RCA details', 'Record root cause, RCA category, corrective action, preventive action, and RCA status. RCA details must be suitable for customer visibility.', workOwner, workQueue, true, 'client_visible', 20),
      task(`${prefix}_closure_readiness`, 'Confirm closure readiness', 'Confirm that verification is complete, required evidence is available, and no operational action remains open.', workOwner, workQueue, true, 'client_visible', 30)
    ]),
    status('Pending Closure Approval', [
      task(`${prefix}_closure_approval`, 'Review and approve closure', 'Review the resolution, production verification, RCA, and open actions. Approve closure or return the incident for additional work.', 'suntec', 'SunTec Global Support', true, 'internal_only', 10)
    ]),
    status('Approved to Close', [
      task(`${prefix}_final_close`, 'Complete final closure', 'Record the final closure comment and close the incident after approval.', finalOwner, finalQueue, true, 'client_visible', 10)
    ])
  ];
}

const applicationL1 = {
  workflow: 'Application Incident – L1 Bank',
  statuses: [
    status('Assigned', [
      task('xw_app_l1_accept', 'Accept L1 ownership', 'Confirm that the Bank team has taken ownership of the incident for initial analysis.', 'client', 'Bank Service Desk', true, 'client_visible', 10),
      task('xw_app_l1_validate', 'Validate incident information', 'Confirm the incident subtype, environment, severity, description, and available evidence.', 'client', 'Bank Service Desk', true, 'client_visible', 20)
    ]),
    status('Analysis', [
      task('xw_app_l1_analyse', 'Perform Bank-side analysis', 'Check user access, password, Bank-managed configuration, and other causes that can be investigated by the Bank.', 'client', 'Bank Service Desk', true, 'client_visible', 10),
      task('xw_app_l1_findings', 'Record L1 analysis findings', 'Document checks performed, findings, evidence, and any customer-side dependencies.', 'client', 'Bank Service Desk', true, 'client_visible', 20),
      task('xw_app_l1_decide', 'Decide resolution or escalation', 'Confirm whether the Bank can resolve the incident or whether it must move to Partner L2 support.', 'client', 'Bank Service Desk', true, 'client_visible', 30)
    ]),
    status('Resolution', [
      task('xw_app_l1_apply', 'Apply L1 resolution', 'Apply the Bank-side correction or action identified during analysis.', 'client', 'Bank Service Desk', true, 'client_visible', 10),
      task('xw_app_l1_verify', 'Verify L1 resolution', 'Confirm that the issue is resolved in the environment where it was reported.', 'client', 'Bank Service Desk', true, 'client_visible', 20)
    ]),
    ...pauseStatuses('xw_app_l1', 'client', 'Bank Service Desk', 'client_visible'),
    status('Resolved', [
      task('xw_app_l1_res_details', 'Confirm resolution details', 'Confirm the final Bank-side action and evidence that the incident has been resolved.', 'client', 'Bank Service Desk', true, 'client_visible', 10),
      task('xw_app_l1_close_ready', 'Confirm readiness for closure', 'Confirm that no further L1 action is required and that the incident may be closed.', 'client', 'Bank Service Desk', true, 'client_visible', 20)
    ])
  ]
};

const applicationL2 = {
  workflow: 'Application Incident – L2 Partner',
  statuses: [
    status('Assigned', [
      task('xw_app_l2_accept', 'Accept L2 ownership', 'Confirm Partner ownership and identify the Partner engineer responsible for the incident.', 'partner', 'Partner L2 Support', true, 'partner_visible', 10),
      task('xw_app_l2_handover', 'Validate L1 handover', 'Review the L1 findings, severity, environment, evidence, and customer impact before analysis begins.', 'partner', 'Partner L2 Support', true, 'client_visible', 20)
    ]),
    status('Analysis', [
      task('xw_app_l2_analyse', 'Perform Partner analysis', 'Investigate configuration, data, process, component restart, and other Partner-manageable causes.', 'partner', 'Partner L2 Support', true, 'partner_visible', 10),
      task('xw_app_l2_findings', 'Record L2 analysis findings', 'Document checks, findings, evidence, likely cause, and the current customer impact.', 'partner', 'Partner L2 Support', true, 'client_visible', 20),
      task('xw_app_l2_decide', 'Decide Partner resolution or L3 escalation', 'Confirm whether Partner can resolve the incident or whether SunTec L3 support is required.', 'partner', 'Partner L2 Support', true, 'partner_visible', 30)
    ]),
    status('Resolution', [
      task('xw_app_l2_apply', 'Apply Partner resolution', 'Apply the approved Partner-side configuration correction, data correction, restart, or other resolution.', 'partner', 'Partner L2 Support', true, 'partner_visible', 10),
      task('xw_app_l2_verify', 'Verify Partner resolution', 'Verify the result in the relevant environment and record evidence.', 'partner', 'Partner L2 Support', true, 'client_visible', 20),
      task('xw_app_l2_update', 'Prepare customer progress update', 'Provide a clear customer-facing update covering progress, remaining risk, and the next expected action.', 'partner', 'Partner L2 Support', false, 'client_visible', 30)
    ]),
    ...pauseStatuses('xw_app_l2', 'partner', 'Partner L2 Support', 'partner_visible'),
    status('Bank to Verify', [
      task('xw_app_l2_verify_instr', 'Provide Bank verification instructions', 'Explain what the Bank must verify, in which environment, and the expected result.', 'partner', 'Partner L2 Support', false, 'client_visible', 10),
      task('xw_app_l2_verify_result', 'Record Bank verification outcome', 'Capture the Bank confirmation or rejection, including comments and evidence, before progressing the incident.', 'partner', 'Partner L2 Support', true, 'client_visible', 20)
    ]),
    ...closureStatuses('xw_app_l2', 'partner', 'Partner L2 Support', 'partner', 'Partner L2 Support')
  ]
};

const applicationL3 = {
  workflow: 'Application Incident – L3 SunTec',
  statuses: [
    status('Assigned', [
      task('xw_app_l3_accept', 'Accept L3 ownership', 'Confirm SunTec ownership and assign the appropriate product or engineering owner.', 'suntec', 'SunTec L3 Support', true, 'internal_only', 10),
      task('xw_app_l3_handover', 'Validate L2 technical handover', 'Review Partner findings, logs, links, reproduction information, severity, and production impact.', 'suntec', 'SunTec L3 Support', true, 'partner_visible', 20)
    ]),
    status('Analysis', [
      task('xw_app_l3_reproduce', 'Reproduce and analyse the incident', 'Reproduce the issue where possible and complete advanced product, data, component, and configuration analysis.', 'suntec', 'SunTec L3 Support', true, 'internal_only', 10),
      task('xw_app_l3_cause', 'Identify probable cause and resolution path', 'Document the probable cause and determine whether resolution needs configuration, data correction, restart, or code change.', 'suntec', 'SunTec L3 Support', true, 'partner_visible', 20),
      task('xw_app_l3_update', 'Prepare technical progress update', 'Prepare a customer-safe progress update with impact, actions taken, risk, and next milestone.', 'suntec', 'SunTec L3 Support', false, 'client_visible', 30)
    ]),
    status('Resolution', [
      task('xw_app_l3_apply', 'Apply technical resolution', 'Apply the approved configuration, data, restart, or technical resolution that does not require a software release.', 'suntec', 'SunTec L3 Support', true, 'internal_only', 10),
      task('xw_app_l3_res_verify', 'Verify technical resolution', 'Verify the resolution in the affected or agreed validation environment and record evidence.', 'suntec', 'SunTec L3 Support', true, 'client_visible', 20)
    ]),
    status('Development', [
      task('xw_app_l3_fix', 'Implement application fix', 'Implement the approved code or product fix and link the internal development work item.', 'suntec', 'Product Engineering', true, 'internal_only', 10),
      task('xw_app_l3_review', 'Complete peer review', 'Complete code review and address all review observations.', 'suntec', 'Product Engineering', true, 'internal_only', 20),
      task('xw_app_l3_tests', 'Add or update automated tests', 'Add or update relevant automated tests and record the execution result.', 'suntec', 'Product Engineering', true, 'internal_only', 30)
    ]),
    status('Testing', [
      task('xw_app_l3_test', 'Complete solution testing', 'Test the fix in the required internal and SaaS validation environments and record results.', 'suntec', 'Solution Testing', true, 'internal_only', 10),
      task('xw_app_l3_regression', 'Complete regression assessment', 'Confirm the affected regression scope and record evidence that critical flows remain stable.', 'suntec', 'Solution Testing', true, 'partner_visible', 20)
    ]),
    status('Release', [
      task('xw_app_l3_release_id', 'Confirm release details', 'Record release ID, release type, package details, and the approved deployment sequence.', 'suntec', 'Release Management', true, 'partner_visible', 10),
      task('xw_app_l3_release_approval', 'Obtain deployment approval', 'Obtain required approval before applying the fix to each controlled client environment.', 'suntec', 'Release Management', true, 'internal_only', 20),
      task('xw_app_l3_release_notes', 'Prepare customer release note', 'Prepare a customer-safe release note containing impact, deployment instructions, validation steps, and rollback guidance.', 'suntec', 'Release Management', false, 'client_visible', 30)
    ]),
    status('Deployed to Production', [
      task('xw_app_l3_prod_verify', 'Verify production deployment', 'Confirm successful deployment, service availability, and expected application behaviour in Production.', 'suntec', 'SunTec L3 Support', true, 'client_visible', 10),
      task('xw_app_l3_rollback', 'Confirm rollback readiness or closure', 'Confirm that rollback was not required, or record the rollback outcome and next action.', 'suntec', 'Release Management', true, 'partner_visible', 20)
    ]),
    status('Bank to Verify', [
      task('xw_app_l3_bank_instr', 'Provide Bank verification instructions', 'Explain the production or affected-environment verification expected from the Bank.', 'suntec', 'SunTec L3 Support', false, 'client_visible', 10),
      task('xw_app_l3_bank_result', 'Record Bank verification outcome', 'Capture the Bank confirmation or rejection, evidence, and any remaining issue.', 'suntec', 'SunTec L3 Support', true, 'client_visible', 20)
    ]),
    ...pauseStatuses('xw_app_l3', 'suntec', 'SunTec L3 Support', 'partner_visible'),
    ...closureStatuses('xw_app_l3', 'suntec', 'SunTec L3 Support', 'suntec', 'SunTec L3 Support')
  ]
};

function securityL2() {
  return {
    workflow: 'Security Incident – L2 Partner',
    statuses: [
      status('Assigned', [
        task('xw_sec_l2_accept', 'Accept security incident ownership', 'Confirm Partner security ownership and nominate the incident responder.', 'partner', 'Partner Security Operations', true, 'partner_visible', 10),
        task('xw_sec_l2_notify', 'Confirm initial customer notification', 'Confirm that the required initial security notification has been sent within the applicable reporting window.', 'partner', 'Partner Security Operations', true, 'client_visible', 20)
      ]),
      status('Analysis', [
        task('xw_sec_l2_assess', 'Assess security impact and scope', 'Assess affected assets, users, data, services, entry vector, severity, and current containment state.', 'partner', 'Partner Security Operations', true, 'internal_only', 10),
        task('xw_sec_l2_evidence', 'Preserve security evidence', 'Record evidence locations, timestamps, alerts, logs, indicators, and chain-of-custody considerations.', 'partner', 'Partner Security Operations', true, 'internal_only', 20),
        task('xw_sec_l2_decide', 'Decide containment, resolution, or L3 escalation', 'Confirm whether Partner can contain and resolve the incident or whether SunTec L3 is required.', 'partner', 'Partner Security Operations', true, 'partner_visible', 30)
      ]),
      status('Resolution', [
        task('xw_sec_l2_contain', 'Apply containment or remediation', 'Apply approved hardening, access, configuration, patch, or containment actions.', 'partner', 'Partner Security Operations', true, 'internal_only', 10),
        task('xw_sec_l2_update', 'Send security progress update', 'Provide a customer-safe update covering impact, containment, remaining risk, and next milestone.', 'partner', 'Partner Security Operations', false, 'client_visible', 20)
      ]),
      status('Testing', [
        task('xw_sec_l2_test', 'Verify security remediation', 'Verify that the vulnerability or security condition is remediated without creating service instability.', 'partner', 'Partner Security Operations', true, 'internal_only', 10)
      ]),
      status('Deployed to Production', [
        task('xw_sec_l2_prod', 'Confirm production remediation', 'Confirm the remediation is active in Production and monitoring shows no continuing security condition.', 'partner', 'Partner Security Operations', true, 'client_visible', 10)
      ]),
      ...pauseStatuses('xw_sec_l2', 'partner', 'Partner Security Operations', 'partner_visible'),
      ...closureStatuses('xw_sec_l2', 'partner', 'Partner Security Operations', 'partner', 'Partner Security Operations')
    ]
  };
}

function securityL3() {
  return {
    workflow: 'Security Incident – L3 SunTec',
    statuses: [
      status('Assigned', [
        task('xw_sec_l3_accept', 'Accept L3 security ownership', 'Confirm SunTec security ownership and assign application, infrastructure, or security specialists.', 'suntec', 'SunTec Security Response', true, 'internal_only', 10),
        task('xw_sec_l3_handover', 'Validate security handover', 'Review Partner evidence, containment, impact, severity, alerts, and customer commitments.', 'suntec', 'SunTec Security Response', true, 'partner_visible', 20)
      ]),
      status('Analysis', [
        task('xw_sec_l3_investigate', 'Complete advanced security investigation', 'Investigate root vector, affected components, indicators of compromise, data exposure, and persistence risk.', 'suntec', 'SunTec Security Response', true, 'internal_only', 10),
        task('xw_sec_l3_plan', 'Define remediation plan', 'Define containment, eradication, recovery, validation, communication, and release actions.', 'suntec', 'SunTec Security Response', true, 'internal_only', 20),
        task('xw_sec_l3_update', 'Prepare security customer update', 'Prepare a customer-safe update covering confirmed facts, impact, actions, remaining risk, and next milestone.', 'suntec', 'SunTec Security Response', false, 'client_visible', 30)
      ]),
      status('Resolution', [
        task('xw_sec_l3_remediate', 'Apply security remediation', 'Apply approved configuration, access, hardening, infrastructure, or application remediation.', 'suntec', 'SunTec Security Response', true, 'internal_only', 10)
      ]),
      status('Development', [
        task('xw_sec_l3_fix', 'Implement secure code fix', 'Implement the code remediation and link the internal secure-development work item.', 'suntec', 'Product Engineering', true, 'internal_only', 10),
        task('xw_sec_l3_review', 'Complete security code review', 'Complete peer and security review and address all identified findings.', 'suntec', 'Product Engineering', true, 'internal_only', 20)
      ]),
      status('Testing', [
        task('xw_sec_l3_test', 'Complete security validation', 'Validate remediation, negative test cases, regression scope, and security controls.', 'suntec', 'Solution Testing', true, 'internal_only', 10)
      ]),
      status('Release', [
        task('xw_sec_l3_release', 'Approve and prepare security release', 'Record release details, approvals, deployment sequence, validation steps, and rollback plan.', 'suntec', 'Release Management', true, 'internal_only', 10)
      ]),
      status('Deployed to Production', [
        task('xw_sec_l3_prod', 'Confirm production security remediation', 'Confirm successful deployment, service stability, monitoring, and absence of continuing indicators.', 'suntec', 'SunTec Security Response', true, 'client_visible', 10),
        task('xw_sec_l3_notify_resolved', 'Send resolution notification', 'Send the required customer notification that remediation has been applied and verified.', 'suntec', 'SunTec Security Response', true, 'client_visible', 20)
      ]),
      ...pauseStatuses('xw_sec_l3', 'suntec', 'SunTec Security Response', 'internal_only'),
      ...closureStatuses('xw_sec_l3', 'suntec', 'SunTec Security Response', 'suntec', 'SunTec Security Response')
    ]
  };
}

function operationalL2() {
  return {
    workflow: 'Operational Incident – L2 Partner',
    statuses: [
      status('Assigned', [
        task('xw_ops_l2_accept', 'Accept operational ownership', 'Confirm Partner ownership and assign the responsible operations engineer.', 'partner', 'Partner Operations', true, 'partner_visible', 10),
        task('xw_ops_l2_validate', 'Validate operational context', 'Confirm affected service, environment, severity, recent changes, schedule, and available evidence.', 'partner', 'Partner Operations', true, 'client_visible', 20)
      ]),
      status('Analysis', [
        task('xw_ops_l2_analyse', 'Perform operational analysis', 'Analyse batch, pipeline, patch, report, email, monitoring, access, or DR operating conditions.', 'partner', 'Partner Operations', true, 'partner_visible', 10),
        task('xw_ops_l2_decide', 'Decide operational resolution or L3 escalation', 'Confirm whether Partner can restore service or whether SunTec L3 support is required.', 'partner', 'Partner Operations', true, 'partner_visible', 20)
      ]),
      status('Resolution', [
        task('xw_ops_l2_restore', 'Apply operational resolution', 'Apply the approved configuration correction, restart, rerun, access correction, or operational restoration.', 'partner', 'Partner Operations', true, 'partner_visible', 10),
        task('xw_ops_l2_approval', 'Confirm environment-change approval', 'Confirm required approval before applying changes to controlled environments.', 'partner', 'Partner Operations', true, 'internal_only', 20)
      ]),
      status('Testing', [
        task('xw_ops_l2_test', 'Verify operational restoration', 'Verify the affected service or process in the relevant environment and record the result.', 'partner', 'Partner Operations', true, 'client_visible', 10)
      ]),
      status('Deployed to Production', [
        task('xw_ops_l2_prod', 'Confirm production operation', 'Confirm Production is stable and the affected operational service is functioning normally.', 'partner', 'Partner Operations', true, 'client_visible', 10)
      ]),
      ...pauseStatuses('xw_ops_l2', 'partner', 'Partner Operations', 'partner_visible'),
      ...closureStatuses('xw_ops_l2', 'partner', 'Partner Operations', 'partner', 'Partner Operations')
    ]
  };
}

function operationalL3() {
  return {
    workflow: 'Operational Incident – L3 SunTec',
    statuses: [
      status('Assigned', [
        task('xw_ops_l3_accept', 'Accept L3 operational ownership', 'Confirm SunTec ownership and assign the appropriate support, SaaS CoE, platform, or product team.', 'suntec', 'SunTec Operations Support', true, 'internal_only', 10),
        task('xw_ops_l3_handover', 'Validate operational handover', 'Review Partner findings, evidence, environment, impact, and restoration attempts.', 'suntec', 'SunTec Operations Support', true, 'partner_visible', 20)
      ]),
      status('Analysis', [
        task('xw_ops_l3_analyse', 'Complete advanced operational analysis', 'Analyse application, platform, pipeline, patch, monitoring, report, email, access, and DR dependencies.', 'suntec', 'SunTec Operations Support', true, 'internal_only', 10),
        task('xw_ops_l3_plan', 'Define restoration or fix plan', 'Define the restoration path and determine whether configuration, platform, code, testing, or release work is required.', 'suntec', 'SunTec Operations Support', true, 'partner_visible', 20)
      ]),
      status('Resolution', [
        task('xw_ops_l3_restore', 'Apply advanced operational resolution', 'Apply the approved operational, configuration, platform, or data resolution.', 'suntec', 'SunTec Operations Support', true, 'internal_only', 10)
      ]),
      status('Development', [
        task('xw_ops_l3_fix', 'Implement operational fix', 'Implement the required application, platform, automation, or tooling fix.', 'suntec', 'Product Engineering', true, 'internal_only', 10),
        task('xw_ops_l3_review', 'Complete implementation review', 'Complete peer review and confirm operational supportability of the change.', 'suntec', 'Product Engineering', true, 'internal_only', 20)
      ]),
      status('Testing', [
        task('xw_ops_l3_test', 'Complete operational testing', 'Test the fix in internal SaaS Stage and the agreed client validation environment.', 'suntec', 'Solution Testing', true, 'internal_only', 10)
      ]),
      status('Release', [
        task('xw_ops_l3_release', 'Prepare operational release', 'Record release details, approvals, environment sequence, validation steps, and rollback plan.', 'suntec', 'Release Management', true, 'partner_visible', 10)
      ]),
      status('Deployed to Production', [
        task('xw_ops_l3_prod', 'Confirm production restoration', 'Confirm deployment, service availability, operational stability, and successful production verification.', 'suntec', 'SunTec Operations Support', true, 'client_visible', 10)
      ]),
      ...pauseStatuses('xw_ops_l3', 'suntec', 'SunTec Operations Support', 'partner_visible'),
      ...closureStatuses('xw_ops_l3', 'suntec', 'SunTec Operations Support', 'suntec', 'SunTec Operations Support')
    ]
  };
}

function infrastructureL2() {
  return {
    workflow: 'Infrastructure Incident – L2 Partner',
    statuses: [
      status('Assigned', [
        task('xw_inf_l2_accept', 'Accept infrastructure ownership', 'Confirm Partner infrastructure ownership and assign the responsible engineer.', 'partner', 'Partner Infrastructure Operations', true, 'partner_visible', 10),
        task('xw_inf_l2_validate', 'Validate infrastructure context', 'Confirm affected service, topology, environment, severity, alerts, recent changes, and evidence.', 'partner', 'Partner Infrastructure Operations', true, 'client_visible', 20)
      ]),
      status('Analysis', [
        task('xw_inf_l2_diagnose', 'Diagnose infrastructure incident', 'Diagnose compute, network, firewall, database, EKS, RDS, Jenkins, bastion, monitoring, and connectivity conditions.', 'partner', 'Partner Infrastructure Operations', true, 'internal_only', 10),
        task('xw_inf_l2_decide', 'Decide restoration or L3 escalation', 'Confirm whether Partner can restore the service or whether SunTec or vendor support is required.', 'partner', 'Partner Infrastructure Operations', true, 'partner_visible', 20)
      ]),
      status('Resolution', [
        task('xw_inf_l2_restore', 'Apply infrastructure restoration', 'Apply approved restart, rollback, configuration correction, failover, patch correction, or service restoration.', 'partner', 'Partner Infrastructure Operations', true, 'internal_only', 10),
        task('xw_inf_l2_approval', 'Confirm environment-change approval', 'Confirm required approval before applying infrastructure changes in controlled environments.', 'partner', 'Partner Infrastructure Operations', true, 'internal_only', 20)
      ]),
      status('Testing', [
        task('xw_inf_l2_test', 'Verify infrastructure restoration', 'Verify connectivity, availability, health checks, monitoring, and dependent services.', 'partner', 'Partner Infrastructure Operations', true, 'client_visible', 10)
      ]),
      status('Deployed to Production', [
        task('xw_inf_l2_prod', 'Confirm production infrastructure stability', 'Confirm Production is stable and monitoring shows the affected infrastructure service is healthy.', 'partner', 'Partner Infrastructure Operations', true, 'client_visible', 10)
      ]),
      ...pauseStatuses('xw_inf_l2', 'partner', 'Partner Infrastructure Operations', 'partner_visible'),
      ...closureStatuses('xw_inf_l2', 'partner', 'Partner Infrastructure Operations', 'partner', 'Partner Infrastructure Operations')
    ]
  };
}

function infrastructureL3() {
  return {
    workflow: 'Infrastructure Incident – L3 SunTec',
    statuses: [
      status('Assigned', [
        task('xw_inf_l3_accept', 'Accept L3 infrastructure ownership', 'Confirm SunTec ownership and assign SaaS CoE, platform, network, database, or vendor coordination responsibility.', 'suntec', 'SunTec Infrastructure Support', true, 'internal_only', 10),
        task('xw_inf_l3_handover', 'Validate infrastructure handover', 'Review Partner diagnostics, alerts, topology, changes, restoration attempts, and customer impact.', 'suntec', 'SunTec Infrastructure Support', true, 'partner_visible', 20)
      ]),
      status('Analysis', [
        task('xw_inf_l3_diagnose', 'Complete advanced infrastructure diagnosis', 'Analyse cloud, compute, EKS, RDS, network, security appliances, connectivity, CI/CD, and monitoring dependencies.', 'suntec', 'SunTec Infrastructure Support', true, 'internal_only', 10),
        task('xw_inf_l3_plan', 'Define restoration and vendor plan', 'Define restoration, failover, patch, configuration, development, or vendor-support actions.', 'suntec', 'SunTec Infrastructure Support', true, 'partner_visible', 20)
      ]),
      status('Vendor Support', [
        task('xw_inf_l3_vendor_ticket', 'Raise and track vendor ticket', 'Raise the vendor support case, record case ID and priority, provide diagnostics, and track the next vendor commitment.', 'internal', 'Vendor Coordination', true, 'internal_only', 10),
        task('xw_inf_l3_vendor_update', 'Record vendor response', 'Record vendor findings, workaround, fix recommendation, and next action before leaving vendor support.', 'internal', 'Vendor Coordination', true, 'partner_visible', 20)
      ]),
      status('Resolution', [
        task('xw_inf_l3_restore', 'Apply advanced infrastructure resolution', 'Apply the approved infrastructure, cloud, network, database, platform, or vendor-recommended resolution.', 'suntec', 'SunTec Infrastructure Support', true, 'internal_only', 10)
      ]),
      status('Development', [
        task('xw_inf_l3_fix', 'Implement platform or automation fix', 'Implement any required platform, infrastructure-as-code, automation, or product correction.', 'suntec', 'Platform Engineering', true, 'internal_only', 10),
        task('xw_inf_l3_review', 'Complete platform change review', 'Complete peer review and confirm security, resilience, rollback, and supportability.', 'suntec', 'Platform Engineering', true, 'internal_only', 20)
      ]),
      status('Testing', [
        task('xw_inf_l3_test', 'Complete infrastructure validation', 'Validate availability, connectivity, performance, monitoring, resilience, and dependent application behaviour.', 'suntec', 'Solution Testing', true, 'internal_only', 10)
      ]),
      status('Release', [
        task('xw_inf_l3_release', 'Prepare infrastructure release', 'Record change details, approvals, environment sequence, validation, communication, and rollback plan.', 'suntec', 'Release Management', true, 'partner_visible', 10)
      ]),
      status('Deployed to Production', [
        task('xw_inf_l3_prod', 'Confirm production infrastructure restoration', 'Confirm implementation, service availability, health checks, monitoring, and production stability.', 'suntec', 'SunTec Infrastructure Support', true, 'client_visible', 10)
      ]),
      ...pauseStatuses('xw_inf_l3', 'suntec', 'SunTec Infrastructure Support', 'partner_visible'),
      ...closureStatuses('xw_inf_l3', 'suntec', 'SunTec Infrastructure Support', 'suntec', 'SunTec Infrastructure Support')
    ]
  };
}

export const xelerateIncidentTaskCatalog = [
  applicationL1,
  applicationL2,
  applicationL3,
  securityL2(),
  securityL3(),
  operationalL2(),
  operationalL3(),
  infrastructureL2(),
  infrastructureL3()
];
