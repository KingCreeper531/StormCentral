<#
  Storm Central X bot on your PC, posting through twikit (see README.md here).

  Double-click start.cmd, or run:
    .\start.ps1            check the login, then post every 5 minutes until you close the window
    .\start.ps1 -DryRun    one run that prints what it would post, posting nothing
    .\start.ps1 -Once      one real run, then stop

  First run sets up Python's twikit in .venv. Settings come from settings.env.
#>
param([switch]$DryRun, [switch]$Once)

$ErrorActionPreference = "Stop"
$here = $PSScriptRoot
$root = (Resolve-Path (Join-Path $here "..\..")).Path
Set-Location $root

function Say($text, $color = "Gray") { Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $text" -ForegroundColor $color }
function Stop-With($text) { Say $text "Red"; exit 1 }

# --- Tools ---
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Stop-With "Node.js isn't installed. Get the LTS version from https://nodejs.org, then run this again." }
$nodeMajor = [int]((node --version).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 20) { Stop-With "Node.js $nodeMajor is too old; install the LTS version (20 or newer) from https://nodejs.org." }

# The Python launcher ("py -3") first, then python on PATH.
$py = $null
foreach ($cmd in @(@("py", "-3"), @("python"), @("python3"))) {
  $exe = $cmd[0]
  $pre = @($cmd | Select-Object -Skip 1)
  if (Get-Command $exe -ErrorAction SilentlyContinue) {
    $v = & $exe @pre -c "import sys; print(sys.version_info >= (3, 10))" 2>$null
    if ($v -eq "True") { $py = @{ exe = $exe; pre = $pre }; break }
  }
}
if (-not $py) { Stop-With "Python 3.10 or newer isn't installed. Get it from https://www.python.org/downloads/ (tick 'Add python.exe to PATH'), then run this again." }

# --- twikit in its own environment ---
# (Windows PowerShell 5.1 has no $IsWindows; there it's always Windows.)
$onWindows = ($PSVersionTable.PSVersion.Major -lt 6) -or $IsWindows
$venvPy = if ($onWindows) { Join-Path $here ".venv\Scripts\python.exe" } else { Join-Path $here ".venv/bin/python" }
if (-not (Test-Path $venvPy)) {
  Say "Setting up Python packages (first run only)..."
  $pre = $py.pre
  & $py.exe @pre -m venv (Join-Path $here ".venv")
  & $venvPy -m pip install --quiet --upgrade pip
}
& $venvPy -m pip install --quiet -r (Join-Path $here "requirements.txt")
if ($LASTEXITCODE -ne 0) { Stop-With "Couldn't install twikit (see the messages above)." }

# --- Settings ---
$settings = Join-Path $here "settings.env"
if (-not (Test-Path $settings)) { Copy-Item (Join-Path $here "settings.example.env") $settings }
foreach ($line in Get-Content $settings) {
  if ($line -match '^\s*([A-Z_]+)\s*=\s*(.*?)\s*$') { Set-Item "env:$($Matches[1])" $Matches[2] }
}
$env:BOT_POSTER = "twikit"
$env:BOT_PYTHON = $venvPy
$env:BOT_TWIKIT_SCRIPT = Join-Path $here "twikit_post.py"
$env:BOT_TWIKIT_COOKIES = Join-Path $here "cookies.json"
$env:BOT_STATE = Join-Path (Join-Path $root "bot") ".state/state.json"
if (-not $env:BOT_X_ACCOUNT) { $env:BOT_X_ACCOUNT = "Storm__Central" }
$interval = if ($env:BOT_INTERVAL_S) { [int]$env:BOT_INTERVAL_S } else { 300 }
if ($interval -lt 120) { $interval = 120 }

# --- Login check: the cookies must be @Storm__Central ---
if (-not (Test-Path $env:BOT_TWIKIT_COOKIES)) {
  Copy-Item (Join-Path $here "cookies.example.json") $env:BOT_TWIKIT_COOKIES
  Stop-With "Paste the account's auth_token and ct0 into bot\local\cookies.json (README.md here shows how), then run this again."
}
$check = & $venvPy $env:BOT_TWIKIT_SCRIPT --cookies $env:BOT_TWIKIT_COOKIES --account $env:BOT_X_ACCOUNT --check | Select-Object -Last 1 | ConvertFrom-Json
if (-not $check.ok) { Stop-With "Login check failed: $($check.message)" }
Say "Logged in as @$($check.user)" "Green"

# --- Build the bot (bot/*.ts -> one file) ---
Say "Building the bot..."
npx --yes esbuild@0.28.2 bot/main.ts --bundle --platform=node --format=esm --target=node20 --outfile=bot/local/x-bot.mjs --log-level=warning
if ($LASTEXITCODE -ne 0) { Stop-With "Build failed (see above)." }

# --- Run ---
if ($DryRun) {
  $env:BOT_DRY_RUN = "1"
  node bot/local/x-bot.mjs
  exit $LASTEXITCODE
}
$env:BOT_DRY_RUN = "0"
Say "Posting as @$($check.user) every $([int]($interval / 60)) min. Close this window to stop." "Green"
while ($true) {
  node bot/local/x-bot.mjs
  $code = $LASTEXITCODE
  if ($code -eq 3) {
    [console]::Beep(880, 400)
    Stop-With "Stopped: the X account needs attention (see above). Fix it on x.com, update cookies.json, then start again."
  }
  if ($code -ne 0) { Say "That run failed (exit $code); trying again next time." "Yellow" }
  if ($Once) { break }
  Start-Sleep -Seconds $interval
}
