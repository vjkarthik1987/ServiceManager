# Upgrade to Service Desk v19.7

1. Extract v19.7 into a new folder.
2. Copy the `.env` file from the current installation.
3. Run `npm install`.
4. Start with `npm run dev`.

No database migration command is required. Existing requests receive human-readable task IDs lazily when they are opened or when the Tasks workspace is loaded.

## Main changes

- Add User opens immediately on the first click.
- New issue families and subtypes appear first; family rows are collapsed by default and retain their expanded state.
- Every issue family has a dedicated detail page.
- Workflow Studio is searchable and tabular, with a full-screen workflow editor.
- Existing workflow statuses can be renamed, reordered, hidden from customers, or safely deactivated.
- Transition matrix row and column headers highlight on hover, focus, and selection.
- Request tasks receive IDs such as `EXABAN-01021-T001`.
- Tasks have a global queue, dedicated detail page, assignment, status, priority, due date, comments, attachments, and activity history.
