$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$source = '.\wrangler.line-postback-pilot.jsonc'
if (!(Test-Path $source)) { throw 'Missing last successful production config: wrangler.line-postback-pilot.jsonc' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item $source "$source.backup-$stamp"
node.exe scripts/configure-phase3.mjs $source '.\wrangler.phase3-paused.jsonc' paused
if ($LASTEXITCODE -ne 0) { throw 'Config validation failed' }
node.exe scripts/configure-phase3.mjs $source '.\wrangler.phase3.jsonc' active
if ($LASTEXITCODE -ne 0) { throw 'Config preparation failed' }
npm.cmd run check
if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed' }
npm.cmd test
if ($LASTEXITCODE -ne 0) { throw 'Tests failed; production unchanged' }
npx.cmd --yes wrangler@4.154.0 login
if ($LASTEXITCODE -ne 0) { throw 'Login failed' }
npx.cmd --yes wrangler@4.154.0 deploy --config '.\wrangler.phase3.jsonc' --dry-run
if ($LASTEXITCODE -ne 0) { throw 'Dry run failed' }
$backup = ".\phase3-d1-backup-$stamp.sql"
npx.cmd --yes wrangler@4.154.0 d1 export DB --remote --config $source --output $backup
if ($LASTEXITCODE -ne 0) { throw 'D1 backup failed; production unchanged' }
# Stop scheduling briefly while changing the outbox schema. On failure it stays paused.
npx.cmd --yes wrangler@4.154.0 deploy --config '.\wrangler.phase3-paused.jsonc'
if ($LASTEXITCODE -ne 0) { throw 'Pause deployment failed' }
$raw = & npx.cmd --yes wrangler@4.154.0 d1 execute DB --remote --config '.\wrangler.phase3-paused.jsonc' --command 'PRAGMA table_info(notification_outbox)' --json
if ($LASTEXITCODE -ne 0) { throw 'Schema inspection failed; delivery remains paused' }
$schema = ($raw -join "`n") | ConvertFrom-Json
if (!($schema | Where-Object { $_.success -eq $true })) { throw 'Unexpected schema result; delivery remains paused' }
$columns = @($schema | ForEach-Object { $_.results } | ForEach-Object { $_.name })
if ($columns -notcontains 'id') { throw 'Outbox missing; delivery remains paused' }
if ($columns -notcontains 'generation') {
    npx.cmd --yes wrangler@4.154.0 d1 execute DB --remote --config '.\wrangler.phase3-paused.jsonc' --file '.\migrations\0011_phase3_snooze.sql'
    if ($LASTEXITCODE -ne 0) { throw 'Migration failed; delivery remains paused. Keep the D1 backup.' }
}
npx.cmd --yes wrangler@4.154.0 deploy --config '.\wrangler.phase3.jsonc'
if ($LASTEXITCODE -ne 0) { throw 'Activation failed; do not delete the backup' }
# Future patches use the continuous production config rather than the expired pilot.
Copy-Item '.\wrangler.phase3.jsonc' $source -Force
$health = Invoke-RestMethod 'https://nongoon.com/health'
if ($health.status -ne 'production' -or $health.deliveryEnabled -ne $true) { throw 'Deployment finished but live delivery health is not confirmed' }
Write-Host 'Phase 3 deployed: continuous delivery, 15-minute snooze, 30-minute caregiver alert.' -ForegroundColor Green
Write-Host 'Caregivers must accept an owner invite; active caregiver membership is checked before each push. Schedule end dates are unchanged.'
Write-Host 'Keep the local D1 backup private. Close LIFF and reopen from the LINE Rich Menu.'
