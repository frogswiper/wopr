# W.O.P.R. installer for Windows 10 / 11
#   irm https://raw.githubusercontent.com/frogswiper/wopr/main/install.ps1 | iex
#
# 1. installs Ollama if it is missing (winget, or the official OllamaSetup.exe)
# 2. makes sure the Ollama server is running
# 3. signs in to ollama.com (cloud models need an account)
# 4. finds the newest GLM cloud model on ollama.com and pulls it (e.g. glm-5.3:cloud)
# 5. sets up the espeak-ng voice synthesizer (unpacked without admin rights when possible)
# 6. uses Node.js 18+ if installed, otherwise a private checksum-verified Node 22 (no admin)
# 7. downloads W.O.P.R., adds Start Menu + desktop shortcuts and the `wopr` command, starts it
#
# Options: set them first, e.g.  $env:WOPR_MODEL = 'glm-5.2:cloud'; irm ... | iex
#   WOPR_MODEL  WOPR_PORT (1983)  WOPR_NO_LAUNCH=1  WOPR_BRANCH (main)  WOPR_NO_ESPEAK=1
# No administrator rights are needed (the Ollama installer may ask on some systems).

& {
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

function Say($m) { Write-Host '> ' -NoNewline -ForegroundColor White; Write-Host $m }
function Ok($m)  { Write-Host '  ... OK ' -NoNewline -ForegroundColor Cyan; Write-Host $m }
function Note($m) { Write-Host "  $m" -ForegroundColor DarkGray }
function Die($m) { throw $m }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Test-Url($u) {
  try { $null = Invoke-WebRequest -UseBasicParsing -Uri $u -TimeoutSec 3 -ErrorAction Stop; return $true } catch { return $false }
}
function Get-File($url, $out) { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $out -ErrorAction Stop }

try {
  Write-Host @'
  __        __    ___     ____     ____
  \ \      / /   / _ \   |  _ \   |  _ \
   \ \ /\ / /   | | | |  | |_) |  | |_) |
    \ V  V /  _ | |_| |_ |  __/ _ |  _ < _
     \_/\_/  (_) \___/(_)|_|   (_)|_| \_(_)
'@ -ForegroundColor Cyan
  Write-Host "  WAR OPERATION PLAN RESPONSE  //  NORAD  //  WINDOWS INSTALLER`n" -ForegroundColor DarkGray

  $Repo = 'frogswiper/wopr'
  $Branch = 'main'; if ($env:WOPR_BRANCH) { $Branch = $env:WOPR_BRANCH }
  $Fallback = 'glm-5.3:cloud'
  $Data = Join-Path $env:LOCALAPPDATA 'wopr'
  $App = Join-Path $Data 'app'
  $ConfDir = Join-Path $env:APPDATA 'wopr'
  $OllamaUrl = 'http://127.0.0.1:11434'; if ($env:OLLAMA_URL) { $OllamaUrl = $env:OLLAMA_URL }
  if (-not [Environment]::Is64BitOperatingSystem) { Die '64-bit Windows is required' }
  $arch = 'x64'
  if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { $arch = 'arm64' }
  New-Item -ItemType Directory -Force -Path $Data, $ConfDir | Out-Null

  # ---------- 1. Ollama ----------
  Say 'CHECKING OLLAMA RUNTIME'
  $OllamaDir = Join-Path $env:LOCALAPPDATA 'Programs\Ollama'
  Refresh-Path
  if (-not (Get-Command ollama -ErrorAction SilentlyContinue) -and (Test-Path (Join-Path $OllamaDir 'ollama.exe'))) { $env:Path += ";$OllamaDir" }
  if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Say 'OLLAMA NOT FOUND - INSTALLING'
    $done = $false
    if (Get-Command winget -ErrorAction SilentlyContinue) {
      & winget install -e --id Ollama.Ollama --accept-source-agreements --accept-package-agreements --silent
      $done = ($LASTEXITCODE -eq 0)
    }
    if (-not $done) {
      $setup = Join-Path $env:TEMP 'OllamaSetup.exe'
      Note 'downloading OllamaSetup.exe from ollama.com ...'
      Get-File 'https://ollama.com/download/OllamaSetup.exe' $setup
      Start-Process -FilePath $setup -ArgumentList '/VERYSILENT', '/NORESTART', '/SUPPRESSMSGBOXES' -Wait
      Remove-Item $setup -Force -ErrorAction SilentlyContinue
    }
    Refresh-Path
    if (Test-Path (Join-Path $OllamaDir 'ollama.exe')) { $env:Path += ";$OllamaDir" }
    if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) { Die 'Ollama install failed - install it from https://ollama.com/download and run this again' }
  }
  Ok ((& ollama --version 2>$null) | Select-Object -First 1)

  # ---------- 2. Ollama server ----------
  Say "DIALING $OllamaUrl"
  if (-not (Test-Url "$OllamaUrl/api/version")) {
    $tray = Join-Path $OllamaDir 'ollama app.exe'
    if (Test-Path $tray) { Start-Process -FilePath $tray } else { Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden }
    for ($i = 0; $i -lt 60 -and -not (Test-Url "$OllamaUrl/api/version"); $i++) { Start-Sleep -Milliseconds 500 }
  }
  if (-not (Test-Url "$OllamaUrl/api/version")) { Die "Ollama server is not answering on $OllamaUrl" }
  Ok 'CONNECT 1200'

  # ---------- 3. Sign in ----------
  Say 'LOGON: ollama.com (cloud models need an account)'
  Note 'If a link is shown, open it in a browser, approve, and this continues.'
  & ollama signin
  if ($LASTEXITCODE -ne 0) { Die "ollama signin failed - run 'ollama signin' and run this installer again" }
  Ok 'IDENTIFICATION ACCEPTED'

  # ---------- 4. Newest GLM cloud model ----------
  Say 'LOCATING NEWEST GLM CLOUD STRATEGY MODULE'
  if ($env:WOPR_MODEL) { $Model = $env:WOPR_MODEL } else {
    $latest = $null
    try {
      $html = (Invoke-WebRequest -UseBasicParsing -Uri 'https://ollama.com/search?c=cloud&q=glm' -TimeoutSec 20 -ErrorAction Stop).Content
      $names = [regex]::Matches($html, 'href="/library/(glm-[0-9]+(?:\.[0-9]+)*)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique
      $latest = $names | Sort-Object { $v = $_.Substring(4); if ($v -notmatch '\.') { $v += '.0' }; [version]$v } | Select-Object -Last 1
    } catch { $latest = $null }
    if ($latest) { $Model = "${latest}:cloud" } else { $Model = $Fallback }
  }
  Ok $Model
  Say "PULLING $Model"
  & ollama pull $Model
  if ($LASTEXITCODE -ne 0) {
    if ($Model -eq $Fallback) { Die "could not pull $Model" }
    Say "PULL FAILED - FALLING BACK TO $Fallback"
    $Model = $Fallback
    & ollama pull $Model
    if ($LASTEXITCODE -ne 0) { Die "could not pull $Model" }
  }
  Ok 'MODULE READY'

  # ---------- Voice synthesizer (Joshua) ----------
  Say 'CHECKING VOICE SYNTHESIZER'
  $Espeak = $null; $EspeakData = $null
  function Find-Espeak($root) {
    if (-not $root -or -not (Test-Path $root)) { return $null }
    Get-ChildItem -Path $root -Recurse -Filter 'espeak-ng.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
  }
  # Returns @{ exe; data } when this espeak-ng.exe runs, otherwise $null.
  function Use-Espeak($exe) {
    if (-not $exe) { return $null }
    $dir = Split-Path -Parent $exe
    $data = $null
    if (Test-Path (Join-Path $dir 'espeak-ng-data')) { $data = $dir }
    $old = $env:ESPEAK_DATA_PATH
    if ($data) { $env:ESPEAK_DATA_PATH = $data }
    # A real test: speak one word into a file (fails if the voice data cannot be found).
    $wav = Join-Path $env:TEMP 'wopr-espeak-test.wav'
    Remove-Item $wav -Force -ErrorAction SilentlyContinue
    $null = & $exe -w $wav 'test' 2>$null
    $good = (Test-Path $wav) -and ((Get-Item $wav).Length -gt 100)
    Remove-Item $wav -Force -ErrorAction SilentlyContinue
    $env:ESPEAK_DATA_PATH = $old
    if ($good) { return @{ exe = $exe; data = $data } }
    return $null
  }
  function Try-Espeak($list) {
    foreach ($k in $list) { if ($k -and (Test-Path $k)) { $r = Use-Espeak $k; if ($r) { return $r } } }
    return $null
  }
  $local = Join-Path $Data 'espeak-ng'
  $known = @(
    (Get-Command espeak-ng -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1),
    (Join-Path $env:ProgramFiles 'eSpeak NG\espeak-ng.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'eSpeak NG\espeak-ng.exe'),
    ((Find-Espeak $local) | Select-Object -ExpandProperty FullName -First 1)
  )
  $found = Try-Espeak $known
  if (-not $found -and -not $env:WOPR_NO_ESPEAK) {
    try {
      # Newest espeak-ng release that ships a Windows installer (.msi).
      $rels = Invoke-RestMethod -Uri 'https://api.github.com/repos/espeak-ng/espeak-ng/releases?per_page=10' -ErrorAction Stop
      $asset = $null
      foreach ($r in $rels) {
        $msis = @($r.assets | Where-Object { $_.name -match '\.msi$' -and $_.name -notmatch 'x86|arm' })
        if ($msis.Count) { $asset = ($msis | Sort-Object { if ($_.name -match 'x64') { 0 } else { 1 } } | Select-Object -First 1); break }
      }
      if (-not $asset) { throw 'no Windows release found' }
      $msi = Join-Path $env:TEMP $asset.name
      Note "downloading $($asset.name) from github.com/espeak-ng ..."
      Get-File $asset.browser_download_url $msi
      # Unpack without installing (no administrator rights needed).
      if (Test-Path $local) { Remove-Item $local -Recurse -Force }
      New-Item -ItemType Directory -Force -Path $local | Out-Null
      Start-Process -FilePath 'msiexec.exe' -ArgumentList '/a', "`"$msi`"", '/qn', "TARGETDIR=`"$local`"" -Wait
      $exe = Find-Espeak $local
      if ($exe) { $found = Use-Espeak $exe.FullName }
      if (-not $found) {
        Note 'unpacking failed - installing espeak-ng normally (Windows will ask for permission)'
        try { Start-Process -FilePath 'msiexec.exe' -ArgumentList '/i', "`"$msi`"", '/qn' -Verb RunAs -Wait } catch { Note 'permission declined' }
        $found = Try-Espeak @((Join-Path $env:ProgramFiles 'eSpeak NG\espeak-ng.exe'), (Join-Path ${env:ProgramFiles(x86)} 'eSpeak NG\espeak-ng.exe'))
      }
      Remove-Item $msi -Force -ErrorAction SilentlyContinue
    } catch { Note "espeak-ng setup failed: $($_.Exception.Message)" }
  }
  if ($found) { $Espeak = $found.exe; $EspeakData = $found.data }
  if ($Espeak) { Ok $Espeak } else { Ok "espeak-ng not installed - Joshua will use Windows' own speech voices instead" }

  # ---------- Node.js ----------
  Say 'CHECKING NODE.JS (18+)'
  $NodeExe = $null
  $sys = Get-Command node -ErrorAction SilentlyContinue
  if ($sys) {
    $ver = (& node --version 2>$null) | Select-Object -First 1
    if ($ver -match '^v(\d+)\.' -and [int]$Matches[1] -ge 18) { $NodeExe = $sys.Source; Ok "system node $ver" }
  }
  if (-not $NodeExe -and (Test-Path (Join-Path $Data 'node\node.exe'))) {
    $NodeExe = Join-Path $Data 'node\node.exe'
    Ok "private node $((& $NodeExe --version) | Select-Object -First 1)"
  }
  if (-not $NodeExe) {
    $base = 'https://nodejs.org/dist/latest-v22.x'
    $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$base/SHASUMS256.txt" -ErrorAction Stop).Content
    $line = ($sums -split "`n") | Where-Object { $_ -match "node-v[0-9.]+-win-$arch\.zip\s*$" } | Select-Object -First 1
    if (-not $line) { Die "could not find a Node.js build for win-$arch" }
    $sum, $file = $line.Trim() -split '\s+'
    $tmp = Join-Path $env:TEMP ('wopr-node-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    Say "DOWNLOADING $file"
    Get-File "$base/$file" (Join-Path $tmp $file)
    if ((Get-FileHash -Algorithm SHA256 -Path (Join-Path $tmp $file)).Hash -ne $sum.ToUpper()) { Die 'Node.js checksum mismatch' }
    Expand-Archive -Path (Join-Path $tmp $file) -DestinationPath $tmp -Force
    $inner = Get-ChildItem -Path $tmp -Directory | Select-Object -First 1
    $nodeDir = Join-Path $Data 'node'
    if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }
    Move-Item -Path $inner.FullName -Destination $nodeDir
    Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    $NodeExe = Join-Path $nodeDir 'node.exe'
    Ok "private node $((& $NodeExe --version) | Select-Object -First 1) in $nodeDir"
  }

  # ---------- W.O.P.R. ----------
  Say "DOWNLOADING W.O.P.R. ($Repo@$Branch)"
  # Stop a server left running by a previous install before its files are replaced.
  $oldServer = Join-Path $App 'server.js'
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains($oldServer) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $tmp = Join-Path $env:TEMP ('wopr-app-' + [guid]::NewGuid())
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  Get-File "https://codeload.github.com/$Repo/zip/refs/heads/$Branch" (Join-Path $tmp 'app.zip')
  Expand-Archive -Path (Join-Path $tmp 'app.zip') -DestinationPath $tmp -Force
  $inner = Get-ChildItem -Path $tmp -Directory | Select-Object -First 1
  if (-not $inner -or -not (Test-Path (Join-Path $inner.FullName 'server.js'))) { Die 'download did not contain server.js' }
  if (Test-Path $App) { Remove-Item $App -Recurse -Force }
  Move-Item -Path $inner.FullName -Destination $App
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  Ok $App

  $conf = @(
    '# Written by the W.O.P.R. installer. Edit and restart W.O.P.R. to change.',
    "WOPR_MODEL=$Model",
    "WOPR_NODE=$NodeExe",
    "OLLAMA_URL=$OllamaUrl"
  )
  if ($Espeak) { $conf += "WOPR_TTS=$Espeak" }
  if ($EspeakData) { $conf += "ESPEAK_DATA_PATH=$EspeakData" }
  if ($env:WOPR_PORT) { $conf += "WOPR_PORT=$($env:WOPR_PORT)" }
  Set-Content -Path (Join-Path $ConfDir 'wopr.env') -Value $conf -Encoding ASCII
  Ok "config $(Join-Path $ConfDir 'wopr.env')"

  # Start Menu + desktop shortcuts, and the 'wopr' command for new terminals.
  $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $launch = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $App 'wopr.ps1')`""
  $ws = New-Object -ComObject WScript.Shell
  foreach ($dir in @([Environment]::GetFolderPath('Programs'), [Environment]::GetFolderPath('Desktop'))) {
    $lnk = $ws.CreateShortcut((Join-Path $dir 'WOPR.lnk'))
    $lnk.TargetPath = $ps
    $lnk.Arguments = $launch
    $lnk.WorkingDirectory = $App
    $lnk.IconLocation = (Join-Path $App 'public\wopr.ico')
    $lnk.Description = 'Shall we play a game? NORAD war-room terminal for Ollama'
    $lnk.WindowStyle = 7
    $lnk.Save()
  }
  Ok 'Start Menu and desktop shortcuts: WOPR'
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not $userPath) { $userPath = '' }
  if (($userPath -split ';') -notcontains $App) {
    [Environment]::SetEnvironmentVariable('Path', (($userPath.TrimEnd(';') + ';' + $App).TrimStart(';')), 'User')
  }
  Ok "command 'wopr' (in new terminals)"

  Write-Host ''
  Say 'W.O.P.R. INSTALLED.  SHALL WE PLAY A GAME?'
  Note "Start it from the Start Menu or desktop shortcut, or type 'wopr' in a new terminal. Press Esc to log off."
  if (-not $env:WOPR_NO_LAUNCH) { Start-Process -FilePath $ps -ArgumentList $launch -WindowStyle Hidden }
} catch {
  Write-Host "ERROR: $($_.Exception.Message)" -ForegroundColor Red
}
}
