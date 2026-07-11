$ErrorActionPreference = 'Stop'

$ScriptsRoot = Split-Path -Parent $PSScriptRoot
$ProjectRoot = Split-Path -Parent $ScriptsRoot
$ModulePath = Join-Path $ScriptsRoot 'CareBand.Network.psm1'
Import-Module $ModulePath -Force

$Passed = 0

function Assert-Equal {
  param(
    [object]$Actual,
    [object]$Expected,
    [string]$Name
  )

  if ($Actual -ne $Expected) {
    throw "$Name failed. Expected '$Expected', received '$Actual'."
  }
  $script:Passed += 1
}

Assert-Equal (Get-CareBandBackendHost) '127.0.0.1' 'default backend host remains loopback'
Assert-Equal (Get-CareBandBackendHost -HardwareMode) '0.0.0.0' 'hardware backend host listens on LAN'
Assert-Equal (Get-CareBandServeStaticFrontend) 'true' 'default backend may serve the built frontend on loopback'
Assert-Equal (Get-CareBandServeStaticFrontend -HardwareMode) 'false' 'hardware backend does not expose the built frontend'

$Addresses = @(
  Get-CareBandLanIPv4Addresses -CandidateAddresses @(
    '127.0.0.1',
    '169.254.10.4',
    '192.168.50.12',
    '10.20.30.40',
    '192.168.50.12',
    'not-an-address'
  )
)
Assert-Equal ($Addresses -join ',') '10.20.30.40,192.168.50.12' 'LAN address filtering and deduplication'

$Urls = @(
  Get-CareBandHardwareEventUrls -Port 3001 -Addresses @('192.168.50.12', '127.0.0.1')
)
Assert-Equal ($Urls -join ',') 'http://192.168.50.12:3001/api/events' 'hardware event URL formatting'

$StartDemoPath = Join-Path $ScriptsRoot 'start-demo.ps1'
$Tokens = $null
$ParseErrors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  $StartDemoPath,
  [ref]$Tokens,
  [ref]$ParseErrors
) | Out-Null
Assert-Equal $ParseErrors.Count 0 'start-demo PowerShell syntax'

$StartDemoSource = Get-Content -Raw -LiteralPath $StartDemoPath
Assert-Equal ($StartDemoSource -match '\$env:BACKEND_HOST = Get-CareBandBackendHost') $true 'start-demo consumes guarded backend host'
Assert-Equal ($StartDemoSource -match '\$env:SERVE_STATIC_FRONTEND = Get-CareBandServeStaticFrontend') $true 'start-demo guards static frontend exposure'
Assert-Equal ($StartDemoSource -match '\$env:HARDWARE_MODE = if \(\$HardwareMode\)') $true 'start-demo enables LAN route restriction'
Assert-Equal ($StartDemoSource -match "\$env:ALLOW_DEMO_RESET = 'true'") $true 'start-demo explicitly enables loopback-gated demo reset'
Assert-Equal ($StartDemoSource -match "\$env:AGENT_PROVIDER = 'mock'") $false 'offline Qwen remains an explicit qwenpaw-to-Mock fallback'

$StartV02Source = Get-Content -Raw -LiteralPath (Join-Path $ScriptsRoot 'start-v02.mjs')
Assert-Equal ($StartV02Source -match '"--host", "127\.0\.0\.1"') $true 'frontend remains loopback-only'
Assert-Equal ($StartV02Source -match 'ALLOW_DEMO_RESET: process\.env\.ALLOW_DEMO_RESET \?\? "true"') $true 'npm dev explicitly enables loopback-gated demo reset'

Write-Host "Hardware mode tests: $Passed passed."
