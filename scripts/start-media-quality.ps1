$ErrorActionPreference = 'Stop'
& './scripts/setup-media-acceptance.ps1'
$required = @('image.jpg','image.txt','voice.wav','voice.txt')
foreach ($file in $required) { if (!(Test-Path (Join-Path './acceptance-media/private' $file))) { throw "Missing: acceptance-media/private/$file. Prepare files first." } }
# A separate terminal keeps the preview alive; no background deployment.
$folder = (Get-Location).Path.Replace("'", "''")
$command = "Set-Location -LiteralPath '$folder'; npx.cmd --yes wrangler@4.154.0 dev --remote --config ./acceptance-media/wrangler.jsonc --ip 127.0.0.1 --port 8798"
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
Start-Process powershell.exe -ArgumentList @('-NoProfile','-NoExit','-EncodedCommand',$encoded) | Out-Null
Write-Host 'Wait for Ready on http://127.0.0.1:8798 in the NEW PowerShell window, then run: node scripts/media-quality-run.mjs'
