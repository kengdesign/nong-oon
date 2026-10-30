$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
if (Test-Path '.\acceptance-media\private\single-account\wrangler.json') {
    throw 'An isolated run already exists. Keep its evidence; do not overwrite or rerun paid OCR.'
}
node --test tests/single-account-e2e.test.mjs
if ($LASTEXITCODE -ne 0) { throw 'Local isolation tests failed' }
$suffix = (Get-Date -Format 'yyyyMMddHHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0,6))
$resource = 'nong-oon-e2e-' + $suffix
npx.cmd --yes wrangler@4.154.0 login
if ($LASTEXITCODE -ne 0) { throw 'Wrangler login failed' }
$created = & npx.cmd --yes wrangler@4.154.0 d1 create $resource
if ($LASTEXITCODE -ne 0) { throw 'Isolated D1 creation failed' }
$databaseId = [regex]::Match(($created -join "`n"), '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}').Value
if (!$databaseId) { throw 'Database UUID not found; no deployment attempted' }
npx.cmd --yes wrangler@4.154.0 r2 bucket create $resource
if ($LASTEXITCODE -ne 0) { throw 'Isolated R2 creation failed' }
node scripts/prepare-single-account-e2e.mjs $suffix $databaseId
if ($LASTEXITCODE -ne 0) { throw 'Isolated config generation failed' }
$config = '.\acceptance-media\private\single-account\wrangler.json'
npx.cmd --yes wrangler@4.154.0 d1 migrations apply E2E_DB --remote --config $config
if ($LASTEXITCODE -ne 0) { throw 'Isolated schema initialization failed' }
npx.cmd --yes wrangler@4.154.0 d1 execute E2E_DB --remote --config $config --command 'CREATE TABLE IF NOT EXISTS single_account_e2e(id TEXT PRIMARY KEY,state TEXT NOT NULL,report_json TEXT);'
if ($LASTEXITCODE -ne 0) { throw 'Isolated evidence table initialization failed' }
try {
npx.cmd --yes wrangler@4.154.0 deploy --config $config
if ($LASTEXITCODE -ne 0) { throw 'Initial isolated worker deployment failed' }
Write-Host 'Enter the Google Vision API key only into the Wrangler secret prompt. Do not paste it into chat.'
npx.cmd --yes wrangler@4.154.0 secret put GOOGLE_VISION_API_KEY --config $config
if ($LASTEXITCODE -ne 0) { throw 'Isolated Vision secret setup failed' }
npx.cmd --yes wrangler@4.154.0 deploy --config $config
if ($LASTEXITCODE -ne 0) { throw 'Isolated worker deployment failed' }
$report = $null
    for ($attempt=1; $attempt -le 75; $attempt++) {
        Write-Host "Waiting for isolated cron/evidence ($attempt/75)..."
        Start-Sleep -Seconds 20
        $raw = & npx.cmd --yes wrangler@4.154.0 d1 execute E2E_DB --remote --config $config --command "SELECT state,report_json FROM single_account_e2e WHERE id='single-account-v1';" --json 2>$null
        if ($LASTEXITCODE -ne 0) { continue }
        try {
            $text = ($raw -join "`n")
            $start = $text.IndexOf('[')
            $end = $text.LastIndexOf(']')
            if ($start -lt 0 -or $end -lt $start) { continue }
            $parsed = ConvertFrom-Json -InputObject $text.Substring($start, $end-$start+1)
            $row = @($parsed | ForEach-Object { $_.results } | Where-Object { $_.state -in @('passed','failed') }) | Select-Object -First 1
            if ($row) { $report = $row.report_json | ConvertFrom-Json; break }
        } catch { continue }
    }
} finally {
    # Disable this disposable worker's cron only. Main staging is never addressed.
    $settings = Get-Content -LiteralPath $config -Raw | ConvertFrom-Json
    $settings.triggers.crons = @()
    $settings | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath $config -Encoding UTF8
    npx.cmd --yes wrangler@4.154.0 deploy --config $config
    if ($LASTEXITCODE -ne 0) { Write-Warning "Stop cron manually for worker $resource" }
}
if (!$report) { throw "No terminal evidence. Inspect isolated worker $resource; do not rerun paid OCR blindly." }
$report | ConvertTo-Json -Depth 8 | Set-Content '.\acceptance-media\private\single-account\report.json' -Encoding UTF8
$report | ConvertTo-Json -Depth 8
if ($report.state -ne 'passed') { throw 'Isolated E2E failed; report retained' }
