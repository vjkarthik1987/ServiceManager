# v10 Access Model

## Identity

A user identity belongs to one organization. The organization is resolved after authentication and does not appear in the public URL.

## Client assignment

Each assignment contains:

```text
clientId
role
includeChildren
supportLevels[]
```

## Portal eligibility

```text
/admin  → organizationAdmin
/client → at least one clientUser assignment
/agent  → at least one partnerUser, agentUser, agentManager, or engagementManager assignment
```

## Request visibility

```text
clientUser  → client_visible
partnerUser → client_visible + partner_visible
agent roles → client_visible + partner_visible + internal_only
admin       → all organization requests
```

## Operational action

A non-admin user can change status or invoke a Support Path movement only when the assignment effective for the request's client contains the request's current support level.

Direct client assignments take precedence over inherited parent assignments.
