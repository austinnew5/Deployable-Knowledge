#Requires -Version 5.1
# Bootstraps everything Deployable Knowledge needs on a bare Windows machine:
# Node.js, Ollama, the default chat model, and npm dependencies - then starts the app.
# Re-run this script any time; every step here is safe to run again (it just checks first).

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ProgressPreference = 'SilentlyContinue' # Invoke-WebRequest's default progress bar is very slow

Set-Location -Path $PSScriptRoot

function Test-CommandExists([string]$name) {
	return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

# Installers update the registry's PATH, not this already-running process's copy of it.
# Re-reading both scopes lets node/npm/ollama become usable without restarting the script.
function Update-SessionPath {
	$machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
	$user = [Environment]::GetEnvironmentVariable('Path', 'User')
	$env:Path = "$machine;$user"
}

# Different local services on the same machine can end up bound to 127.0.0.1 (IPv4)
# or ::1 (IPv6) depending on how they're started, and "localhost" doesn't reliably
# mean the same thing to every process - so try every form instead of guessing one.
function Test-HttpUp([string[]]$urls, [int]$timeoutSec = 5) {
	foreach ($url in $urls) {
		try {
			Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $timeoutSec | Out-Null
			return $url
		} catch {
			continue
		}
	}
	return $null
}

function Test-OllamaResponding {
	return [bool](Test-HttpUp -urls @('http://127.0.0.1:11434', 'http://localhost:11434') -timeoutSec 3)
}

Write-Host '=== Deployable Knowledge setup ===' -ForegroundColor Cyan

# --- Node.js -----------------------------------------------------------
if (-not (Test-CommandExists 'node')) {
	Write-Host 'Node.js not found - looking up the latest LTS release...'
	$index = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json'
	$lts = $index | Where-Object { $_.lts } | Select-Object -First 1
	if (-not $lts) { throw 'Could not find a Node.js LTS release to install.' }
	$version = $lts.version
	$msiUrl = "https://nodejs.org/dist/$version/node-$version-x64.msi"
	$msiPath = Join-Path $env:TEMP "node-$version-x64.msi"

	Write-Host "Downloading Node.js $version..."
	Invoke-WebRequest -Uri $msiUrl -OutFile $msiPath

	Write-Host 'Installing Node.js (Windows may ask for permission)...'
	Start-Process -FilePath 'msiexec.exe' -ArgumentList "/i `"$msiPath`" /qn /norestart" -Wait
	Remove-Item $msiPath -ErrorAction SilentlyContinue
	Update-SessionPath

	if (-not (Test-CommandExists 'node')) {
		throw "Node.js installed but isn't on PATH yet. Close this window and run START.bat again."
	}
	Write-Host 'Node.js installed.' -ForegroundColor Green
} else {
	Write-Host "Found Node.js $(node -v)"
}

# --- Ollama --------------------------------------------------------------
if (-not (Test-CommandExists 'ollama')) {
	Write-Host 'Ollama not found - downloading the installer...'
	$ollamaInstaller = Join-Path $env:TEMP 'OllamaSetup.exe'
	Invoke-WebRequest -Uri 'https://ollama.com/download/OllamaSetup.exe' -OutFile $ollamaInstaller

	# Ollama's installer doesn't have a documented silent flag we can rely on -
	# it's quick (no options to click through), so just run it and wait.
	Write-Host 'Launching the Ollama installer - follow its prompts...'
	Start-Process -FilePath $ollamaInstaller -Wait
	Remove-Item $ollamaInstaller -ErrorAction SilentlyContinue
	Update-SessionPath

	if (-not (Test-CommandExists 'ollama')) {
		throw "Ollama installed but isn't on PATH yet. Close this window and run START.bat again."
	}
	Write-Host 'Ollama installed.' -ForegroundColor Green
} else {
	Write-Host "Found $(ollama --version)"
}

# --- Make sure the Ollama server is actually running ----------------------
if (-not (Test-OllamaResponding)) {
	Write-Host 'Starting Ollama - right after a fresh install this can take a minute (antivirus scanning the new files, first-run setup)...'
	Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden

	$deadline = (Get-Date).AddSeconds(90)
	$lastNotice = Get-Date
	while ((Get-Date) -lt $deadline) {
		if (Test-OllamaResponding) { break }
		Start-Sleep -Seconds 2
		if (((Get-Date) - $lastNotice).TotalSeconds -ge 15) {
			Write-Host '...still waiting on Ollama'
			$lastNotice = Get-Date
		}
	}
	if (-not (Test-OllamaResponding)) {
		throw 'Ollama did not start within 90 seconds. Try running "ollama serve" in a new terminal to see what it says.'
	}
}
Write-Host 'Ollama is running.' -ForegroundColor Green

# --- Default chat model ----------------------------------------------------
# Matches assistant-defaults.ts. Safe to re-run - Ollama skips it if already downloaded.
Write-Host 'Checking the default model (granite4:350m) - this can take a while the first time...'
& ollama pull granite4:350m

# --- npm dependencies --------------------------------------------------
if (-not (Test-Path (Join-Path $PSScriptRoot 'node_modules'))) {
	Write-Host 'Installing app dependencies for the first time (this can take a few minutes)...'
	& npm install
	if ($LASTEXITCODE -ne 0) { throw 'npm install failed - see the errors above.' }
}

# --- Launch --------------------------------------------------------------
$defaultCandidates = @('http://127.0.0.1:5173', 'http://localhost:5173')

# If a previous run's server is still up (e.g. its window got closed without
# stopping the process), just reuse it instead of spawning a duplicate that
# Vite would silently bump to a different port.
$alreadyUp = Test-HttpUp -urls $defaultCandidates -timeoutSec 2
if ($alreadyUp) {
	Write-Host 'Deployable Knowledge is already running.' -ForegroundColor Green
	Start-Process $alreadyUp
	exit 0
}

Write-Host 'Starting Deployable Knowledge...' -ForegroundColor Cyan
$logPath = Join-Path $env:TEMP 'deployable-knowledge-dev.log'
Remove-Item $logPath -ErrorAction SilentlyContinue

# Tee-Object keeps the server's output visible in its own window (so closing
# that window stops the app) while also writing it to a file this script can
# read - that log is what tells us the real port if 5173 was already taken.
Start-Process -FilePath 'powershell.exe' `
	-ArgumentList '-NoExit', '-Command', "npm run dev 2>&1 | Tee-Object -FilePath `"$logPath`"" `
	-WorkingDirectory $PSScriptRoot

$url = $null
$deadline = (Get-Date).AddSeconds(120)
Write-Host "Waiting for it to finish starting - the first run can take a bit longer..."
while ((Get-Date) -lt $deadline) {
	Start-Sleep -Seconds 2

	if (Test-Path $logPath) {
		$match = Select-String -Path $logPath -Pattern 'Local:\s+(http\S+)' -ErrorAction SilentlyContinue |
			Select-Object -Last 1
		if ($match) {
			$reportedUrl = $match.Matches[0].Groups[1].Value.TrimEnd('/')
			if (Test-HttpUp -urls @($reportedUrl) -timeoutSec 3) {
				$url = $reportedUrl
				break
			}
		}
	}

	$found = Test-HttpUp -urls $defaultCandidates -timeoutSec 2
	if ($found) {
		$url = $found
		break
	}
}

if ($url) {
	Write-Host "Deployable Knowledge is open in your browser at $url" -ForegroundColor Green
	Start-Process $url
} else {
	Write-Host "Still starting - check the other window for progress or errors, then open $($defaultCandidates[0]) yourself once it says 'ready'." -ForegroundColor Yellow
}
Write-Host 'To stop the app, close the other window running "npm run dev".'
