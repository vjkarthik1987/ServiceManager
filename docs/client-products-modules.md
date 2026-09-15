# Client Product & Module Availability

v5.02 adds product and module availability at the client node level.

Each client can use one of two modes:

- `inherit`: use the parent client's effective product and module availability.
- `custom`: select products and optional modules directly for this client.

The configuration is intentionally independent of issue types and SLA. This keeps the model clean:

- Issue types decide what can be raised.
- Workflows decide how a Level 2 issue type moves.
- SLA policies decide response and resolution commitments.
- Products and modules describe the operational/product context available for a client.
