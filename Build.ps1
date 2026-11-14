param(
    [string]$VencordPath = (Join-Path $PSScriptRoot "vendor\Vencord")
)

$ErrorActionPreference = "Stop"
$referenceCommit = "d07030c0968e31e41caa0c35fda0ef8ae63a079e"

function Assert-NativeSuccess([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed (exit $LASTEXITCODE)." }
}

foreach ($tool in @("git", "node", "pnpm")) {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "Install $tool and reopen PowerShell. See README.md." }
}
if ([int]((& node -p "process.versions.node.split('.')[0]") | Select-Object -Last 1) -lt 22) { throw "Node.js 22 or newer is required." }

$VencordPath = [IO.Path]::GetFullPath($VencordPath)
if (-not (Test-Path -LiteralPath (Join-Path $VencordPath "package.json"))) {
    if (Test-Path -LiteralPath $VencordPath) { throw "Target exists but is not a Vencord checkout. Choose an empty path." }
    $parent = Split-Path -Parent $VencordPath
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
    & git clone https://github.com/Vendicated/Vencord.git $VencordPath
    Assert-NativeSuccess "Clone Vencord"
    & git -C $VencordPath checkout --detach $referenceCommit
    Assert-NativeSuccess "Select tested Vencord revision"
}

$destination = Join-Path $VencordPath "src\userplugins\discordTickets"
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$pluginSource = Join-Path $PSScriptRoot "plugin\discordTickets"
foreach ($file in Get-ChildItem -LiteralPath $pluginSource -File) {
    Copy-Item -LiteralPath $file.FullName -Destination $destination -Force
}

Push-Location $VencordPath
try {
    & pnpm install --frozen-lockfile
    Assert-NativeSuccess "Install dependencies"
    & pnpm test:ts
    Assert-NativeSuccess "Check TypeScript"
    & node (Join-Path $PSScriptRoot "scripts\check-bootstrap.mjs") $VencordPath
    Assert-NativeSuccess "Check plugin bootstrap before Discord React"
    & pnpm build --dev --disable-updater
    Assert-NativeSuccess "Build Vencord"
    Write-Host "Build ready: $(Join-Path $VencordPath 'dist')"
    Write-Host "Discord was not modified. See README.md for pnpm inject and enabling the plugin."
} finally { Pop-Location }
