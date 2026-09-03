param(
  [Parameter(Position=0)]
  [ValidateSet('preflight','dry-run','verify','test','apply-db','status')]
  [string]$Command = 'status',
  [string]$ApproveBindings = '',
  [string]$MongoUri = '',
  [string]$TaxonomyCollection = '',
  [switch]$MigrateOpenSaasRequests
)

$ErrorActionPreference = 'Stop'

function Run-Node([string[]]$Args) {
  & node @Args
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

function Mongo-Args {
  $items = @()
  if ($MongoUri) { $items += "--mongo-uri=$MongoUri" }
  if ($TaxonomyCollection) { $items += "--taxonomy-collection=$TaxonomyCollection" }
  return $items
}

if (-not (Test-Path '.\package.json')) {
  Write-Error 'Run V23.ps1 from the Service Manager application root (the folder containing package.json).'
}

switch ($Command) {
  'status' {
    $version = node -p "require('./package.json').version"
    Write-Host "Service Manager version: $version"
    Write-Host 'Safe sequence:'
    Write-Host '  .\V23.ps1 preflight'
    Write-Host '  .\V23.ps1 dry-run'
    Write-Host '  .\V23.ps1 verify'
    Write-Host '  .\V23.ps1 apply-db -ApproveBindings "collection:id,..."   # only after dry-run review'
  }
  'preflight' {
    $args = @('scripts/v23-preflight.mjs') + (Mongo-Args | Where-Object { $_ -like '--mongo-uri=*' })
    Run-Node $args
  }
  'dry-run' {
    $args = @('scripts/provision-v23-saas-service-model.mjs','--dry-run') + (Mongo-Args)
    Run-Node $args
  }
  'verify' {
    & npm.cmd run verify:v23-guard
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    & npm.cmd run v23:test
    exit $LASTEXITCODE
  }
  'test' {
    & npm.cmd run v23:test
    exit $LASTEXITCODE
  }
  'apply-db' {
    if (-not $ApproveBindings) {
      Write-Error 'apply-db requires -ApproveBindings with the exact collection:id values reviewed in the dry-run. No name-based bulk apply is allowed.'
    }
    $args = @('scripts/provision-v23-saas-service-model.mjs','--apply',"--approve-bindings=$ApproveBindings") + (Mongo-Args)
    if ($MigrateOpenSaasRequests) { $args += '--migrate-open-saas-requests' }
    Run-Node $args
  }
}
