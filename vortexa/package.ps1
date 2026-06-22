param(
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$vortexaDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = Resolve-Path (Join-Path $vortexaDir "..")
$webDir = Join-Path $root "web"
$outDir = Join-Path $webDir "out"
$stageDir = Join-Path $vortexaDir ".package"
$payloadDir = Join-Path $stageDir "payload"
$webDistDir = Join-Path $payloadDir "web_dist"
$distDir = Join-Path $vortexaDir "dist"
$payloadZipPath = Join-Path $distDir "payload.zip"
$packagesPath = Join-Path $distDir "python-packages.txt"
$requirementsPath = Join-Path $vortexaDir "requirements.txt"

function New-PortableZipFromDirectory([string]$SourceDir, [string]$DestinationPath) {
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem

    if (Test-Path -LiteralPath $DestinationPath) {
        Remove-Item -LiteralPath $DestinationPath -Force
    }

    $sourceRoot = (Resolve-Path -LiteralPath $SourceDir).Path.TrimEnd('\', '/')
    $zip = [System.IO.Compression.ZipFile]::Open($DestinationPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        Get-ChildItem -LiteralPath $SourceDir -Recurse -File | ForEach-Object {
            $relativePath = $_.FullName.Substring($sourceRoot.Length).TrimStart('\', '/')
            $entryName = $relativePath -replace '\\', '/'
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip,
                $_.FullName,
                $entryName,
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    } finally {
        $zip.Dispose()
    }
}

if (-not $SkipBuild) {
    Push-Location $webDir
    try {
        npm run build
    } finally {
        Pop-Location
    }
}

if (-not (Test-Path -LiteralPath $outDir)) {
    throw "Missing web/out. Run this script without -SkipBuild first."
}

$vortexaRoot = Resolve-Path -LiteralPath $vortexaDir
foreach ($path in @($stageDir, $distDir)) {
    if (Test-Path -LiteralPath $path) {
        $resolved = Resolve-Path -LiteralPath $path
        if (-not $resolved.Path.StartsWith($vortexaRoot.Path)) {
            throw "Refuse to remove directory outside vortexa folder: $($resolved.Path)"
        }
        Remove-Item -LiteralPath $resolved.Path -Recurse -Force
    }
}

New-Item -ItemType Directory -Path $payloadDir | Out-Null
New-Item -ItemType Directory -Path $distDir | Out-Null

$rootFiles = @("main.py", "VERSION")
foreach ($file in $rootFiles) {
    $source = Join-Path $root $file
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Missing required file: $file"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $payloadDir $file)
}

$sourceDirs = @("api", "services", "utils")
foreach ($dir in $sourceDirs) {
    $source = Join-Path $root $dir
    if (-not (Test-Path -LiteralPath $source)) {
        throw "Missing required directory: $dir"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $payloadDir $dir) -Recurse
}

Copy-Item -LiteralPath $outDir -Destination $webDistDir -Recurse

Get-ChildItem -LiteralPath $payloadDir -Recurse -Directory -Filter "__pycache__" |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
Get-ChildItem -LiteralPath $payloadDir -Recurse -File |
    Where-Object { $_.Extension -in @(".pyc", ".pyo") } |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }

New-PortableZipFromDirectory -SourceDir $payloadDir -DestinationPath $payloadZipPath
Copy-Item -LiteralPath (Join-Path $vortexaDir "app.py") -Destination (Join-Path $distDir "app.py")
Copy-Item -LiteralPath $requirementsPath -Destination (Join-Path $distDir "requirements.txt")

$requirements = Get-Content -LiteralPath $requirementsPath |
    Where-Object { $_.Trim() -and -not $_.Trim().StartsWith("#") }
[System.IO.File]::WriteAllText($packagesPath, ($requirements -join " "), [System.Text.UTF8Encoding]::new($false))
[System.IO.File]::WriteAllText(
    (Join-Path $distDir "auth-key.example.txt"),
    "replace-with-your-strong-auth-key",
    [System.Text.UTF8Encoding]::new($false)
)
[System.IO.File]::WriteAllText(
    (Join-Path $distDir "config.example.json"),
    "{`n  `"auth-key`": `"replace-with-your-strong-auth-key`"`n}`n",
    [System.Text.UTF8Encoding]::new($false)
)

Get-ChildItem -LiteralPath $distDir | Select-Object FullName, Length
