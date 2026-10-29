$ErrorActionPreference = 'Stop'
function Invoke-AcceptanceWrangler {
  & npx.cmd --yes wrangler@4.154.0 @args
  if ($LASTEXITCODE -ne 0) { throw 'Wrangler failed; do not mark cleanup as passed.' }
}
New-Item -ItemType Directory -Force './acceptance-media/private' | Out-Null
node scripts/prepare-main-cleanup.mjs
if ($LASTEXITCODE -ne 0) { throw 'Preparation failed.' }
$config = './acceptance-media/private/main-cleanup.jsonc'
$existing = Invoke-AcceptanceWrangler d1 execute DB --remote --config $config --json --command "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='media_jobs'"
$check = @(($existing -join "`n" | ConvertFrom-Json) | ForEach-Object { $_.results })
if ($check.Count -ne 1 -or $check[0].n -ne 0) { throw 'Main-media test tables already exist in drill DB. Stop to preserve existing evidence; do not rerun import.' }
Invoke-AcceptanceWrangler d1 execute DB --remote --config $config --file './acceptance-media/private/main-cleanup.sql' --yes
try {
  Invoke-AcceptanceWrangler deploy --config $config
  $passed = $false
  for ($i=1; $i -le 20; $i++) {
    Start-Sleep -Seconds 60
    $raw = Invoke-AcceptanceWrangler d1 execute DB --remote --config $config --json --command 'SELECT state FROM acceptance_cleanup_receipt WHERE id=1'
    $rows = @(($raw -join "`n" | ConvertFrom-Json) | ForEach-Object { $_.results })
    if ($rows.Count -eq 1 -and $rows[0].state -eq 'passed') { $passed=$true; break }
    Write-Host "Waiting for isolated cleanup cron: $i/20"
  }
  if (!$passed) { throw 'No verified result before timeout. Do not mark passed.' }
  Write-Host 'PASS: MAIN cleanupMedia on real D1/R2 + cron; expired erased, active control preserved.' -ForegroundColor Green
} finally {
  node --input-type=module -e "import fs from 'node:fs'; const p='acceptance-media/private/main-cleanup.jsonc'; const c=JSON.parse(fs.readFileSync(p,'utf8')); c.vars.CLEANUP_ACCEPTANCE_ENABLED='false'; c.triggers={crons:[]}; fs.writeFileSync(p,JSON.stringify(c,null,2));"
  if ($LASTEXITCODE -ne 0) { throw 'Local shutdown config failed.' }
  Invoke-AcceptanceWrangler deploy --config $config
  Write-Host 'Cleanup acceptance disabled; cron removed.'
}
