param(
  [int]$Port = 5173,
  [int]$BackendPort = 3001,
  [ValidateSet('qwenpaw', 'openai', 'mock')]
  [string]$AgentProvider = 'qwenpaw',
  [switch]$SkipQwenPaw,
  [switch]$HardwareMode
)

$ErrorActionPreference = 'Stop'

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$NetworkModule = Join-Path $PSScriptRoot 'CareBand.Network.psm1'
Import-Module $NetworkModule -Force

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
$env:BACKEND_HOST = Get-CareBandBackendHost -HardwareMode:$HardwareMode
$env:SERVE_STATIC_FRONTEND = Get-CareBandServeStaticFrontend -HardwareMode:$HardwareMode
$env:HARDWARE_MODE = if ($HardwareMode) { 'true' } else { 'false' }
$env:CORS_ORIGIN = "http://127.0.0.1:$Port"
$env:VITE_API_BASE_URL = "http://127.0.0.1:$BackendPort"
$env:AGENT_PROVIDER = $AgentProvider
$env:QWENPAW_BASE_URL = 'http://127.0.0.1:8088'
$env:QWENPAW_AGENT_ID = 'careband_summary_agent'
$QwenTimeoutWasConfigured = -not [string]::IsNullOrWhiteSpace($env:QWENPAW_TIMEOUT_MS)
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

if ($AgentProvider -eq 'qwenpaw') {
  if (-not $SkipQwenPaw -and -not (Test-QwenPawReady)) {
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
  }

  if (-not (Test-QwenPawReady)) {
    Write-Warning 'QwenPaw is offline. The backend will keep requested_provider=qwenpaw and record an explicit deterministic Mock fallback.'
    if (-not $QwenTimeoutWasConfigured) {
      $env:QWENPAW_TIMEOUT_MS = '1000'
    }
  }
}

Write-Host "Starting CareBand Agent Demo v0.2 (Agent provider: $($env:AGENT_PROVIDER))..."
Write-Host "Frontend: http://127.0.0.1:$Port/#/institution"
Write-Host "Backend:  http://127.0.0.1:$BackendPort/api/health"
if ($HardwareMode) {
  $HardwareEventUrls = @(Get-CareBandHardwareEventUrls -Port $BackendPort)
  Write-Warning 'Hardware mode is ON: only the backend is listening on all network interfaces; the Vite frontend remains bound to 127.0.0.1.'
  if ($HardwareEventUrls.Count -eq 0) {
    Write-Warning "No usable LAN IPv4 address was detected. Connect this computer and the ESP32 to the same trusted Wi-Fi, then rerun the script."
  } else {
    Write-Host 'ESP32 event URL candidates (choose the address on the same LAN as the board):'
    foreach ($HardwareEventUrl in $HardwareEventUrls) {
      Write-Host "  $HardwareEventUrl"
    }
  }
  Write-Warning 'Security: LAN peers can reach only GET /api/health and POST /api/events, but the event endpoint still has no device authentication or TLS. Use only a trusted private LAN, do not configure router port-forwarding, and stop the demo after testing. If Windows Firewall prompts, allow only Private networks.'
} else {
  Write-Host 'Hardware mode: OFF. The backend is loopback-only. Add -HardwareMode only when an ESP32 on the same trusted LAN must connect.'
}
try {
  & $NodeExe 'scripts\start-v02.mjs'
} finally {
  if ($QwenStartedHere -and $QwenProcess -and -not $QwenProcess.HasExited) {
    Stop-Process -Id $QwenProcess.Id -Force -ErrorAction SilentlyContinue
  }
}
