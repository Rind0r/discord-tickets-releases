$ErrorActionPreference = 'Stop'
Push-Location $PSScriptRoot
try {
    & (Join-Path $PSScriptRoot 'Build.ps1')
    if ($LASTEXITCODE -ne 0) { throw 'Vencord build failed.' }
    $config = Get-Content -LiteralPath release.json -Raw -Encoding UTF8 | ConvertFrom-Json
    $installerSource = Join-Path $PSScriptRoot 'vendor\Installer'
    if (-not (Test-Path -LiteralPath (Join-Path $installerSource '.git'))) {
        & git clone --branch $config.installerTag --depth 1 https://github.com/Vencord/Installer.git $installerSource
        if ($LASTEXITCODE -ne 0) { throw 'Failed to get Installer source.' }
    } else {
        & git -C $installerSource fetch origin tag $config.installerTag
        if ($LASTEXITCODE -ne 0) { throw 'Failed to get matching Installer source tag.' }
    }
    $binary = Join-Path $PSScriptRoot 'vendor\Vencord\dist\Installer\VencordInstallerCli.exe'
    [IO.Directory]::CreateDirectory((Split-Path $binary -Parent)) | Out-Null
    if (-not (Test-Path -LiteralPath $binary)) { Invoke-WebRequest -UseBasicParsing -Uri "https://github.com/Vencord/Installer/releases/download/$($config.installerTag)/VencordInstallerCli.exe" -OutFile $binary }
    & node scripts/package.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Source packaging failed.' }
    & node scripts/build-installer.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Installer packaging failed.' }
} finally { Pop-Location }
