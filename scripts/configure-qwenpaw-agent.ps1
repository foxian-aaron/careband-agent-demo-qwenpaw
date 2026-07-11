param(
  [string]$AgentId = 'careband_summary_agent',
  [string]$ProviderId = 'aliyun-codingplan',
  [string]$ModelId = 'qwen3.6-plus'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$promptRoot = Join-Path $repoRoot 'integrations\qwenpaw'
$workspaceRoot = Join-Path $HOME ".qwenpaw\workspaces\$AgentId"
$agentConfigPath = Join-Path $workspaceRoot 'agent.json'

if (-not (Test-Path -LiteralPath $agentConfigPath)) {
  throw "QwenPaw agent '$AgentId' does not exist. Create it with qwenpaw agents create first."
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
