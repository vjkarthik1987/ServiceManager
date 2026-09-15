# v24.2.1 Edit Hotfix

Fixes applied to the uploaded v24.2.1 build:

- Added the missing tenant-prefixed POST route for request editing: `/:tenant/requests/:requestId/edit`.
- Kept the existing portal-prefixed edit route intact.
- Changed the Details > Edit control into a small, quiet Warm Command Minimal button.
- Made custom dropdown edit values restore from either stored `value` or `displayValue`, with whitespace/case-normalized matching.
- Added compatibility fallback for older request custom-field records (`customFields`) when `customFieldValues` is absent.
- Removed the stale v19.7 wording from the generic 404 fallback.
- Added regression tests for tenant edit routing, edit-button styling, and custom dropdown preselection.

Validation:

- Focused v24.2.1 tests: 9/9 passed.
- Full test suite: 117/117 passed.
