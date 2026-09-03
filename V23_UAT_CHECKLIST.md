# Service Manager v23.0.1 — Manual UAT Checklist

**Rule:** every **P0** case is a release blocker. The `NI-*` group exists specifically to prove that normal/non-SaaS Incident Management was not touched.

Total cases: **79**. Mark each as PASS / FAIL / NOT RUN and capture screenshot or request key as evidence.

## Install / Preflight

### IN-01 — P0 — Admin

**Preconditions:** App root contains current v21/v22/v23 source and clean pack  
**Steps:** Run node .\Service_Manager_v23_Clean_Upgrade\apply-v23-clean.mjs  
**Expected:** Upgrade completes; version becomes 23.0.1; no patch error.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### IN-02 — P0 — Admin

**Preconditions:** v23.0.1 installed  
**Steps:** Run .\V23.ps1 preflight against configured DB  
**Expected:** Preflight identifies a non-empty application DB and performs no writes.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### IN-03 — P0 — Admin

**Preconditions:** Configured Mongo DB is empty  
**Steps:** Run .\V23.ps1 preflight  
**Expected:** Preflight BLOCKS. It must not silently provision an empty database; candidate databases may be listed.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### IN-04 — P0 — Admin

**Preconditions:** v23.0.1 installed  
**Steps:** Run .\V23.ps1 verify  
**Expected:** Normal Incident guard and all automated v23 tests pass.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### IN-05 — P0 — Admin

**Preconditions:** Valid non-empty DB selected  
**Steps:** Run .\V23.ps1 dry-run  
**Expected:** Output explicitly says DRY RUN / no writes; shows Would create/Would update, not Created/Updated.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### IN-06 — P0 — Admin

**Preconditions:** Dry-run contains ambiguous rows  
**Steps:** Try apply-db without -ApproveBindings  
**Expected:** Command refuses to run.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

## Normal Incident Regression

### NI-01 — P0 — Client

**Preconditions:** A normal/non-SaaS Incident request type exists  
**Steps:** Open normal Incident create page  
**Expected:** Creation form is unchanged from the pre-v23 baseline.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### NI-02 — P0 — Client

**Preconditions:** Normal Application Incident exists with same display name as SaaS subtype but no v23 binding  
**Steps:** Open its create page  
**Expected:** v23 configurable SaaS form does not activate merely from the name Application Incident.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### NI-03 — P0 — Client

**Preconditions:** Normal Incident create page  
**Steps:** Inspect Priority/Severity and legacy fields  
**Expected:** Existing normal Incident field behavior remains exactly as baseline; v23 client-priority rules do not override it.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### NI-04 — P0 — Support

**Preconditions:** Existing normal Incident  
**Steps:** Open request detail  
**Expected:** Existing normal Incident actions/tasks/controls remain unchanged; no SaaS-only controls appear.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### NI-05 — P0 — Support

**Preconditions:** Existing normal Incident  
**Steps:** Move through its normal workflow statuses  
**Expected:** Its original workflow works as before v23.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### NI-06 — P0 — Support

**Preconditions:** Existing normal Incident with support routing  
**Steps:** Move L1/L2/L3 according to normal process  
**Expected:** v23 status-preservation logic does not alter normal Incident routing behavior.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### NI-07 — P0 — Client

**Preconditions:** Normal Incident  
**Steps:** Try client lifecycle actions used in baseline  
**Expected:** Normal Incident client actions behave exactly as before.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### NI-08 — P0 — Admin

**Preconditions:** Normal Incident subtype has no SUNTEC_SAAS_V23 binding  
**Steps:** Call/inspect v23 form-binding lookup for the normal subtype  
**Expected:** No v23 binding is returned.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### NI-09 — P0 — Client

**Preconditions:** Normal unbound Incident  
**Steps:** Spoof/edit a v23 hidden marker in browser request  
**Expected:** Backend discards/ignores spoofed v23 marker because exact DB type binding is absent.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### NI-10 — P0 — Admin

**Preconditions:** Normal Incident and SaaS Incident both exist  
**Steps:** Compare stored type bindings  
**Expected:** Only exact SaaS type documents carry SUNTEC_SAAS_V23; normal Incident records are untouched.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

## SaaS Incident Creation

### SI-01 — P0 — Client

**Preconditions:** Application Incident is explicitly bound to SUNTEC_SAAS_V23  
**Steps:** Create Application Incident; inspect form and submit a valid request  
**Expected:** v23 SaaS form activates only for bound type. Client can set Severity, cannot set Priority. Release ID/Release Type/RCA Category/Root Cause are absent at creation. No subtype-specific extra field required.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SI-02 — P0 — Client

**Preconditions:** Compliance Incident is explicitly bound to SUNTEC_SAAS_V23  
**Steps:** Create Compliance Incident; inspect form and submit a valid request  
**Expected:** v23 SaaS form activates only for bound type. Client can set Severity, cannot set Priority. Release ID/Release Type/RCA Category/Root Cause are absent at creation. Test Release field is visible.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SI-03 — P0 — Client

**Preconditions:** Infrastructure Incident is explicitly bound to SUNTEC_SAAS_V23  
**Steps:** Create Infrastructure Incident; inspect form and submit a valid request  
**Expected:** v23 SaaS form activates only for bound type. Client can set Severity, cannot set Priority. Release ID/Release Type/RCA Category/Root Cause are absent at creation. No subtype-specific extra field required.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SI-04 — P0 — Client

**Preconditions:** Operational Incident is explicitly bound to SUNTEC_SAAS_V23  
**Steps:** Create Operational Incident; inspect form and submit a valid request  
**Expected:** v23 SaaS form activates only for bound type. Client can set Severity, cannot set Priority. Release ID/Release Type/RCA Category/Root Cause are absent at creation. No subtype-specific extra field required.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SI-05 — P0 — Client

**Preconditions:** Security Incident is explicitly bound to SUNTEC_SAAS_V23  
**Steps:** Create Security Incident; inspect form and submit a valid request  
**Expected:** v23 SaaS form activates only for bound type. Client can set Severity, cannot set Priority. Release ID/Release Type/RCA Category/Root Cause are absent at creation. Critical Data Involved field is visible.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SI-06 — P1 — Client

**Preconditions:** Bound SaaS Incident form  
**Steps:** Open create form when only one product/module/environment option exists  
**Expected:** Option may be preselected, but unnecessary narration such as “automatically selected” is not shown.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SI-07 — P0 — Client

**Preconditions:** Bound SaaS Incident  
**Steps:** Inspect actions available immediately after creation  
**Expected:** Client cannot Take Ownership, Assign, Unassign or change support owner.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SI-08 — P0 — Client

**Preconditions:** Bound SaaS Incident  
**Steps:** Create with a client-specific environment list  
**Expected:** Only environments allowed for that client are selectable.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

## SaaS Incident Workflow

### SW-01 — P0 — Support

**Preconditions:** SaaS Incident in New  
**Steps:** Transition New → Analysis  
**Expected:** Request enters Analysis; New is not offered again as a normal working status.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SW-02 — P0 — Support

**Preconditions:** SaaS Incident in Analysis at L1  
**Steps:** Move support L1 → L2  
**Expected:** Support level becomes L2 while business status remains Analysis; no reset to New.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SW-03 — P0 — Support

**Preconditions:** SaaS Incident in Analysis at L2  
**Steps:** Move support L2 → L3  
**Expected:** Support level becomes L3 while business status remains Analysis; no reset to New.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SW-04 — P0 — Support

**Preconditions:** SaaS Incident in a working state  
**Steps:** Move support backward where configured  
**Expected:** Routing preserves/maps the business status according to configured rule; it never manufactures New.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SW-05 — P0 — Support

**Preconditions:** SaaS Application Incident in Analysis  
**Steps:** Use Bank to Verify and return  
**Expected:** Application Incident can use Bank to Verify and return to the configured analysis state.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SW-06 — P1 — Support

**Preconditions:** SaaS non-Application Incident  
**Steps:** Inspect available transitions  
**Expected:** Bank to Verify is not exposed unless configured for that subtype.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SW-07 — P1 — Support

**Preconditions:** SaaS Incident in Analysis  
**Steps:** Enter Under Monitoring then resume  
**Expected:** Returns to the appropriate immediately preceding working status.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SW-08 — P1 — Support

**Preconditions:** SaaS Incident in Analysis  
**Steps:** Enter On Hold then resume  
**Expected:** Returns to the appropriate immediately preceding working status.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SW-09 — P1 — Support

**Preconditions:** SaaS Incident requiring development  
**Steps:** Exercise Development → Release → Build/Quality/Stage/Preproduction → Verification Complete  
**Expected:** Configured release/test/deployment path is available and valid.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SW-10 — P0 — Support

**Preconditions:** SaaS Incident reaches a test-failure state  
**Steps:** Use Test Failure/Re-Analysis path  
**Expected:** Failure returns to a meaningful analysis/rework state, never to New.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SW-11 — P1 — Support

**Preconditions:** SaaS Incident in L3 Analysis  
**Steps:** Raise Vendor Ticket then continue  
**Expected:** Vendor Ticket Raised follows configured return/development/resolution path.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SW-12 — P0 — Support

**Preconditions:** SaaS Incident at Verification Complete  
**Steps:** Verify & Resolve then close  
**Expected:** Workflow reaches Verify and Resolve / Closed only through configured transitions.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

## Classification / SLA

### CL-01 — P0 — Support

**Preconditions:** SaaS Incident has running SLA, Severity S3 and Priority P4  
**Steps:** Change Severity S3 → S1 and Priority P4 → P1  
**Expected:** Both changes save and are separately auditable in history.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### CL-02 — P0 — Support

**Preconditions:** Same request as CL-01  
**Steps:** Compare SLA before/after classification change  
**Expected:** Applicable due/target recalculates, but original SLA startedAt/start timestamp is unchanged.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### CL-03 — P0 — Client

**Preconditions:** Existing SaaS Incident  
**Steps:** Try to edit Priority  
**Expected:** Client cannot edit Priority.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### CL-04 — P0 — Client

**Preconditions:** Existing SaaS Incident  
**Steps:** Try to edit Severity after creation  
**Expected:** Client cannot change post-create Severity unless explicitly configured otherwise; default v23 behavior is read-only.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

## SaaS Service Request Forms

### SR-01 — P1 — Client

**Preconditions:** Application User Access is explicitly bound to v23  
**Steps:** Open Application User Access create form and inspect required/conditional fields  
**Expected:** Configured form is used; expected subtype fields include: Application Username, Department, Raised Environment, Privileges, Reason, Severity, Department Approval. Client Priority is not selectable. On-behalf-of appears only where configured.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SR-02 — P1 — Client

**Preconditions:** AWS User Access is explicitly bound to v23  
**Steps:** Open AWS User Access create form and inspect required/conditional fields  
**Expected:** Configured form is used; expected subtype fields include: AWS IAM Username, Department, Account No., Raised Environment, Privileges, Reason, Severity, Department Approval. Client Priority is not selectable. On-behalf-of appears only where configured.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SR-03 — P1 — Client

**Preconditions:** Bastion Host Access is explicitly bound to v23  
**Steps:** Open Bastion Host Access create form and inspect required/conditional fields  
**Expected:** Configured form is used; expected subtype fields include: Application Username, Department, Raised Environment, Privileges, Reason, Severity. Client Priority is not selectable. On-behalf-of appears only where configured.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SR-04 — P1 — Client

**Preconditions:** Business Configuration is explicitly bound to v23  
**Steps:** Open Business Configuration create form and inspect required/conditional fields  
**Expected:** Configured form is used; expected subtype fields include: Raised Environment and configured common fields. Client Priority is not selectable. On-behalf-of appears only where configured.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SR-05 — P1 — Client

**Preconditions:** DB Data through CICD Pipeline is explicitly bound to v23  
**Steps:** Open DB Data through CICD Pipeline create form and inspect required/conditional fields  
**Expected:** Configured form is used; expected subtype fields include: Raised Environment, Department Approval, S3 Bucket URL. Client Priority is not selectable. On-behalf-of appears only where configured.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SR-06 — P1 — Client

**Preconditions:** Deletion of Application Container Image is explicitly bound to v23  
**Steps:** Open Deletion of Application Container Image create form and inspect required/conditional fields  
**Expected:** Configured form is used; expected subtype fields include: Raised Environment, Reason, Department Approval. Client Priority is not selectable. On-behalf-of appears only where configured.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SR-07 — P1 — Client

**Preconditions:** DR Drill / BCP is explicitly bound to v23  
**Steps:** Open DR Drill / BCP create form and inspect required/conditional fields  
**Expected:** Configured form is used; expected subtype fields include: DR Initiation Date, Targeted DR Switchover Time, DR Drill Period, Department Approval, S3 Bucket URL. Client Priority is not selectable. On-behalf-of appears only where configured.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SR-08 — P1 — Client

**Preconditions:** Dynamic Reports for Clients/SunTec is explicitly bound to v23  
**Steps:** Open Dynamic Reports for Clients/SunTec create form and inspect required/conditional fields  
**Expected:** Configured form is used; expected subtype fields include: Raised Environment, Department Approval, S3 Bucket URL. Client Priority is not selectable. On-behalf-of appears only where configured.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SR-09 — P1 — Client

**Preconditions:** Email Creation is explicitly bound to v23  
**Steps:** Open Email Creation create form and inspect required/conditional fields  
**Expected:** Configured form is used; expected subtype fields include: Privileges, Reason, Department Approval. Client Priority is not selectable. On-behalf-of appears only where configured.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SR-10 — P1 — Client

**Preconditions:** Federated Access is explicitly bound to v23  
**Steps:** Open Federated Access create form and inspect required/conditional fields  
**Expected:** Configured form is used; expected subtype fields include: Raised Environment, Severity, Department Approval. Client Priority is not selectable. On-behalf-of appears only where configured.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

## SaaS Service Request Workflow

### SR-11 — P0 — Support/Approver

**Preconditions:** Access request created  
**Steps:** Move through Pending Approval → Access Approved; then update/revoke  
**Expected:** Access workflow supports approval, update and revoke lifecycle; rejection path works.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SR-12 — P1 — Support

**Preconditions:** Generic service request created  
**Steps:** Run generic SR path  
**Expected:** Generic SR uses generic workflow rather than the giant DR/PITR workflow.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SR-13 — P1 — Support

**Preconditions:** DR/BCP request created  
**Steps:** Exercise switch to DR, reverse sync, primary switchback, BCP report  
**Expected:** DR/BCP request uses its dedicated operational workflow and linked-request actions where configured.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SR-14 — P1 — Support

**Preconditions:** PITR request created  
**Steps:** Exercise PITR analysis → pre-check → drill → validate restored DB → enable infra → validations → rollback → report  
**Expected:** PITR request uses dedicated PITR workflow through completion/reporting.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SR-15 — P0 — Client/Support

**Preconditions:** Marked SaaS Service Request  
**Steps:** Inspect SLA presentation/behavior  
**Expected:** SLA is not treated as applicable for v23 SaaS Service Requests.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

## Problem Workflow

### PB-01 — P1 — Support

**Preconditions:** Problem created  
**Steps:** Open → Under Review → Under Investigation → Completed → Closed  
**Expected:** Core Problem lifecycle works.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### PB-02 — P1 — Support

**Preconditions:** Problem in Under Investigation  
**Steps:** Move to Pending, then Investigate / Back to Under Review  
**Expected:** Pending and configured backward paths work.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### PB-03 — P1 — Support

**Preconditions:** Problem in Completed  
**Steps:** Use Back to work in progress  
**Expected:** Returns to Under Investigation as configured.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### PB-04 — P1 — Support

**Preconditions:** Active Problem  
**Steps:** Cancel then Close  
**Expected:** Cancellation/closure path works.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

## Change Workflow

### CH-01 — P1 — Support

**Preconditions:** Change created  
**Steps:** New → Analysis → Requirement Analysis → Product/Custom  
**Expected:** Initial classification/requirement path works.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### CH-02 — P1 — Support/Approver

**Preconditions:** Change in grooming/approval path  
**Steps:** Exercise Bank approval and rejection/rework  
**Expected:** Approval/rejection returns to configured requirement/rework status.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### CH-03 — P1 — Support/Approver

**Preconditions:** Change requiring management approval  
**Steps:** Exercise Management approval and rejection  
**Expected:** Management approval gate works and rejection returns to rework as configured.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### CH-04 — P1 — Support

**Preconditions:** Approved Change  
**Steps:** Development → Release → Build/Quality/Stage/Preproduction → Verification  
**Expected:** Build/test/release lifecycle works; test failure returns to reanalysis.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### CH-05 — P1 — Support

**Preconditions:** Change test failure requires Incident  
**Steps:** Use Create Incident action  
**Expected:** A linked Incident is created/related without corrupting the Change lifecycle.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

## Maintenance Workflow

### MR-01 — P1 — Support/Approver

**Preconditions:** Maintenance created  
**Steps:** New → Analysis → Approve / Reject; reopen rejected  
**Expected:** Approval, rejection and reopen paths work.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### MR-02 — P1 — Support

**Preconditions:** Approved maintenance  
**Steps:** Exercise Snapshot Revert path  
**Expected:** Snapshot Revert follows configured completion/cancel path.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### MR-03 — P1 — Support

**Preconditions:** Approved maintenance  
**Steps:** Switch to DR → reverse sync → switchback to Primary → reverse sync to DR  
**Expected:** Operational DR/Primary state machine works.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### MR-04 — P1 — Support

**Preconditions:** Maintenance reaches reporting stage  
**Steps:** BCP Report Preparation → Publish BCP Report → Closed  
**Expected:** BCP reporting closes through configured path.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### MR-05 — P1 — Support

**Preconditions:** Completed Maintenance  
**Steps:** Publish VA/PT report and create Problem where applicable  
**Expected:** VA/PT report and linked Problem actions work without losing the maintenance context.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### MR-06 — P1 — Support

**Preconditions:** Operational maintenance state  
**Steps:** Create linked Incident/Problem/Service Request  
**Expected:** Linked request is created and maintenance can continue from configured return point.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

## Approval Engine

### AP-01 — P1 — Approver

**Preconditions:** Marked SaaS request requiring approval  
**Steps:** Approve request  
**Expected:** Approval status becomes Approved; actor/time/comment are audited.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### AP-02 — P1 — Approver

**Preconditions:** Marked SaaS request requiring approval  
**Steps:** Reject request  
**Expected:** Approval status becomes Rejected and workflow follows configured rejection path.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### AP-03 — P0 — Client

**Preconditions:** Marked SaaS request requiring approval  
**Steps:** Attempt approval API/action as Client  
**Expected:** Client approval attempt is denied unless explicitly authorized by configuration.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

## Visibility

### VS-01 — P1 — Support/Manager

**Preconditions:** Marked SaaS request  
**Steps:** Expand request visibility to another allowed team/user  
**Expected:** Visibility change succeeds and is audited.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### VS-02 — P0 — Client

**Preconditions:** Marked SaaS request  
**Steps:** Attempt support-only visibility expansion  
**Expected:** Action is denied.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

## Audit / History

### AU-01 — P1 — Support

**Preconditions:** Marked SaaS request with multiple actions  
**Steps:** Perform status change, support move, classification change, approval  
**Expected:** History contains distinct, intelligible entries for each action.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### AU-02 — P1 — Support

**Preconditions:** Marked SaaS request  
**Steps:** Create linked Incident/Problem/SR  
**Expected:** History records linked-request creation and relationship.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

## Security / Isolation

### SC-01 — P0 — Admin

**Preconditions:** Normal and SaaS types share display names  
**Steps:** Review exact type bindings after DB apply  
**Expected:** Only approved collection:id rows are stamped with SUNTEC_SAAS_V23.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________

### SC-02 — P0 — Admin

**Preconditions:** Dry-run output available  
**Steps:** Run apply using only a subset of reviewed bindings  
**Expected:** Only explicitly approved rows are bound; other ambiguous same-name rows remain untouched.  
**Result:** ☐ PASS  ☐ FAIL  ☐ NOT RUN  
**Evidence / notes:** ______________________________
