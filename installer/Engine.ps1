Set-StrictMode -Version 2
$ErrorActionPreference = 'Stop'

function Write-CSDTJson($Path, $Value) {
    $parent = Split-Path -Parent $Path
    [IO.Directory]::CreateDirectory($parent) | Out-Null
    $temporary = $Path + '.tmp-' + [guid]::NewGuid().ToString('N')
    [IO.File]::WriteAllText($temporary, ($Value | ConvertTo-Json -Depth 100), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
}
function Read-CSDTJson($Path) { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
function Get-CSDTHash($Path) {
    $inputFile = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($inputFile)).Replace('-', '').ToLowerInvariant() }
    finally { $algorithm.Dispose(); $inputFile.Dispose() }
}
function Assert-CSDTChild($Path, $Root) {
    $absolute = [IO.Path]::GetFullPath($Path)
    $boundary = [IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    if (-not $absolute.StartsWith($boundary, [StringComparison]::OrdinalIgnoreCase)) { throw 'Путь выходит за пределы папки установки.' }
    return $absolute
}
function Get-CSDTDiscord($Root) {
    $Root = [IO.Path]::GetFullPath($Root)
    $app = Get-ChildItem -LiteralPath $Root -Directory | Where-Object {
        $_.Name -match '^app-\d+(\.\d+)+$' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'resources\app.asar'))
    } | Sort-Object { [version]$_.Name.Substring(4) } -Descending | Select-Object -First 1
    if (-not $app) { throw 'Установленный Discord не найден. Нужен обычный Discord для Windows (не браузер и не Microsoft Store).' }
    return [pscustomobject]@{ Root = $Root; Resources = (Assert-CSDTChild (Join-Path $app.FullName 'resources') $Root); Exe = (Join-Path $app.FullName ((Split-Path $Root -Leaf) + '.exe')) }
}
function Test-CSDTPayload($Payload) {
    $manifest = Read-CSDTJson (Join-Path $Payload 'bundle.json')
    if ($manifest.format -ne 1 -or $manifest.version -notmatch '^\d+\.\d+\.\d+$' -or $manifest.releaseId -notmatch '^\d+\.\d+\.\d+-[a-f0-9]{12}$') { throw 'Неверный формат установочного пакета.' }
    foreach ($item in $manifest.files.PSObject.Properties) {
        $file = Assert-CSDTChild (Join-Path $Payload $item.Name) $Payload
        if ($item.Value -notmatch '^[a-f0-9]{64}$' -or (Get-CSDTHash $file) -ne $item.Value) { throw 'Пакет повреждён: проверка SHA256 не пройдена.' }
    }
    foreach ($required in @('dist/patcher.js', 'dist/preload.js', 'dist/renderer.js', 'dist/renderer.css', 'tools/VencordInstallerCli.exe', 'Install.ps1', 'Engine.ps1')) {
        if (-not $manifest.files.PSObject.Properties[$required]) { throw 'В установочном пакете отсутствует обязательный файл.' }
    }
    if (-not [IO.File]::ReadAllText((Join-Path $Payload 'dist\renderer.js')).Contains('CYBERSHOKE Discord Tickets')) { throw 'Сборка не содержит плагин.' }
    return $manifest
}
function Stop-CSDTDiscord($Discord) {
    $prefix = $Discord.Root.TrimEnd('\') + '\'
    Get-Process -ErrorAction SilentlyContinue | ForEach-Object {
        $process = $_
        try { $path = $process.Path } catch { $path = $null }
        if ($path -and $path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
            Stop-Process -Id $process.Id -Force -ErrorAction Stop
        }
    }
    Start-Sleep -Milliseconds 600
}
function Invoke-CSDTOfficialInstaller($Release, $Discord) {
    $oldData = $env:VENCORD_USER_DATA_DIR; $oldDev = $env:VENCORD_DEV_INSTALL
    try {
        $env:VENCORD_USER_DATA_DIR = $Release
        $env:VENCORD_DEV_INSTALL = '1'
        & (Join-Path $Release 'tools\VencordInstallerCli.exe') --install --location $Discord.Root
        if ($LASTEXITCODE -ne 0) { throw "Установщик Vencord завершился с кодом $LASTEXITCODE." }
    } finally { $env:VENCORD_USER_DATA_DIR = $oldData; $env:VENCORD_DEV_INSTALL = $oldDev }
}
function Test-CSDTConnection($Release, $Discord) {
    $patcher = Join-Path $Release 'dist\patcher.js'
    $bytes = [IO.File]::ReadAllBytes((Join-Path $Discord.Resources 'app.asar'))
    $text = [Text.Encoding]::UTF8.GetString($bytes)
    return $text.Contains($patcher.Replace('\', '\\')) -or $text.Contains($patcher.Replace('\', '/'))
}
function Enable-CSDTPlugin($SettingsRoot) {
    $file = Join-Path $SettingsRoot 'settings\settings.json'
    $settings = if (Test-Path -LiteralPath $file) { Read-CSDTJson $file } else { [pscustomobject]@{} }
    if ($settings -isnot [pscustomobject]) { throw 'Неверный формат настроек Vencord. Исходный файл не изменён.' }
    if (-not $settings.PSObject.Properties['plugins']) { $settings | Add-Member NoteProperty plugins ([pscustomobject]@{}) }
    if ($settings.plugins -isnot [pscustomobject]) { throw 'Неверный список плагинов в настройках Vencord.' }
    $name = 'CYBERSHOKE Discord Tickets'
    if (-not $settings.plugins.PSObject.Properties[$name]) { $settings.plugins | Add-Member NoteProperty $name ([pscustomobject]@{}) }
    if ($settings.plugins.$name -isnot [pscustomobject]) { throw 'Неверный формат настроек плагина.' }
    # Respect an explicit user disable on subsequent updates.
    if (-not $settings.plugins.$name.PSObject.Properties['enabled']) { $settings.plugins.$name | Add-Member NoteProperty enabled $true }
    Write-CSDTJson $file $settings
}
function Backup-CSDT($Root, $Discord, $SettingsRoot) {
    $backup = Assert-CSDTChild (Join-Path $Root ('backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + [guid]::NewGuid().ToString('N'))) $Root
    [IO.Directory]::CreateDirectory($backup) | Out-Null
    foreach ($name in @('app.asar', '_app.asar')) {
        $file = Join-Path $Discord.Resources $name
        if (Test-Path -LiteralPath $file) { Copy-Item -LiteralPath $file -Destination (Join-Path $backup $name) }
    }
    $settings = Join-Path $SettingsRoot 'settings\settings.json'
    $state = Join-Path $Root 'state.json'
    if (Test-Path -LiteralPath $settings) { Copy-Item -LiteralPath $settings -Destination (Join-Path $backup 'settings.json') }
    if (Test-Path -LiteralPath $state) { Copy-Item -LiteralPath $state -Destination (Join-Path $backup 'state.json') }
    Write-CSDTJson (Join-Path $backup 'backup.json') ([ordered]@{ resources = $Discord.Resources; settingsRoot = $SettingsRoot; discordRoot = $Discord.Root })
    return $backup
}
function Restore-CSDT($Root, $Backup, $Discord, [switch]$RestoreSettings) {
    $Backup = Assert-CSDTChild $Backup (Join-Path $Root 'backups')
    $meta = Read-CSDTJson (Join-Path $Backup 'backup.json')
    if ($meta.resources -ne $Discord.Resources) { throw 'Discord обновился после создания копии. Старые файлы Discord восстанавливать нельзя. Запустите установщик новой версии для восстановления подключения.' }
    foreach ($name in @('app.asar', '_app.asar')) {
        $destination = Assert-CSDTChild (Join-Path $Discord.Resources $name) $Discord.Root
        $original = Join-Path $Backup $name
        if (Test-Path -LiteralPath $original) { Copy-Item -LiteralPath $original -Destination $destination -Force }
        elseif (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Force }
    }
    if ($RestoreSettings) {
        $file = Join-Path $meta.settingsRoot 'settings\settings.json'
        if (Test-Path -LiteralPath (Join-Path $Backup 'settings.json')) { Copy-Item -LiteralPath (Join-Path $Backup 'settings.json') -Destination $file -Force }
        elseif (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file -Force }
    }
    $state = Join-Path $Root 'state.json'
    if (Test-Path -LiteralPath (Join-Path $Backup 'state.json')) { Copy-Item -LiteralPath (Join-Path $Backup 'state.json') -Destination $state -Force }
    elseif (Test-Path -LiteralPath $state) { Remove-Item -LiteralPath $state -Force }
}
function Install-CSDT($Payload, $Root, $Discord, $SettingsRoot) {
    $manifest = Test-CSDTPayload $Payload
    # Parse before stopping Discord or modifying its connection.
    $settingsFile = Join-Path $SettingsRoot 'settings\settings.json'
    if (Test-Path -LiteralPath $settingsFile) { $null = Read-CSDTJson $settingsFile }
    $release = Assert-CSDTChild (Join-Path $Root ('releases\' + $manifest.releaseId)) $Root
    if (Test-Path -LiteralPath $release) {
        $existing = Test-CSDTPayload $release
        if ($existing.releaseId -ne $manifest.releaseId) { throw 'Конфликт установленной версии.' }
    } else {
        [IO.Directory]::CreateDirectory($release) | Out-Null
        Copy-Item -Path (Join-Path $Payload '*') -Destination $release -Recurse -Force
        $null = Test-CSDTPayload $release
    }
    Write-Host 'Закрываю выбранный Discord и сохраняю резервную копию...'
    Stop-CSDTDiscord $Discord
    $backup = Backup-CSDT $Root $Discord $SettingsRoot
    try {
        Write-Host 'Подключаю сборку Vencord с CYBERSHOKE Discord Tickets...'
        Invoke-CSDTOfficialInstaller $release $Discord
        if (-not (Test-CSDTConnection $release $Discord)) { throw 'Установщик завершился, но подключение новой сборки не подтвердилось.' }
        Enable-CSDTPlugin $SettingsRoot
        Write-CSDTJson (Join-Path $Root 'state.json') ([ordered]@{ format = 1; version = $manifest.version; release = $release; backup = $backup; discordRoot = $Discord.Root; settingsRoot = $SettingsRoot })
        $command = '@echo off' + "`r`n" + 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $release 'Install.ps1') + '" -Rollback' + "`r`n" + 'pause' + "`r`n"
        [IO.File]::WriteAllText((Join-Path $Root 'Rollback.cmd'), $command, [Text.Encoding]::Default)
        Write-Host ('Готово. Версия ' + $manifest.version + '. Шаблоны и личные данные остаются на месте.') -ForegroundColor Green
        return $release
    } catch {
        $failure = $_
        try { Restore-CSDT $Root $backup $Discord -RestoreSettings; Write-Host 'Ошибка установки. Предыдущее подключение восстановлено.' -ForegroundColor Yellow }
        catch { throw ('Ошибка установки и отката. Резервная копия: ' + $backup + '. Причина отката: ' + $_.Exception.Message) }
        throw $failure
    }
}
