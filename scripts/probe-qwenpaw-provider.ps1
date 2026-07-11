param(
  [string]$AgentId = 'careband_summary_agent',
  [string]$ProviderId = 'aliyun-codingplan',
  [string]$ModelId = 'qwen3.6-plus',
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$InstructionPath = Join-Path $ProjectRoot 'integrations\qwenpaw\smoke_task.md'
$QwenCommand = (Get-Command qwenpaw -ErrorAction SilentlyContinue).Source

if (-not $QwenCommand) {
  throw 'QwenPaw is not installed or is not on PATH.'
}
if (-not (Test-Path -LiteralPath $InstructionPath)) {
  throw "Missing synthetic probe instruction: $InstructionPath"
}

$RunId = "{0}-{1}-{2}" -f (
  $ProviderId -replace '[^a-zA-Z0-9_-]', '_'
), (Get-Date -Format 'yyyyMMdd-HHmmss'), ([guid]::NewGuid().ToString('N').Substring(0, 8))
$OutputDir = Join-Path $env:LOCALAPPDATA "CareBandDemo\qwen-probes\$RunId"
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$PreviousErrorAction = $ErrorActionPreference
try {
  # QwenPaw currently writes informational model logs to stderr on Windows.
  # Capture them without treating those INFO lines as terminating PowerShell errors.
  $ErrorActionPreference = 'Continue'
  $TaskOutput = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $QwenCommand `
    task -i $InstructionPath -m "$ProviderId/$ModelId" `
    --max-iters 1 -t $TimeoutSeconds --agent-id $AgentId --output-dir $OutputDir 2>&1 | Out-String
} finally {
  $ErrorActionPreference = $PreviousErrorAction
}

$ResultPath = Join-Path $OutputDir 'result.json'
if (-not (Test-Path -LiteralPath $ResultPath)) {
  $SafeOutput = $TaskOutput `
    -replace 'sk-[A-Za-z0-9_+=./-]{8,}', 'sk-[redacted]' `
    -replace '[A-Za-z]:\\Users\\[^\r\n ]+', '[local path]'
  [Console]::Error.WriteLine("QwenPaw did not write result.json. $SafeOutput")
  exit 1
}

$Result = Get-Content -Raw -Encoding utf8 -LiteralPath $ResultPath | ConvertFrom-Json
if ($Result.status -ne 'success') {
  $SafeError = [string]$Result.error `
    -replace 'sk-[A-Za-z0-9_+=./-]{8,}', 'sk-[redacted]' `
    -replace '[A-Za-z]:\\Users\\[^\r\n ]+', '[local path]'
  [Console]::Error.WriteLine("QwenPaw provider probe failed for $ProviderId/${ModelId}: $SafeError")
  exit 1
}

try {
  $AgentJson = ([string]$Result.response).Trim() | ConvertFrom-Json
} catch {
  [Console]::Error.WriteLine('QwenPaw provider was reachable, but the synthetic Agent response was not JSON-only.')
  exit 1
}

$Required = @(
  'status_level', 'risk_score', 'key_reasons', 'recommended_action',
  'caregiver_summary', 'family_summary', 'institution_summary', 'safety_disclaimer'
)
$Missing = @($Required | Where-Object { -not $AgentJson.PSObject.Properties[$_] })
if ($Missing.Count -gt 0 -or $AgentJson.status_level -ne 'stable' -or $AgentJson.risk_score -ne 10) {
  [Console]::Error.WriteLine("QwenPaw response failed the synthetic rule-lock check. Missing: $($Missing -join ', ')")
  exit 1
}

Write-Host "QwenPaw provider probe passed: $ProviderId/$ModelId"
Write-Host "Agent: $AgentId; elapsed: $($Result.elapsed_seconds)s; output: $OutputDir"
