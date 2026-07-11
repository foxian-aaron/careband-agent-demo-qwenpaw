param(
  [int]$BackendTests,
  [int]$FrontendTests,
  [string]$DeckPath = 'deliverables/CareBand_v0.2_pitch_deck.pptx'
)

$ErrorActionPreference = 'Stop'

if ($BackendTests -lt 1 -or $FrontendTests -lt 1) {
  throw 'BackendTests and FrontendTests must both be positive.'
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$ResolvedDeck = (Resolve-Path -LiteralPath $DeckPath).Path
$Archive = [System.IO.Compression.ZipFile]::Open(
  $ResolvedDeck,
  [System.IO.Compression.ZipArchiveMode]::Update
)

try {
  $SlidePath = 'ppt/slides/slide7.xml'
  $Slide = $Archive.GetEntry($SlidePath)
  if (-not $Slide) {
    throw "Missing $SlidePath in $ResolvedDeck"
  }

  $Reader = [System.IO.StreamReader]::new($Slide.Open())
  try {
    $Xml = $Reader.ReadToEnd()
  } finally {
    $Reader.Dispose()
  }

  $BackendPattern = '(?<=<a:t>)\d+ / \d+(?=</a:t>)'
  $Matches = [regex]::Matches($Xml, $BackendPattern)
  if ($Matches.Count -lt 2) {
    throw 'Could not locate the backend and frontend test counters on slide 7.'
  }

  $Updated = [regex]::Replace(
    $Xml,
    $BackendPattern,
    { param($Match)
      if ($Match.Index -eq $Matches[0].Index) {
        return "$BackendTests / $BackendTests"
      }
      if ($Match.Index -eq $Matches[1].Index) {
        return "$FrontendTests / $FrontendTests"
      }
      return $Match.Value
    }
  )

  $Slide.Delete()
  $Replacement = $Archive.CreateEntry(
    $SlidePath,
    [System.IO.Compression.CompressionLevel]::Optimal
  )
  $Utf8WithoutBom = [System.Text.UTF8Encoding]::new($false)
  $Writer = [System.IO.StreamWriter]::new($Replacement.Open(), $Utf8WithoutBom)
  try {
    $Writer.Write($Updated)
  } finally {
    $Writer.Dispose()
  }
} finally {
  $Archive.Dispose()
}

Write-Host "Updated pitch test counters to backend $BackendTests and frontend $FrontendTests."
