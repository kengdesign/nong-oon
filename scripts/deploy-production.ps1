$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
function Invoke-Wrangler {
  & npx.cmd --yes wrangler@4.154.0 @args
  if ($LASTEXITCODE -ne 0) { throw 'Wrangler failed; deployment stopped' }
}
$config = 'wrangler.production.jsonc'
& node --test tests/production.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Production configuration tests failed' }
Invoke-Wrangler d1 migrations apply DB --remote --config $config
Invoke-Wrangler deploy --config $config
# Enter credentials only in Wrangler prompts, never in screenshots or chat.
foreach ($name in @('LINE_LOGIN_CHANNEL_ID','LINE_LOGIN_CHANNEL_SECRET','LINE_CHANNEL_SECRET','LINE_CHANNEL_ACCESS_TOKEN','GOOGLE_VISION_API_KEY')) {
  Write-Host "Enter $name in the secure Wrangler prompt"
  Invoke-Wrangler secret put $name --config $config
}
$health = Invoke-RestMethod 'https://nongoon.com/health'
if ($health.status -ne 'production' -or $health.deliveryEnabled -ne $false) {
  throw 'Unexpected production health or delivery state'
}
Write-Host 'Production deployed; outbound LINE delivery remains disabled.' -ForegroundColor Green
Write-Host 'LINE Login callback: https://nongoon.com/auth/callback'
Write-Host 'Messaging API webhook: https://nongoon.com/webhook/line'
