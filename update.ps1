# Update W.O.P.R. to the newest version on GitHub (Windows).
#   irm https://raw.githubusercontent.com/frogswiper/wopr/main/update.ps1 | iex
#   wopr --update
#
# The new version is downloaded next to the installed one (%LOCALAPPDATA%\wopr\staged). If W.O.P.R. is
# not running it is switched in at once; otherwise it takes over the next time W.O.P.R. starts.
# 'update.ps1 --stage' only downloads: the launcher runs it hidden at every start
# (turn that off with WOPR_AUTO_UPDATE=0 in %APPDATA%\wopr\wopr.env).

& {
$ErrorActionPreference = 'Continue'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
$Stage = ($args -contains '--stage')
$Repo = 'frogswiper/wopr'
$Data = Join-Path $env:LOCALAPPDATA 'wopr'
$App = Join-Path $Data 'app'
$Staged = Join-Path $Data 'staged'
$Log = Join-Path $Data 'wopr-update.log'
function Say($m) {
  if ($Stage) { Add-Content -Path $Log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $m) -ErrorAction SilentlyContinue }
  else { Write-Host '> ' -NoNewline -ForegroundColor White; Write-Host $m }
}
$Conf = Join-Path $env:APPDATA 'wopr\wopr.env'
$Port = '1983'; $Branch = 'main'
if (Test-Path $Conf) {
  foreach ($l in Get-Content $Conf) {
    if ($l -match '^\s*WOPR_PORT=(\d+)') { $Port = $Matches[1] }
    if ($l -match '^\s*WOPR_BRANCH=(\S+)') { $Branch = $Matches[1] }
  }
}
function Test-Up {
  try { $null = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/wopr.json" -TimeoutSec 2 -ErrorAction Stop; return $true } catch { return $false }
}

try {
  if (-not (Test-Path (Join-Path $App 'server.js'))) {
    Say "W.O.P.R. is not installed in $App. Install it with:"
    Say "  irm https://raw.githubusercontent.com/$Repo/main/install.ps1 | iex"
    return
  }
  $cur = 'none'
  if (Test-Path (Join-Path $App '.version')) { $cur = (Get-Content (Join-Path $App '.version') -TotalCount 1).Trim() }
  try { $latest = (Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/commits/$Branch" -TimeoutSec 20 -ErrorAction Stop).sha }
  catch { Say 'could not reach GitHub - try again later'; return }
  if ($latest -notmatch '^[0-9a-f]{40}$') { Say 'unexpected answer from GitHub - nothing changed'; return }
  if ($latest -eq $cur) {
    Say "W.O.P.R. is up to date ($($cur.Substring(0, 7)))"
    if (Test-Path $Staged) { Remove-Item $Staged -Recurse -Force -ErrorAction SilentlyContinue }
    return
  }
  $have = ''
  if (Test-Path (Join-Path $Staged '.version')) { $have = (Get-Content (Join-Path $Staged '.version') -TotalCount 1).Trim() }
  if ($have -ne $latest) {
    Say "downloading $($latest.Substring(0, 7)) (installed: $($cur.Substring(0, [Math]::Min(7, $cur.Length))))"
    $tmp = Join-Path $Data ('.download-' + [guid]::NewGuid())
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "https://codeload.github.com/$Repo/zip/$latest" -OutFile (Join-Path $tmp 'app.zip') -TimeoutSec 300 -ErrorAction Stop
      Expand-Archive -Path (Join-Path $tmp 'app.zip') -DestinationPath $tmp -Force
      $inner = Get-ChildItem -Path $tmp -Directory | Select-Object -First 1
      if (-not $inner -or -not (Test-Path (Join-Path $inner.FullName 'server.js'))) { throw 'download was incomplete' }
      Set-Content -Path (Join-Path $inner.FullName '.version') -Value $latest -Encoding ASCII
      if (Test-Path $Staged) { Remove-Item $Staged -Recurse -Force }
      Move-Item -Path $inner.FullName -Destination $Staged
    } finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
  }
  if (-not $Stage -and -not (Test-Up)) {
    Set-Location $Data
    $old = Join-Path $Data 'app.old'
    if (Test-Path $old) { Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue }
    Rename-Item -Path $App -NewName 'app.old' -ErrorAction Stop
    try { Rename-Item -Path $Staged -NewName 'app' -ErrorAction Stop }
    catch { Rename-Item -Path $old -NewName 'app'; throw }
    Remove-Item $old -Recurse -Force -ErrorAction SilentlyContinue
    Say "W.O.P.R. updated to $($latest.Substring(0, 7))"
  } else {
    Say "version $($latest.Substring(0, 7)) is ready - it takes over the next time W.O.P.R. starts"
  }
} catch {
  Say "update failed: $($_.Exception.Message)"
}
} @args
