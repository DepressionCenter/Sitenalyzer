<#
This file is part of Sitenalyzer
build.ps1
Author(s): Gabriel Mongefranco.
Created: 2026-10-14
Last Modified: 2026-10-19
Summary: Builds the files that site owners copy to SharePoint. Reads src/ and writes dist/.
         Runs with the Windows PowerShell 5.1 that comes with Windows, or with PowerShell 7 on
         any system. build.sh does the same work in bash, and both scripts must write identical
         files; CI checks this on every pull request.
Notes: See README file for documentation and full license information.
       Usage: .\build.ps1
       This file is saved as UTF-8 with a byte order mark so Windows PowerShell 5.1 reads it correctly.

Copyright © 2026 The Regents of the University of Michigan

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU General Public License for more details.

You should have received a copy of the GNU General Public License along
with this program. If not, see <https://www.gnu.org/licenses/>.
#>

[CmdletBinding()]
param()

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

### Load Configuration ###
$RepoRoot = $PSScriptRoot
$SrcDir = Join-Path $RepoRoot 'src'
$LibDir = Join-Path $SrcDir 'lib'
$DistDir = Join-Path $RepoRoot 'dist'
$ScriptsOut = Join-Path (Join-Path $DistDir 'SiteAssets') 'scripts'
$StylesOut = Join-Path (Join-Path $DistDir 'SiteAssets') 'styles'
$PagesOut = Join-Path $DistDir 'SitePages'
$ChecksumFile = Join-Path $LibDir 'sha256sums.txt'
# The build replaces this exact line in src/sitenalyzer.js with the markup from src/sitenalyzer.html.
$AppHtmlMarker = 'var SNA_APP_HTML = [];'
# The build replaces this exact line in src/sitenalyzer.js with the version of the style sheets and libraries.
$AssetVersionMarker = "var SNA_ASSET_VERSION = '';"
# UTF-8 without a byte order mark, so the output matches build.sh byte for byte.
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:FilesWritten = 0

function Stop-Build([string]$Message) {
    [Console]::Error.WriteLine("Build failed: $Message")
    exit 1
}

# Prints a file's path relative to the repository and counts it.
function Write-Written([string]$Path) {
    $relative = $Path.Substring($RepoRoot.Length + 1).Replace('\', '/')
    Write-Host "  $relative"
    $script:FilesWritten++
}

# Reads a text file as UTF-8 and returns its lines with carriage returns removed.
# A final line ending does not count as an extra empty line, which matches how sed and awk read files.
function Read-TextLines([string]$Path) {
    $text = [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8).Replace("`r", '')
    if ($text.Length -eq 0) { return ,@() }
    if ($text.EndsWith("`n")) { $text = $text.Substring(0, $text.Length - 1) }
    return ,$text.Split("`n")
}

# Writes lines joined with LF and ending with LF, in UTF-8 without a byte order mark.
function Write-TextLines([string]$Path, [string[]]$Lines) {
    $text = ($Lines -join "`n") + "`n"
    [System.IO.File]::WriteAllText($Path, $text, $Utf8NoBom)
    Write-Written $Path
}

# Copies a text file with carriage returns removed, so every build writes LF line endings.
function Copy-TextFile([string]$Source, [string]$Destination) {
    $text = [System.IO.File]::ReadAllText($Source, [System.Text.Encoding]::UTF8).Replace("`r", '')
    [System.IO.File]::WriteAllText($Destination, $text, $Utf8NoBom)
    Write-Written $Destination
}

function Copy-BinaryFile([string]$Source, [string]$Destination) {
    Copy-Item -LiteralPath $Source -Destination $Destination
    Write-Written $Destination
}

### Validate Inputs ###
foreach ($sourceFile in @('sitenalyzer.js', 'sitenalyzer.html', 'sitenalyzer.css', 'sitenalyzer.html.txt', 'lib/sha256sums.txt')) {
    if (-not (Test-Path -LiteralPath (Join-Path $SrcDir $sourceFile) -PathType Leaf)) {
        Stop-Build "src/$sourceFile is missing. Restore it from git and run the build again."
    }
}

$appLines = Read-TextLines (Join-Path $SrcDir 'sitenalyzer.js')
$markerCount = @($appLines | Where-Object { $_ -ceq $AppHtmlMarker }).Count
if ($markerCount -ne 1) {
    Stop-Build "src/sitenalyzer.js must contain the line '$AppHtmlMarker' exactly once, but it appears $markerCount times."
}
$versionMarkerCount = @($appLines | Where-Object { $_ -ceq $AssetVersionMarker }).Count
if ($versionMarkerCount -ne 1) {
    Stop-Build "src/sitenalyzer.js must contain the line '$AssetVersionMarker' exactly once, but it appears $versionMarkerCount times."
}

# Only files listed in sha256sums.txt are copied, so an unexpected or changed library never reaches dist/.
$libraryFiles = @()
foreach ($checksumLine in (Read-TextLines $ChecksumFile)) {
    if ($checksumLine.Trim().Length -eq 0) { continue }
    $parts = $checksumLine.Trim() -split '\s+', 2
    $expectedHash = $parts[0].ToLowerInvariant()
    $libraryName = $parts[1]
    $libraryPath = Join-Path $LibDir $libraryName
    if (-not (Test-Path -LiteralPath $libraryPath -PathType Leaf)) {
        Stop-Build "src/lib/$libraryName is listed in src/lib/sha256sums.txt but the file is missing."
    }
    $actualHash = (Get-FileHash -LiteralPath $libraryPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualHash -ne $expectedHash) {
        Stop-Build "src/lib/$libraryName does not match its checksum in src/lib/sha256sums.txt. If you replaced this library on purpose, update its line in that file."
    }
    $libraryFiles += $libraryName
}
if ($libraryFiles.Count -eq 0) {
    Stop-Build 'src/lib/sha256sums.txt does not list any library files.'
}

### Prepare Output Folder ###
# dist/ holds only build results, so deleting it first removes files that are no longer built.
if (Test-Path -LiteralPath $DistDir) { Remove-Item -LiteralPath $DistDir -Recurse -Force }
foreach ($folder in @($ScriptsOut, $StylesOut, $PagesOut)) {
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
}
Write-Host 'Building Sitenalyzer into dist/...'

### Copy Libraries ###
# Libraries are copied byte for byte. License texts go in both folders, because the
# Tabulator style sheet has no license notice of its own.
foreach ($libraryName in $libraryFiles) {
    $libraryPath = Join-Path $LibDir $libraryName
    if ($libraryName.EndsWith('.css')) {
        Copy-BinaryFile $libraryPath (Join-Path $StylesOut $libraryName)
    } elseif ($libraryName.EndsWith('.txt')) {
        Copy-BinaryFile $libraryPath (Join-Path $ScriptsOut $libraryName)
        Copy-BinaryFile $libraryPath (Join-Path $StylesOut $libraryName)
    } else {
        Copy-BinaryFile $libraryPath (Join-Path $ScriptsOut $libraryName)
    }
}

### Build sitenalyzer.js ###
# The version is the first 12 characters of the SHA-256 checksum of sitenalyzer.css followed by sha256sums.txt,
# both with carriage returns removed. It changes whenever the app styles or a library change. build.sh computes
# the same value.
$versionText = [System.IO.File]::ReadAllText((Join-Path $SrcDir 'sitenalyzer.css'), [System.Text.Encoding]::UTF8).Replace("`r", '') +
    [System.IO.File]::ReadAllText($ChecksumFile, [System.Text.Encoding]::UTF8).Replace("`r", '')
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$versionHash = $sha256.ComputeHash($Utf8NoBom.GetBytes($versionText))
$sha256.Dispose()
$assetVersion = (-join ($versionHash | ForEach-Object { $_.ToString('x2') })).Substring(0, 12)

# Drop the license comment at the top of the markup, then turn each line into a quoted JavaScript
# string. Escaping rules, shared with build.sh: \ becomes \\, " becomes \", and a tab becomes \t.
$markupLines = Read-TextLines (Join-Path $SrcDir 'sitenalyzer.html')
$quotedMarkup = New-Object System.Collections.Generic.List[string]
$inHeader = $false
for ($i = 0; $i -lt $markupLines.Length; $i++) {
    $line = $markupLines[$i]
    if ($i -eq 0 -and $line.StartsWith('<!--')) { $inHeader = $true }
    if ($inHeader) {
        if ($line.Contains('-->')) { $inHeader = $false }
        continue
    }
    $escaped = $line.Replace('\', '\\').Replace('"', '\"').Replace("`t", '\t')
    $quotedMarkup.Add('    "' + $escaped + '",')
}

$builtApp = New-Object System.Collections.Generic.List[string]
foreach ($line in $appLines) {
    if ($line -ceq $AppHtmlMarker) {
        $builtApp.Add('var SNA_APP_HTML = [')
        foreach ($quotedLine in $quotedMarkup) { $builtApp.Add($quotedLine) }
        $builtApp.Add('];')
    } elseif ($line -ceq $AssetVersionMarker) {
        $builtApp.Add("var SNA_ASSET_VERSION = '$assetVersion';")
    } else {
        $builtApp.Add($line)
    }
}
Write-TextLines (Join-Path $ScriptsOut 'sitenalyzer.js') $builtApp.ToArray()

### Copy App Styles and Page Code ###
Copy-TextFile (Join-Path $SrcDir 'sitenalyzer.css') (Join-Path $StylesOut 'sitenalyzer.css')
Copy-TextFile (Join-Path $SrcDir 'sitenalyzer.html.txt') (Join-Path $PagesOut 'sitenalyzer.html.txt')

if ($script:FilesWritten -eq 1) {
    Write-Host 'Build finished. Wrote 1 file to dist/.'
} else {
    Write-Host "Build finished. Wrote $($script:FilesWritten) files to dist/."
}
