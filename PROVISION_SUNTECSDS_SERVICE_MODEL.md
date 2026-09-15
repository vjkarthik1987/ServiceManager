# Legacy provisioner note

The earlier `provision:suntecsds-service-model` command is retained only for backward compatibility with older UAT workspaces.

For Service Desk v20.2 and the cloud workspace slug `suntec`, use the unified bootstrap instead:

```powershell
npm run bootstrap:suntec
npm run bootstrap:suntec -- --apply
```

See `docs/suntec-cloud-bootstrap.md` for the full baseline created by the command.
