# v12 — Tenant Login Routing

v12 corrects the public login model.

## Public login routes

Tenant users log in through their tenant workspace URL:

```txt
/:tenant/login
```

Examples:

```txt
/sbs/login
/suntec/login
```

This single tenant login supports contextual users inside the tenant:

- clientUser
- partnerUser
- agentUser
- agentManager
- engagementManager

The tenant slug comes from the URL. After successful login, the app chooses the right working portal from the user's assignments. Agent/partner/manager assignments take the user into the agent-style workspace; client-only assignments take the user into the client-style workspace.

Admin users log in centrally:

```txt
/admin/login
```

The admin login asks for:

- tenant
- email
- password

## Canonical routes

Tenant portal routes:

```txt
/:tenant/home
/:tenant/requests
/:tenant/requests/new
/:tenant/requests/:id
```

Admin routes:

```txt
/admin/home
/admin/clients
/admin/users
/admin/issue-types
/admin/workflows
/admin/support-paths
/admin/sla
/admin/requests
```

## Reserved slugs

The following tenant slugs are reserved and cannot be used as tenant workspace slugs:

```txt
admin, agent, client, api, assets, static, login, logout, health, setup, session
```

This prevents `/admin/login` from being confused with a tenant named `admin`.
