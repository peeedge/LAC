[CmdletBinding()]
param(
    [ValidateRange(1, 65535)]
    [int]$Port = 5173,
    [switch]$NoOpen,
    [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js is required. Install Node 20.19+ or 22.12+ from https://nodejs.org/.'
}

$nodeVersionText = (& node --version).Trim().TrimStart('v')
$nodeVersion = [version]$nodeVersionText
$nodeSupported =
    ($nodeVersion.Major -eq 20 -and $nodeVersion.Minor -ge 19) -or
    ($nodeVersion.Major -eq 22 -and $nodeVersion.Minor -ge 12) -or
    $nodeVersion.Major -gt 22

if (-not $nodeSupported) {
    throw "Node.js $nodeVersionText is unsupported. Install Node 20.19+ or 22.12+."
}

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    throw 'npm was not found. Reinstall Node.js with npm included.'
}

Push-Location $projectRoot
try {
    if (-not $SkipInstall) {
        Write-Host 'Installing LiteCAD dependencies...'
        & npm install
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed with exit code $LASTEXITCODE."
        }
    }

    $url = "http://127.0.0.1:$Port"
    Write-Host "Starting LiteCAD at $url"
    Write-Host 'Press Ctrl+C to stop the server.'

    $viteArguments = @('run', 'dev', '--', '--host', '127.0.0.1', '--port', "$Port")
    if (-not $NoOpen) {
        $viteArguments += '--open'
    }

    & npm @viteArguments
    $exitCode = $LASTEXITCODE
}
finally {
    Pop-Location
}

exit $exitCode
