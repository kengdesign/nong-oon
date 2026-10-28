$ErrorActionPreference = 'Stop'
if (!(Test-Path './acceptance-media/wrangler.jsonc')) { throw 'Run from the Phase 2 project folder.' }
New-Item -ItemType Directory -Force './acceptance-media/private' | Out-Null
$ignore = @('acceptance-media/private/', 'acceptance-media/.dev.vars', 'acceptance-media/.wrangler/')
foreach ($line in $ignore) {
  if (!(Test-Path '.gitignore') -or !(Select-String -LiteralPath '.gitignore' -SimpleMatch -Pattern $line -Quiet)) { Add-Content -LiteralPath '.gitignore' -Value $line }
}
if (!(Test-Path './acceptance-media/.dev.vars')) {
  $key = Read-Host 'Google Vision API key (input hidden; leave blank to test voice only)' -AsSecureString
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($key)
  try { $plain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
  if ($plain -and $plain -notmatch '^[A-Za-z0-9_-]+$') { throw 'Invalid API key format.' }
  $token = [Guid]::NewGuid().ToString('N') + [Guid]::NewGuid().ToString('N')
  $text = 'ACCEPTANCE_TOKEN="' + $token + '"' + "`n" + 'GOOGLE_VISION_API_KEY="' + $plain + '"' + "`n"
  [IO.File]::WriteAllText((Join-Path (Get-Location) 'acceptance-media/.dev.vars'), $text, (New-Object Text.UTF8Encoding($false)))
  $plain = $null; $text = $null
}
Write-Host 'READY. Put image.jpg + image.txt and voice.wav + voice.txt in acceptance-media/private.'
Write-Host 'Use a photographed fictional Thai label and spoken fictional Thai text. No personal or real medication information.'
