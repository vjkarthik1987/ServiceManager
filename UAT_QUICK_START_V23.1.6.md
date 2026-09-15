# v23.1.6 UAT Quick Check

No UAT reseed is required for this patch.

## Recommended checks

### 1. Client Incident intake
Sign in as a Client User and raise an Application Incident.
- If the client has one enabled Issue Family, there should be no redundant Family selection step.
- The progress rail should remain on one row.
- Severity should appear as **Reported severity**.
- RCA / release / approval lifecycle fields should remain hidden.

### 2. Partner comments
Sign in as the Partner user and open the same request.
- The composer should offer **Reply to customer** and **Internal note**.
- Public reply should be visible to the customer.
- Partner internal note should be visible to Partner + SunTec, not to the Client.

### 3. SunTec internal note
Sign in as a SunTec Agent.
- Add an Internal note.
- Author name should remain readable.
- Client should not see the note in Comments or Audit trail.
- Partner should not see SunTec-only internal notes.

### 4. Severity reclassification
As Partner/Agent, change the Severity.
- Change should appear in audit history for permitted viewers.
- SLA should recalculate without resetting its original start time.
