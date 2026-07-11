Set-StrictMode -Version Latest

function Test-CareBandLanIPv4Address {
  param([string]$Address)

  if ([string]::IsNullOrWhiteSpace($Address)) {
    return $false
  }

  $ParsedAddress = $null
  if (-not [System.Net.IPAddress]::TryParse($Address, [ref]$ParsedAddress)) {
    return $false
  }
  if ($ParsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
    return $false
  }
  if ([System.Net.IPAddress]::IsLoopback($ParsedAddress)) {
    return $false
  }

  $Bytes = $ParsedAddress.GetAddressBytes()
  return $Bytes[0] -ne 0 -and
    $Bytes[0] -ne 127 -and
    -not ($Bytes[0] -eq 169 -and $Bytes[1] -eq 254)
}

function Get-CareBandBackendHost {
  param([switch]$HardwareMode)

  if ($HardwareMode) {
    return '0.0.0.0'
  }
  return '127.0.0.1'
}

function Get-CareBandServeStaticFrontend {
  param([switch]$HardwareMode)

  if ($HardwareMode) {
    return 'false'
  }
  return 'true'
}

function Get-CareBandLanIPv4Addresses {
  [CmdletBinding()]
  param([string[]]$CandidateAddresses)

  $Addresses = @()
  if ($PSBoundParameters.ContainsKey('CandidateAddresses')) {
    $Addresses = @($CandidateAddresses)
  } else {
    try {
      $Configurations = @(
        Get-NetIPConfiguration -ErrorAction Stop |
          Where-Object {
            $_.NetAdapter.Status -eq 'Up' -and $_.IPv4Address
          }
      )
      $WithGateway = @($Configurations | Where-Object { $_.IPv4DefaultGateway })
      if ($WithGateway.Count -gt 0) {
        $Configurations = $WithGateway
      }
      $Addresses = @(
        $Configurations |
          ForEach-Object { $_.IPv4Address } |
          ForEach-Object { $_.IPAddress }
      )
    } catch {
      $Addresses = @(
        [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
          ForEach-Object { $_.ToString() }
      )
    }
  }

  return @(
    $Addresses |
      Where-Object { Test-CareBandLanIPv4Address $_ } |
      Sort-Object -Unique
  )
}

function Get-CareBandHardwareEventUrls {
  [CmdletBinding()]
  param(
    [ValidateRange(1, 65535)]
    [int]$Port = 3001,
    [string[]]$Addresses
  )

  if ($PSBoundParameters.ContainsKey('Addresses')) {
    $LanAddresses = @(Get-CareBandLanIPv4Addresses -CandidateAddresses $Addresses)
  } else {
    $LanAddresses = @(Get-CareBandLanIPv4Addresses)
  }

  return @(
    $LanAddresses | ForEach-Object { "http://$($_):$Port/api/events" }
  )
}

Export-ModuleMember -Function Get-CareBandBackendHost, Get-CareBandServeStaticFrontend, Get-CareBandLanIPv4Addresses, Get-CareBandHardwareEventUrls
