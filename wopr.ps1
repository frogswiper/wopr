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

# ---------- updates (installed copies only: the installer writes .version) ----------
if ($args -contains '--update') { & (Join-Path $Dir 'update.ps1'); return }
$Staged = Join-Path $Data 'staged'

function Test-Up {
  try { $null = Invoke-WebRequest -UseBasicParsing -Uri "$($Url)wopr.json" -TimeoutSec 2 -ErrorAction Stop; return $true } catch { return $false }
}

if (-not (Test-Up) -and (Test-Path (Join-Path $Dir '.version')) -and (Split-Path -Leaf $Dir) -eq 'app' -and
    (Test-Path (Join-Path $Staged 'server.js'))) {
  # A newer version was downloaded in the background last time. Nothing is running: switch to it.
  Set-Location $Data
  $old = Join-Path $Data 'app.old'
  try {
    if (Test-Path $old) { Remove-Item $old -Recurse -Force -ErrorAction Stop }
    Rename-Item -Path $Dir -NewName 'app.old' -ErrorAction Stop
    try { Rename-Item -Path $Staged -NewName 'app' -ErrorAction Stop } catch { Rename-Item -Path $old -NewName 'app'; throw }
    Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue
  } catch { Add-Content -Path $Log -Value "update not applied yet (will retry next start): $($_.Exception.Message)" -ErrorAction SilentlyContinue }
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

# Full-screen kiosk window with its own browser profile, audio allowed without a click and location
# allowed for this page only. Leave with Esc or Alt+F4.
#   WOPR_BROWSER = auto (Chrome, else Edge, else Brave) | chrome | edge | brave | default (normal tab)
function Find-Browser($want) {
  $all = [ordered]@{
    chrome = @((Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
               (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
               (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe'))
    edge   = @((Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
               (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'))
    brave  = @((Join-Path $env:ProgramFiles 'BraveSoftware\Brave-Browser\Application\brave.exe'),
               (Join-Path $env:LOCALAPPDATA 'BraveSoftware\Brave-Browser\Application\brave.exe'))
  }
  $order = @('chrome', 'edge', 'brave')
  if ($want -and $all.Contains($want)) { $order = @($want) + ($order | Where-Object { $_ -ne $want }) }
  foreach ($k in $order) { foreach ($p in $all[$k]) { if ($p -and (Test-Path $p)) { return $p } } }
  return $null
}
$Want = ''; if ($env:WOPR_BROWSER) { $Want = $env:WOPR_BROWSER.ToLower() }
$Browser = $null
if ($Want -ne 'default') { $Browser = Find-Browser $Want }
if ($Browser) {
  $Prof = Join-Path $Data 'browser-profile'
  $Pref = Join-Path $Prof 'Default\Preferences'
  $utf8 = New-Object System.Text.UTF8Encoding $false
  if (-not (Test-Path $Pref) -or (Get-Item $Pref).Length -eq 0) {
    # First run: pre-allow location for this page and skip the welcome / restore bubbles.
    New-Item -ItemType Directory -Force -Path (Join-Path $Prof 'Default') | Out-Null
    $json = '{"profile":{"exit_type":"Normal","exited_cleanly":true,"content_settings":{"exceptions":{"geolocation":{"http://127.0.0.1:' + $Port +
            ',*":{"setting":1}}}}},"browser":{"check_default_browser":false,"has_seen_welcome_page":true},"translate":{"enabled":false}}'
    [IO.File]::WriteAllText($Pref, $json, $utf8)
  } else {
    $txt = [IO.File]::ReadAllText($Pref)
    $fixed = $txt.Replace('"exit_type":"Crashed"', '"exit_type":"Normal"').Replace('"exited_cleanly":false', '"exited_cleanly":true')
    if ($fixed -ne $txt) { [IO.File]::WriteAllText($Pref, $fixed, $utf8) }
  }
  $a = @("--user-data-dir=`"$Prof`"", '--no-first-run', '--no-default-browser-check',
         '--autoplay-policy=no-user-gesture-required', '--disable-features=Translate', '--disable-session-crashed-bubble',
         '--kiosk', $Url)
  if ($Browser -like '*msedge.exe') { $a += '--edge-kiosk-type=fullscreen' }
  Start-Process -FilePath $Browser -ArgumentList $a
} else {
  Start-Process $Url
}

# Look for a newer version in the background; it is only switched in at the next start.
if ((Test-Path (Join-Path $Dir '.version')) -and $env:WOPR_AUTO_UPDATE -ne '0') {
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  Start-Process -FilePath $ps -WorkingDirectory $Data -WindowStyle Hidden -ArgumentList '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$(Join-Path $Dir 'update.ps1')`"", '--stage'
}
