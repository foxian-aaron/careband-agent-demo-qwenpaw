param(
  [int]$Port = 5173,
  [int]$BackendPort = 3001,
  [ValidateSet('qwenpaw', 'openai', 'mock')]
  [string]$AgentProvider = 'qwenpaw',
  [switch]$SkipQwenPaw
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$BundledNode = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$NodeCommand = Get-Command node -ErrorAction SilentlyContinue

function Test-CareBandNodeVersion {
  param([string]$Candidate)

  if (-not $Candidate -or -not (Test-Path $Candidate)) {
    return $false
  }

  try {
    $VersionText = (& $Candidate -p 'process.versions.node').Trim()
    $Version = [version]$VersionText
    $SupportsVite7 =
      ($Version.Major -eq 20 -and $Version -ge [version]'20.19.0') -or
      ($Version.Major -ge 22 -and $Version -ge [version]'22.12.0')
    return $SupportsVite7
  } catch {
    return $false
  }
}

$NodeCandidates = @()
if ($NodeCommand) {
  $NodeCandidates += $NodeCommand.Source
}
if (Test-Path $BundledNode) {
  $NodeCandidates += $BundledNode
}

$NodeExe = $NodeCandidates |
  Select-Object -Unique |
  Where-Object { Test-CareBandNodeVersion $_ } |
  Select-Object -First 1

if (-not $NodeExe) {
  throw 'CareBand requires Node.js 20.19+ or 22.12+ for Vite 7. Install a supported Node.js version or confirm the Codex bundled runtime exists.'
}

$NodeVersion = (& $NodeExe -p 'process.versions.node').Trim()
Write-Host "Using Node.js $NodeVersion from $NodeExe"

$NpmCli = Join-Path $ProjectRoot '.tools\npm\package\bin\npm-cli.js'

if (-not (Test-Path $NpmCli)) {
  $NpmToolDir = Join-Path $ProjectRoot '.tools\npm'
  New-Item -ItemType Directory -Force -Path $NpmToolDir | Out-Null
  $NpmTarball = Join-Path $NpmToolDir 'npm.tgz'

  if (-not (Test-Path $NpmTarball)) {
    Write-Host 'Downloading local npm CLI...'
    Invoke-WebRequest -Uri 'https://registry.npmjs.org/npm/-/npm-10.9.2.tgz' -OutFile $NpmTarball
  }

  Write-Host 'Extracting local npm CLI...'
  tar -xzf $NpmTarball -C $NpmToolDir
}

$env:PATH = "$(Split-Path $NodeExe);$env:PATH"

if (-not (Test-Path (Join-Path $ProjectRoot 'node_modules'))) {
  Write-Host 'Installing frontend dependencies...'
  & $NodeExe $NpmCli install
}

$BackendRoot = Join-Path $ProjectRoot 'backend'
if (-not (Test-Path (Join-Path $BackendRoot 'node_modules'))) {
  Write-Host 'Installing backend dependencies...'
  Push-Location $BackendRoot
  & $NodeExe $NpmCli install
  Pop-Location
}

$env:PORT = "$BackendPort"
$env:FRONTEND_PORT = "$Port"
$env:CORS_ORIGIN = "http://127.0.0.1:$Port"
$env:VITE_API_BASE_URL = "http://127.0.0.1:$BackendPort"
$env:AGENT_PROVIDER = $AgentProvider
$env:QWENPAW_BASE_URL = 'http://127.0.0.1:8088'
$env:QWENPAW_AGENT_ID = 'careband_summary_agent'
if (-not $env:QWENPAW_TIMEOUT_MS) {
  $env:QWENPAW_TIMEOUT_MS = '5000'
}

$QwenProcess = $null
$QwenStartedHere = $false

function Test-QwenPawReady {
  try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8088/' -TimeoutSec 2 -UseBasicParsing
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

if ($AgentProvider -eq 'qwenpaw' -and -not $SkipQwenPaw -and -not (Test-QwenPawReady)) {
  $QwenCommand = (Get-Command qwenpaw -ErrorAction SilentlyContinue).Source
  if ($QwenCommand) {
    $QwenLogRoot = Join-Path $env:LOCALAPPDATA 'CareBandDemo\qwenpaw'
    New-Item -ItemType Directory -Force -Path $QwenLogRoot | Out-Null
    Write-Host 'Starting the local QwenPaw service in the background...'
    $QwenStartOptions = @{
      FilePath = 'powershell.exe'
      ArgumentList = @(
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $QwenCommand,
        'app', '--host', '127.0.0.1', '--port', '8088', '--log-level', 'warning'
      )
      WorkingDirectory = $QwenLogRoot
      WindowStyle = 'Hidden'
      PassThru = $true
    }
    $QwenProcess = Start-Process @QwenStartOptions
    $QwenStartedHere = $true

    for ($attempt = 0; $attempt -lt 30 -and -not (Test-QwenPawReady); $attempt += 1) {
      Start-Sleep -Milliseconds 500
    }
  }

  if (-not (Test-QwenPawReady)) {
    Write-Warning 'QwenPaw did not become ready. The demo will start with explicit deterministic Mock mode.'
    $env:AGENT_PROVIDER = 'mock'
  }
}

Write-Host "Starting CareBand Agent Demo v0.2 (Agent provider: $($env:AGENT_PROVIDER))..."
Write-Host "Frontend: http://127.0.0.1:$Port/#/institution"
Write-Host "Backend:  http://127.0.0.1:$BackendPort/api/health"
try {
  & $NodeExe 'scripts\start-v02.mjs'
} finally {
  if ($QwenStartedHere -and $QwenProcess -and -not $QwenProcess.HasExited) {
    Stop-Process -Id $QwenProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
