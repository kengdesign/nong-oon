$ErrorActionPreference = 'Stop'
Set-Location (Split-Path $PSScriptRoot -Parent)
$configPath = Join-Path (Get-Location) 'wrangler.line-postback-pilot.jsonc'
if (!(Test-Path -LiteralPath $configPath)) { throw 'Use the project folder from the successful Phase 3 deployment. Existing config is required.' }
$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($config.name -ne 'nong-oon-production' -or $config.vars.APP_ENV -ne 'production' -or $config.vars.APP_ORIGIN -ne 'https://nongoon.com') { throw 'Wrong production target' }
foreach ($name in @('SCHEDULER_ENABLED','DELIVERY_ENABLED','SNOOZE_ENABLED','CAREGIVER_DELIVERY_ENABLED')) {
    if ($config.vars.$name -ne 'true') { throw "Phase 3 must already be active: $name" }
}
if ($config.vars.DELIVERY_STOP_AT) { throw 'An expiring config was selected. Use the current Phase 3 config.' }
$configHash = (Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash
npm.cmd run check
if ($LASTEXITCODE -ne 0) { throw 'Syntax check failed; no deployment performed' }
node --test --test-concurrency=1
if ($LASTEXITCODE -ne 0) { throw 'Tests failed; no deployment performed' }
npx.cmd --yes wrangler@4.154.0 login
if ($LASTEXITCODE -ne 0) { throw 'Login failed' }
npx.cmd --yes wrangler@4.154.0 deploy --dry-run --config $configPath
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
if ((Get-FileHash -LiteralPath $configPath -Algorithm SHA256).Hash -ne $configHash) { throw 'Config changed during checks. No deployment performed.' }
npx.cmd --yes wrangler@4.154.0 deploy --config $configPath
if ($LASTEXITCODE -ne 0) { throw 'Deployment failed' }
$health = Invoke-RestMethod 'https://nongoon.com/health'
if ($health.status -ne 'production' -or $health.deliveryEnabled -ne $true) { throw 'Deployment completed but production health needs review' }
Write-Host 'UI feedback fix and Thai voice/OCR improvements deployed.' -ForegroundColor Green
Write-Host 'Existing Phase 3 config was preserved. No database migration was run.'
Write-Host 'Close LIFF and reopen from LINE Rich Menu. Check family -> cancel unused invite -> rounds.'
