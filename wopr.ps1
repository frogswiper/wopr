# Start the W.O.P.R. server (if it is not running) and open it full screen in its own browser window.
# Windows counterpart of the 'wopr' shell launcher. The installer's shortcuts run it hidden:
#   powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File wopr.ps1
$ErrorActionPreference = 'Continue'
$Dir = $PSScriptRoot

# Config written by install.ps1: WOPR_MODEL, WOPR_NODE, WOPR_PORT, OLLAMA_URL ...
$Conf = Join-Path $env:APPDATA 'wopr\wopr.env'
if (Test-Path $Conf) {
  foreach ($l in Get-Content $Conf) {
    if ($l -match '^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { Set-Item -Path ("Env:" + $Matches[1]) -Value $Matches[2].Trim() }
  }
}
$Port = '1983'; if ($env:WOPR_PORT) { $Port = $env:WOPR_PORT }
$Url = "http://127.0.0.1:$Port/"
$Node = 'node'; if ($env:WOPR_NODE -and (Test-Path $env:WOPR_NODE)) { $Node = $env:WOPR_NODE }
$Data = Join-Path $env:LOCALAPPDATA 'wopr'
New-Item -ItemType Directory -Force -Path $Data | Out-Null
$Log = Join-Path $Data 'wopr.log'

function Test-Up {
  try { $null = Invoke-WebRequest -UseBasicParsing -Uri "$($Url)wopr.json" -TimeoutSec 2 -ErrorAction Stop; return $true } catch { return $false }
}

if (-not (Test-Up)) {
  # node runs hidden under cmd so its output can go to the log file.
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:ComSpec
  $psi.Arguments = "/d /c `"`"$Node`" `"$(Join-Path $Dir 'server.js')`" > `"$Log`" 2>&1`""
  $psi.WorkingDirectory = $Dir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  [void][System.Diagnostics.Process]::Start($psi)
  for ($i = 0; $i -lt 40 -and -not (Test-Up); $i++) { Start-Sleep -Milliseconds 250 }
}

# Full-screen kiosk window with its own browser profile and audio allowed without a click.
# Leave with Esc (logs off) or Alt+F4.  WOPR_BROWSER=default opens a normal tab instead.
function Find-Browser {
  $c = @(
    (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:ProgramFiles 'BraveSoftware\Brave-Browser\Application\brave.exe'),
    (Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\Application\brave.exe')
  )
  foreach ($p in $c) { if ($p -and (Test-Path $p)) { return $p } }
  return $null
}
$Browser = $null
if ($env:WOPR_BROWSER -ne 'default') { $Browser = Find-Browser }
if ($Browser) {
  $Prof = Join-Path $Data 'browser-profile'
  $a = @("--user-data-dir=`"$Prof`"", '--no-first-run', '--no-default-browser-check',
         '--autoplay-policy=no-user-gesture-required', '--disable-features=Translate', '--kiosk', $Url)
  if ($Browser -like '*msedge.exe') { $a += '--edge-kiosk-type=fullscreen' }
  Start-Process -FilePath $Browser -ArgumentList $a
} else {
  Start-Process $Url
}
