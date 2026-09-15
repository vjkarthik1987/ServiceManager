# Service Desk v3.01

Service Desk v3.01 fixes workflow assignment validation and makes workflow assignment simpler with searchable popup pickers.

## What is new in v3.01

- Independent reusable workflow library.
- Create workflows with name, mandatory description, and status path.
- Add workflow statuses with internal status, client-visible label, status type, and visibility flag.
- Configure allowed transitions using a visual transition matrix.
- Transitions can move forward, backward, hold, reopen, or cancel.
- Assign a workflow to any Level 2 issue type.
- One workflow can be reused by many Level 2 issue types.
- Workflow usage warning: changes affect all assigned Level 2 issue types.
- Client intake preview now shows workflow names under enabled Level 2 subtypes.


## v3.01 fixes

- Fixed workflow assignment failing when older Level 2 issue types do not have mandatory descriptions.
- Assignment now uses targeted updates instead of full document saves.
- Workflow card now has an **Assign issue types** popup.
- Popup supports searchable multi-select of Level 2 issue types.
- Issue Type Studio assignment popup now uses a searchable workflow picker instead of a plain dropdown.

## Tech stack

- Node.js 22+
- Express
- EJS
- MongoDB / Mongoose
- Microservice-style folders
- No Docker
- No nodemon; uses Node 22 `--watch`

## Services

- `apps/web` - Web gateway and EJS UI.
- `services/organization-service` - Organizations, issue types, clients, workflows.
- `services/identity-service` - Admin users.

## Run locally

```bash
cp .env.example .env
npm install
npm run dev
```

Open:

```txt
http://localhost:3000
```

Make sure MongoDB is running locally or update `MONGODB_URI` in `.env`.

## Suggested demo flow

1. Create organization.
2. Go to Issue Types.
3. Add World 1 sample or Word-doc sample.
4. Go to Workflows.
5. Add Normal / Approval / Incident / Maintenance presets.
6. Open a workflow and adjust transitions.
7. Assign workflows either from the Workflow card popup or from the Level 2 issue type popup.
8. Create a client.
9. Enable Level 1 and Level 2 types for the client.
10. Preview intake.

## Design note

The UI continues the Warm Command Minimal style: warm white, charcoal, deep green, soft yellow, sand borders, rounded cards, and less visual noise.
