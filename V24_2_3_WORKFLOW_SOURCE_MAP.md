# v24.2.3 Workflow Source Map

This file records the configured workflow graph used by Service Manager v24.2.3 and the supplied deck that governs each graph.

| Source deck | Service Manager workflow | Statuses | Transitions |
|---|---|---:|---:|
| `Incident(4).pptx` | `WF_SAAS_INCIDENT` | 27 | 98 |
| `Problem(3).pptx` | `WF_SAAS_PROBLEM` | 7 | 14 |
| `CR Workflow(3).pptx` | `WF_SAAS_CHANGE` | 29 | 53 |
| `Maintenance Request(1).pptx` | `WF_SAAS_MAINTENANCE` | 24 | 67 |

## Interpretation rule for Incident

The JSM transition detail for **Request to L2 Support** lists `New`, `Analysis`, `In Preproduction` and `Test Failed` as technical source statuses. The UAT/product rule explicitly agreed for Service Manager is stricter: **a normal Bank/L1 request must go `New → Analysis` before Request to L2 Support**. The configured graph therefore excludes `New → L2 Support` while retaining the other documented sources.

The source JSM field “Customers can make this transition” is stored as `jiraCustomerEnabled`. It is not used as a synonym for Service Manager Bank/L1 operational permission. `clientEnabled` records the latter.

## Incident — complete configured transition map

`Incident(4).pptx` is the source. JSM transition IDs are retained where the deck provides them.

| JSM ID | Action | From | To | JSM portal customer | Service Manager Bank/L1 |
|---:|---|---|---|:---:|:---:|
| 21 | Start Analysis | `NEW` | `ANALYSIS` | Yes | Yes |
| 101 | Request to L2 Support | `ANALYSIS` | `L2_SUPPORT` | Yes | Yes |
| 41 | Deferred | `ANALYSIS` | `DEFERRED` | Yes | Yes |
| 51 | Duplicate | `ANALYSIS` | `DUPLICATE` | Yes | Yes |
| 61 | Not an issue | `ANALYSIS` | `NOT_AN_ISSUE` | Yes | Yes |
| 31 | Send to Preproduction | `ANALYSIS` | `IN_PREPRODUCTION` | Yes | Yes |
| 91 | Close | `ANALYSIS` | `CLOSED` | Yes | Yes |
| 661 | On Hold | `ANALYSIS` | `ON_HOLD` | No | Yes |
| 611 | Under Monitoring | `ANALYSIS` | `UNDER_MONITORING` | No | Yes |
| 101 | Request to L2 Support | `IN_PREPRODUCTION` | `L2_SUPPORT` | Yes | Yes |
| 101 | Request to L2 Support | `TEST_FAILED` | `L2_SUPPORT` | Yes | Yes |
| 71 | Test Failure | `IN_PREPRODUCTION` | `TEST_FAILED` | Yes | Yes |
| 81 | Re-Analysis | `TEST_FAILED` | `ANALYSIS` | Yes | Yes |
| 11 | Deploy to Production/DR | `IN_PREPRODUCTION` | `VERIFICATION_COMPLETE` | Yes | Yes |
| 351 | Verify & Resolve | `VERIFICATION_COMPLETE` | `VERIFY_AND_RESOLVE` | Yes | Yes |
| 531 | Analysis | `DEFERRED` | `ANALYSIS` | Yes | Yes |
| 621 | Analysis | `UNDER_MONITORING` | `ANALYSIS` | No | Yes |
| 671 | Analysis | `ON_HOLD` | `ANALYSIS` | No | Yes |
| 451 | Assign to L3 | `NEW` | `L3_SUPPORT` | No | No |
| 41 | Deferred | `L2_ANALYSIS` | `DEFERRED` | Yes | No |
| 51 | Duplicate | `L2_ANALYSIS` | `DUPLICATE` | Yes | No |
| 61 | Not an issue | `L2_ANALYSIS` | `NOT_AN_ISSUE` | Yes | No |
| 41 | Deferred | `L3_ANALYSIS` | `DEFERRED` | Yes | No |
| 51 | Duplicate | `L3_ANALYSIS` | `DUPLICATE` | Yes | No |
| 61 | Not an issue | `L3_ANALYSIS` | `NOT_AN_ISSUE` | Yes | No |
| 41 | Deferred | `INTERIM_RESOLUTION` | `DEFERRED` | Yes | No |
| 51 | Duplicate | `INTERIM_RESOLUTION` | `DUPLICATE` | Yes | No |
| 61 | Not an issue | `INTERIM_RESOLUTION` | `NOT_AN_ISSUE` | Yes | No |
| 91 | Close | `L2_ANALYSIS` | `CLOSED` | Yes | No |
| 91 | Close | `INTERIM_RESOLUTION` | `CLOSED` | Yes | No |
| 91 | Close | `L2_TEST_FAILED` | `CLOSED` | Yes | No |
| 91 | Close | `RESOLVED` | `CLOSED` | Yes | No |
| 91 | Close | `PROBLEM_CREATED` | `CLOSED` | Yes | No |
| 111 | Start Analysis | `L2_SUPPORT` | `L2_ANALYSIS` | No | No |
| 371 | Resolve | `L2_ANALYSIS` | `RESOLVED` | No | No |
| 461 | Interim Resolution | `L2_ANALYSIS` | `INTERIM_RESOLUTION` | No | No |
| 571 | Bank to Verify | `L2_ANALYSIS` | `BANK_TO_VERIFY` | No | No |
| 591 | L2 Analysis | `BANK_TO_VERIFY` | `L2_ANALYSIS` | No | No |
| 551 | L2 Analysis | `DEFERRED` | `L2_ANALYSIS` | Yes | No |
| 641 | L2 Analysis | `UNDER_MONITORING` | `L2_ANALYSIS` | No | No |
| 681 | L2 Analysis | `ON_HOLD` | `L2_ANALYSIS` | No | No |
| 561 | Interim Resolution | `DEFERRED` | `INTERIM_RESOLUTION` | Yes | No |
| 651 | Interim Resolution | `UNDER_MONITORING` | `INTERIM_RESOLUTION` | No | No |
| 701 | Interim Resolution | `ON_HOLD` | `INTERIM_RESOLUTION` | No | No |
| 611 | Under Monitoring | `L2_ANALYSIS` | `UNDER_MONITORING` | No | No |
| 661 | On Hold | `L2_ANALYSIS` | `ON_HOLD` | No | No |
| 611 | Under Monitoring | `INTERIM_RESOLUTION` | `UNDER_MONITORING` | No | No |
| 661 | On Hold | `INTERIM_RESOLUTION` | `ON_HOLD` | No | No |
| 151 | L2 Test Failure | `VERIFICATION_COMPLETE` | `L2_TEST_FAILED` | No | No |
| 151 | L2 Test Failure | `IN_BUILD` | `L2_TEST_FAILED` | No | No |
| 151 | L2 Test Failure | `IN_QUALITY` | `L2_TEST_FAILED` | No | No |
| 151 | L2 Test Failure | `IN_STAGE` | `L2_TEST_FAILED` | No | No |
| 161 | L2 Re-Analysis | `L2_TEST_FAILED` | `L2_ANALYSIS` | No | No |
| 281 | Create Problem | `L2_TEST_FAILED` | `PROBLEM_CREATED` | No | No |
| 281 | Create Problem | `RESOLVED` | `PROBLEM_CREATED` | No | No |
| 171 | Escalate to L3 | `L2_ANALYSIS` | `L3_SUPPORT` | No | No |
| 171 | Escalate to L3 | `IN_BUILD` | `L3_SUPPORT` | No | No |
| 171 | Escalate to L3 | `IN_QUALITY` | `L3_SUPPORT` | No | No |
| 171 | Escalate to L3 | `IN_STAGE` | `L3_SUPPORT` | No | No |
| 171 | Escalate to L3 | `INTERIM_RESOLUTION` | `L3_SUPPORT` | No | No |
| 181 | Start Analysis | `L3_SUPPORT` | `L3_ANALYSIS` | No | No |
| 541 | L3 Analysis | `DEFERRED` | `L3_ANALYSIS` | Yes | No |
| 581 | Bank to Verify | `L3_ANALYSIS` | `BANK_TO_VERIFY` | No | No |
| 601 | L3 Analysis | `BANK_TO_VERIFY` | `L3_ANALYSIS` | No | No |
| 631 | L3 Analysis | `UNDER_MONITORING` | `L3_ANALYSIS` | No | No |
| 691 | L3 Analysis | `ON_HOLD` | `L3_ANALYSIS` | No | No |
| 611 | Under Monitoring | `L3_ANALYSIS` | `UNDER_MONITORING` | No | No |
| 661 | On Hold | `L3_ANALYSIS` | `ON_HOLD` | No | No |
| 361 | Raise vendor Support Request | `L3_ANALYSIS` | `VENDOR_TICKET_RAISED` | No | No |
| 201 | Send for Development | `L3_ANALYSIS` | `DEVELOPMENT` | No | No |
| 201 | Send for Development | `VENDOR_TICKET_RAISED` | `DEVELOPMENT` | No | No |
| 191 | Resolve | `L3_ANALYSIS` | `RESOLVED` | No | No |
| 191 | Resolve | `VENDOR_TICKET_RAISED` | `RESOLVED` | No | No |
| 191 | Resolve | `INTERIM_RESOLUTION` | `RESOLVED` | No | No |
| 211 | Send for Release | `DEVELOPMENT` | `RELEASE` | No | No |
| 221 | Send for Build | `RELEASE` | `IN_BUILD` | No | No |
| 381 | Send to build | `RESOLVED` | `IN_BUILD` | No | No |
| 391 | Send to quality | `IN_BUILD` | `IN_QUALITY` | No | No |
| 391 | Send to quality | `RELEASE` | `IN_QUALITY` | No | No |
| 391 | Send to quality | `RESOLVED` | `IN_QUALITY` | No | No |
| 401 | Send to stage | `IN_BUILD` | `IN_STAGE` | No | No |
| 401 | Send to stage | `IN_QUALITY` | `IN_STAGE` | No | No |
| 401 | Send to stage | `RELEASE` | `IN_STAGE` | No | No |
| 401 | Send to stage | `RESOLVED` | `IN_STAGE` | No | No |
| 411 | Send to preproduction | `IN_BUILD` | `IN_PREPRODUCTION` | No | No |
| 411 | Send to preproduction | `IN_QUALITY` | `IN_PREPRODUCTION` | No | No |
| 411 | Send to preproduction | `IN_STAGE` | `IN_PREPRODUCTION` | No | No |
| 411 | Send to preproduction | `RELEASE` | `IN_PREPRODUCTION` | No | No |
| 411 | Send to preproduction | `RESOLVED` | `IN_PREPRODUCTION` | No | No |
| 421 | L3 Test Failure | `VERIFICATION_COMPLETE` | `L3_ANALYSIS` | No | No |
| 421 | L3 Test Failure | `IN_BUILD` | `L3_ANALYSIS` | No | No |
| 421 | L3 Test Failure | `IN_QUALITY` | `L3_ANALYSIS` | No | No |
| 421 | L3 Test Failure | `IN_STAGE` | `L3_ANALYSIS` | No | No |
| 431 | L2 Deploy to Production/DR | `IN_PREPRODUCTION` | `VERIFICATION_COMPLETE` | No | No |
| 511 | Send to Production/DR | `IN_PREPRODUCTION` | `VERIFICATION_COMPLETE` | No | No |
| 521 | Verify and Resolve | `VERIFICATION_COMPLETE` | `VERIFY_AND_RESOLVE` | No | No |
| 501 | Close | `VERIFY_AND_RESOLVE` | `CLOSED` | No | No |
| 341 | Verification complete by Automation | `RESOLVED` | `VERIFICATION_COMPLETE` | No | No |

### Incident global actions

| JSM ID | Action | Status effect | JSM portal customer | Service Manager Bank/L1 |
|---:|---|---|:---:|:---:|
| 471 | Escalate to Support Manager | KEEP | Yes | Yes |
| 481 | Escalate to Head Of Support | KEEP | No | No |
| 491 | Escalate to Global Support Head | KEEP | No | No |

## Problem — complete configured transition map

`Problem(3).pptx` is the source.

| Action | From | To |
|---|---|---|
| Review | `OPEN` | `UNDER_REVIEW` |
| Investigate | `UNDER_REVIEW` | `UNDER_INVESTIGATION` |
| Investigate | `PENDING` | `UNDER_INVESTIGATION` |
| Pending | `UNDER_REVIEW` | `PENDING` |
| Pending | `UNDER_INVESTIGATION` | `PENDING` |
| Back to under review | `PENDING` | `UNDER_REVIEW` |
| Complete | `OPEN` | `COMPLETED` |
| Complete | `UNDER_INVESTIGATION` | `COMPLETED` |
| Back to work in progress | `COMPLETED` | `UNDER_INVESTIGATION` |
| Cancel | `OPEN` | `CANCELLED` |
| Cancel | `UNDER_REVIEW` | `CANCELLED` |
| Cancel | `UNDER_INVESTIGATION` | `CANCELLED` |
| Close | `CANCELLED` | `CLOSED` |
| Close | `COMPLETED` | `CLOSED` |

## Change Request — complete configured transition map

`CR Workflow(3).pptx` is the source.

| Action | From | To |
|---|---|---|
| Start Analysis | `NEW` | `ANALYSIS` |
| Duplicate | `ANALYSIS` | `DUPLICATE` |
| Deferred | `ANALYSIS` | `DEFERRED` |
| Not a Change | `ANALYSIS` | `NOT_A_CHANGE` |
| Requirement Analysis | `ANALYSIS` | `IN_REQUIREMENT_ANALYSIS` |
| Classify Product/Custom | `IN_REQUIREMENT_ANALYSIS` | `PRODUCT_CUSTOM` |
| Send for Requirement Grooming | `IN_REQUIREMENT_ANALYSIS` | `REQUIREMENT_GROOMING` |
| Send for Product Grooming | `PRODUCT_CUSTOM` | `PRODUCT_REQUIREMENT_GROOMING` |
| Send for Custom Grooming | `PRODUCT_CUSTOM` | `CUSTOM_REQUIREMENT_GROOMING` |
| Fill CR Form | `PRODUCT_REQUIREMENT_GROOMING` | `CR_FORM` |
| Fill CR Form | `CUSTOM_REQUIREMENT_GROOMING` | `CR_FORM` |
| Send for Bank Approval | `CR_FORM` | `APPROVAL_BY_BANK` |
| Send for Bank Approval | `REQUIREMENT_GROOMING` | `APPROVAL_BY_BANK` |
| Send for Effort and Cost Approval | `REQUIREMENT_GROOMING` | `MANAGEMENT_APPROVAL` |
| Approve | `MANAGEMENT_APPROVAL` | `MANAGEMENT_APPROVED` |
| Reject | `MANAGEMENT_APPROVAL` | `IN_REQUIREMENT_ANALYSIS` |
| Send for Bank Approval | `MANAGEMENT_APPROVED` | `APPROVAL_BY_BANK` |
| Approve | `APPROVAL_BY_BANK` | `APPROVED` |
| Reject | `APPROVAL_BY_BANK` | `IN_REQUIREMENT_ANALYSIS` |
| Send for Development | `APPROVED` | `DEVELOPMENT` |
| Re-Analysis | `TEST_FAILED` | `DEVELOPMENT` |
| Send for Release | `DEVELOPMENT` | `RELEASE` |
| Test Passed in Build | `IN_BUILD` | `TEST_PASSED_BUILD` |
| Test Passed in Quality | `IN_QUALITY` | `TEST_PASSED_QUALITY` |
| Test Passed in Stage | `IN_STAGE` | `TEST_PASSED_STAGE` |
| Test Passed in Preproduction | `IN_PREPRODUCTION` | `TEST_PASSED_PREPRODUCTION` |
| Send to Build | `RELEASE` | `IN_BUILD` |
| Send to Build | `INCIDENT_CREATED` | `IN_BUILD` |
| Send to Quality | `RELEASE` | `IN_QUALITY` |
| Send to Quality | `TEST_PASSED_BUILD` | `IN_QUALITY` |
| Send to Quality | `INCIDENT_CREATED` | `IN_QUALITY` |
| Send to Stage | `RELEASE` | `IN_STAGE` |
| Send to Stage | `TEST_PASSED_BUILD` | `IN_STAGE` |
| Send to Stage | `TEST_PASSED_QUALITY` | `IN_STAGE` |
| Send to Stage | `INCIDENT_CREATED` | `IN_STAGE` |
| Send to Preproduction | `RELEASE` | `IN_PREPRODUCTION` |
| Send to Preproduction | `TEST_PASSED_BUILD` | `IN_PREPRODUCTION` |
| Send to Preproduction | `TEST_PASSED_QUALITY` | `IN_PREPRODUCTION` |
| Send to Preproduction | `TEST_PASSED_STAGE` | `IN_PREPRODUCTION` |
| Send to Preproduction | `INCIDENT_CREATED` | `IN_PREPRODUCTION` |
| Deploy to Production/DR | `RELEASE` | `VERIFICATION_COMPLETE` |
| Deploy to Production/DR | `TEST_PASSED_BUILD` | `VERIFICATION_COMPLETE` |
| Deploy to Production/DR | `TEST_PASSED_QUALITY` | `VERIFICATION_COMPLETE` |
| Deploy to Production/DR | `TEST_PASSED_STAGE` | `VERIFICATION_COMPLETE` |
| Deploy to Production/DR | `TEST_PASSED_PREPRODUCTION` | `VERIFICATION_COMPLETE` |
| Test Failure | `IN_BUILD` | `TEST_FAILED` |
| Test Failure | `IN_QUALITY` | `TEST_FAILED` |
| Test Failure | `IN_STAGE` | `TEST_FAILED` |
| Test Failure | `IN_PREPRODUCTION` | `TEST_FAILED` |
| Test Failure | `VERIFICATION_COMPLETE` | `TEST_FAILED` |
| Create Incident | `TEST_FAILED` | `INCIDENT_CREATED` |
| Close | `VERIFICATION_COMPLETE` | `CLOSED` |
| Close | `INCIDENT_CREATED` | `CLOSED` |

## Maintenance Request — complete configured transition map

`Maintenance Request(1).pptx` is the source.

| Action | From | To |
|---|---|---|
| Start Analysis | `NEW` | `ANALYSIS` |
| Reopen Request | `REJECTED` | `NEW` |
| Cancel Request | `NEW` | `CANCELLED` |
| Cancel Request | `ANALYSIS` | `CANCELLED` |
| Cancel Request | `SNAPSHOT_REVERT` | `CANCELLED` |
| Reject | `ANALYSIS` | `REJECTED` |
| Approve | `ANALYSIS` | `APPROVED` |
| Complete | `APPROVED` | `COMPLETED` |
| Snapshot Revert Approval | `APPROVED` | `SNAPSHOT_REVERT` |
| Complete | `SNAPSHOT_REVERT` | `COMPLETED` |
| Initiate Switch to DR Site | `APPROVED` | `INITIATE_SWITCH_DR` |
| Cancel | `APPROVED` | `CANCELLED` |
| Switch to DR | `INITIATE_SWITCH_DR` | `SWITCHED_DR` |
| Initiate Reverse Sync To Primary | `SWITCHED_DR` | `INITIATE_REVERSE_PRIMARY` |
| Reverse sync To Primary Enabled | `INITIATE_REVERSE_PRIMARY` | `REVERSE_PRIMARY_ENABLED` |
| Switchback To Primary: Pre-check | `REVERSE_PRIMARY_ENABLED` | `PRIMARY_PRECHECK` |
| Approved | `PRIMARY_PRECHECK` | `APPROVED` |
| Rejected | `PRIMARY_PRECHECK` | `REJECTED` |
| Initiate Switch to Primary | `APPROVED` | `INITIATE_SWITCH_PRIMARY` |
| Switched to Primary | `INITIATE_SWITCH_PRIMARY` | `SWITCHED_PRIMARY` |
| Initiate Reverse Sync To DR | `SWITCHED_PRIMARY` | `INITIATE_REVERSE_DR` |
| Reverse sync to DR Enabled | `INITIATE_REVERSE_DR` | `REVERSE_DR_ENABLED` |
| BCP Report Preparation | `REVERSE_DR_ENABLED` | `BCP_REPORT_PREP` |
| Publish BCP Report | `BCP_REPORT_PREP` | `PUBLISH_BCP_REPORT` |
| Publish VA Report | `COMPLETED` | `VA_REPORT` |
| Publish PT Report | `COMPLETED` | `PT_REPORT` |
| Close | `COMPLETED` | `CLOSED` |
| Close | `PUBLISH_BCP_REPORT` | `CLOSED` |
| Close | `VA_REPORT` | `CLOSED` |
| Close | `PT_REPORT` | `CLOSED` |
| Create Problem | `VA_REPORT` | `PROBLEM_CREATED` |
| Create Problem | `PT_REPORT` | `PROBLEM_CREATED` |
| Close | `PROBLEM_CREATED` | `CLOSED` |
| Create Incident | `INITIATE_SWITCH_DR` | `INCIDENT_CREATED` |
| Incident | `INCIDENT_CREATED` | `INITIATE_SWITCH_DR` |
| Create Incident | `SWITCHED_DR` | `INCIDENT_CREATED` |
| Incident | `INCIDENT_CREATED` | `SWITCHED_DR` |
| Create Incident | `INITIATE_REVERSE_PRIMARY` | `INCIDENT_CREATED` |
| Incident | `INCIDENT_CREATED` | `INITIATE_REVERSE_PRIMARY` |
| Create Incident | `INITIATE_SWITCH_PRIMARY` | `INCIDENT_CREATED` |
| Incident | `INCIDENT_CREATED` | `INITIATE_SWITCH_PRIMARY` |
| Create Incident | `SWITCHED_PRIMARY` | `INCIDENT_CREATED` |
| Incident | `INCIDENT_CREATED` | `SWITCHED_PRIMARY` |
| Create Incident | `INITIATE_REVERSE_DR` | `INCIDENT_CREATED` |
| Incident | `INCIDENT_CREATED` | `INITIATE_REVERSE_DR` |
| Create Problem | `INITIATE_SWITCH_DR` | `PROBLEM_CREATED` |
| Problem | `PROBLEM_CREATED` | `INITIATE_SWITCH_DR` |
| Create Problem | `SWITCHED_DR` | `PROBLEM_CREATED` |
| Problem | `PROBLEM_CREATED` | `SWITCHED_DR` |
| Create Problem | `INITIATE_SWITCH_PRIMARY` | `PROBLEM_CREATED` |
| Problem | `PROBLEM_CREATED` | `INITIATE_SWITCH_PRIMARY` |
| Create Problem | `SWITCHED_PRIMARY` | `PROBLEM_CREATED` |
| Problem | `PROBLEM_CREATED` | `SWITCHED_PRIMARY` |
| Service Request | `INITIATE_SWITCH_DR` | `SERVICE_REQUEST_CREATED` |
| Service Request | `SERVICE_REQUEST_CREATED` | `INITIATE_SWITCH_DR` |
| Service Request | `SWITCHED_DR` | `SERVICE_REQUEST_CREATED` |
| Service Request | `SERVICE_REQUEST_CREATED` | `SWITCHED_DR` |
| Service Request | `INITIATE_REVERSE_PRIMARY` | `SERVICE_REQUEST_CREATED` |
| Service Request | `SERVICE_REQUEST_CREATED` | `INITIATE_REVERSE_PRIMARY` |
| Service Request | `PRIMARY_PRECHECK` | `SERVICE_REQUEST_CREATED` |
| Service Request | `SERVICE_REQUEST_CREATED` | `PRIMARY_PRECHECK` |
| Service Request | `INITIATE_SWITCH_PRIMARY` | `SERVICE_REQUEST_CREATED` |
| Service Request | `SERVICE_REQUEST_CREATED` | `INITIATE_SWITCH_PRIMARY` |
| Service Request | `SWITCHED_PRIMARY` | `SERVICE_REQUEST_CREATED` |
| Service Request | `SERVICE_REQUEST_CREATED` | `SWITCHED_PRIMARY` |
| Service Request | `INITIATE_REVERSE_DR` | `SERVICE_REQUEST_CREATED` |
| Service Request | `SERVICE_REQUEST_CREATED` | `INITIATE_REVERSE_DR` |

## Runtime safeguards added in v24.2.3

- The UI submits the exact transition key, not only source and destination status.
- The request service validates the exact transition key against the current status and target status.
- Cross-level Bank/L1 actions such as Request to L2 Support are shown in Change status but are executed through the guarded support-movement handler.
- The old standalone `assign_l2` path is absent.
- Existing open-request workflow snapshots can be refreshed with the separate v24.2.3 sync script after a dry run and backup.
