$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = Split-Path -Parent $PSScriptRoot
$distPath = Join-Path $projectRoot 'apps/web/dist'
$buildPath = Join-Path $projectRoot 'build'
$archivePath = Join-Path $buildPath 'inksign-web.zip'
$temporaryPath = "$archivePath.tmp"

if (-not (Test-Path -LiteralPath (Join-Path $distPath 'index.html'))) {
    throw 'Missing production build: apps/web/dist/index.html'
}

New-Item -ItemType Directory -Path $buildPath -Force | Out-Null

try {
    $archive = [System.IO.Compression.ZipFile]::Open($temporaryPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem -LiteralPath $distPath -File -Recurse -Force) {
            $entryName = $file.FullName.Substring($distPath.Length + 1).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $file.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal) | Out-Null
        }
    }
    finally {
        $archive.Dispose()
    }

    Move-Item -LiteralPath $temporaryPath -Destination $archivePath -Force
    Write-Host "Deployment ZIP: $archivePath"
}
finally {
    if (Test-Path -LiteralPath $temporaryPath) {
        Remove-Item -LiteralPath $temporaryPath
    }
}
