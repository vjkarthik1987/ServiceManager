# Client Hierarchy - v5

v5 treats every client as a node in a hierarchy.

```txt
Organization
  → Client
      → Child Client
          → Child Client
```

## Client code

Every client has a short code that is:

- exactly 6 letters
- uppercase
- unique within the organization
- auto-suggested while typing the client name
- editable before saving

The backend enforces uniqueness with a compound index on organization and short code.

## Inheritance

Child clients can inherit or customize:

- Level 1 issue type availability
- Default SLA policy

Root clients cannot inherit because they have no parent.

## Issue type availability

Clients are tagged with Level 1 issue types only.

Level 2 issue types remain under their Level 1 parents and continue to own workflow assignment. During intake, the selected client controls which Level 1 cards appear. The chosen Level 1 then reveals its active Level 2 options.
