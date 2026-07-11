param(
  [string]$AgentId = 'careband_summary_agent',
  [string]$ProviderId = 'aliyun-codingplan',
  [string]$ModelId = 'qwen3.6-plus'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$promptRoot = Join-Path $repoRoot 'integrations\qwenpaw'
$qwenHome = if ($env:USERPROFILE) { $env:USERPROFILE } else { $HOME }
$workspaceRoot = Join-Path $qwenHome ".qwenpaw\workspaces\$AgentId"
$agentConfigPath = Join-Path $workspaceRoot 'agent.json'

if (-not (Test-Path -LiteralPath $agentConfigPath)) {
  $qwenCommand = (Get-Command qwenpaw -ErrorAction SilentlyContinue).Source
  if (-not $qwenCommand) {
    throw "QwenPaw is not installed or is not on PATH. Cannot create agent '$AgentId'."
  }

  function Test-LocalQwenPawReady {
    try {
      $response = Invoke-WebRequest -Uri 'http://127.0.0.1:8088/api/agent/health' -TimeoutSec 2 -UseBasicParsing
      return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
    } catch {
      return $false
    }
  }

  $startedHere = $false
  $qwenProcess = $null
  if (-not (Test-LocalQwenPawReady)) {
    $qwenProcess = Start-Process -FilePath 'powershell.exe' -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $qwenCommand,
      'app', '--host', '127.0.0.1', '--port', '8088', '--log-level', 'warning'
    ) -WindowStyle Hidden -PassThru
    $startedHere = $true
    for ($attempt = 0; $attempt -lt 30 -and -not (Test-LocalQwenPawReady); $attempt += 1) {
      Start-Sleep -Milliseconds 500
    }
  }

  try {
    if (-not (Test-LocalQwenPawReady)) {
      throw 'QwenPaw local API did not become ready on 127.0.0.1:8088.'
    }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $qwenCommand `
      --host 127.0.0.1 --port 8088 agent create `
      --name 'CareBand Summary Agent' `
      --agent-id $AgentId `
      --description 'CareBand rule-result-aware three-role summary Agent. It never decides medical risk.' `
      --template default `
      --provider-id $ProviderId `
      --model-id $ModelId
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $agentConfigPath)) {
      throw "QwenPaw failed to create agent '$AgentId'."
    }
  } finally {
    if ($startedHere -and $qwenProcess -and -not $qwenProcess.HasExited) {
      Stop-Process -Id $qwenProcess.Id -Force -ErrorAction SilentlyContinue
    }
  }
}

$config = Get-Content -Raw -Encoding utf8 -LiteralPath $agentConfigPath | ConvertFrom-Json
$config.name = 'CareBand Summary Agent'
$config.description = 'CareBand rule-result-aware three-role summary Agent. It never decides medical risk.'
$config.language = 'zh'
$config.active_model = [PSCustomObject]@{ provider_id = $ProviderId; model = $ModelId }
$config.plan.enabled = $false
$config.coding_mode.enabled = $false
$config.system_prompt_files = @('AGENTS.md', 'SOUL.md', 'PROFILE.md')

foreach ($tool in $config.tools.builtin_tools.PSObject.Properties) {
  $tool.Value.enabled = $false
}

if ($config.mcp -and $config.mcp.clients) {
  foreach ($client in $config.mcp.clients.PSObject.Properties) {
    if ($client.Value.PSObject.Properties['enabled']) {
      $client.Value.enabled = $false
    } else {
      $client.Value | Add-Member -NotePropertyName enabled -NotePropertyValue $false
    }
  }
}

foreach ($name in @('AGENTS.md', 'SOUL.md', 'PROFILE.md')) {
  Copy-Item -LiteralPath (Join-Path $promptRoot $name) -Destination (Join-Path $workspaceRoot $name) -Force
}

$json = $config | ConvertTo-Json -Depth 100
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($agentConfigPath, $json, $utf8NoBom)

$savedConfig = Get-Content -Raw -Encoding utf8 -LiteralPath $agentConfigPath | ConvertFrom-Json
$enabledBuiltins = @(
  $savedConfig.tools.builtin_tools.PSObject.Properties |
    Where-Object { $_.Value.enabled -eq $true } |
    ForEach-Object { $_.Name }
)
$enabledMcpClients = @()
if ($savedConfig.mcp -and $savedConfig.mcp.clients) {
  $enabledMcpClients = @(
    $savedConfig.mcp.clients.PSObject.Properties |
      Where-Object { $_.Value.enabled -eq $true } |
      ForEach-Object { $_.Name }
  )
}
if ($enabledBuiltins.Count -gt 0 -or $enabledMcpClients.Count -gt 0) {
  throw "QwenPaw tool isolation verification failed. Enabled runtime tools remain."
}

Write-Host "Configured QwenPaw agent '$AgentId' with $ProviderId/$ModelId and verified no enabled builtin or MCP tools."
