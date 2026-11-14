param([switch]$Rollback, [switch]$CheckOnly, [string]$DiscordPath, [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Discord-Tickets'), [string]$SettingsRoot = (Join-Path $env:APPDATA 'Vencord'))
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Engine.ps1')
try {
    if ($CheckOnly) { $bundle = Test-CSDTPayload $PSScriptRoot; Write-Host ('Пакет исправен. Версия ' + $bundle.version); exit 0 }
    if ($env:VENCORD_USER_DATA_DIR -and $SettingsRoot -ne $env:VENCORD_USER_DATA_DIR) { throw 'Обнаружена нестандартная папка данных Vencord. Запустите Install.ps1 с параметром -SettingsRoot, указывающим эту папку, чтобы сохранить ваши настройки.' }
    if ($Rollback) {
        $state = Read-CSDTJson (Join-Path $InstallRoot 'state.json')
        $discord = Get-CSDTDiscord $state.discordRoot
        if ($env:CSDT_CONFIRMED -ne '1') {
            Write-Host 'Откат вернёт предыдущее подключение. Discord будет закрыт. Текущие шаблоны и настройки сохраняются.'
            if ((Read-Host 'Продолжить? [Y/N]') -ne 'Y') { exit 0 }
        }
        Stop-CSDTDiscord $discord
        Restore-CSDT $InstallRoot $state.backup $discord
        Write-Host 'Предыдущее подключение восстановлено. Шаблоны сохранены.' -ForegroundColor Green
    } else {
        $null = Test-CSDTPayload $PSScriptRoot
        if (-not $DiscordPath) {
            $candidates = @(@('Discord', 'DiscordPTB', 'DiscordCanary') | ForEach-Object {
                $path = Join-Path $env:LOCALAPPDATA $_
                if (Test-Path -LiteralPath $path) { try { Get-CSDTDiscord $path } catch { } }
            })
            if (-not $candidates.Count) { throw 'Discord не установлен. Сначала установите обычный Discord с discord.com/download, войдите в свой аккаунт и повторно запустите этот файл.' }
            if ($candidates.Count -eq 1) { $discord = $candidates[0] }
            else {
                Write-Host 'Найдено несколько клиентов. Выберите нужный:'
                for ($i = 0; $i -lt $candidates.Count; $i++) { Write-Host (($i + 1).ToString() + '. ' + $candidates[$i].Root) }
                $choice = 0
                if (-not [int]::TryParse((Read-Host 'Номер'), [ref]$choice) -or $choice -lt 1 -or $choice -gt $candidates.Count) { throw 'Неверный номер клиента. Ничего не установлено.' }
                $discord = $candidates[$choice - 1]
            }
        } else { $discord = Get-CSDTDiscord $DiscordPath }
        if ($env:CSDT_CONFIRMED -ne '1') {
            Write-Host 'Установка/обновление Vencord с Discord Tickets. Выбранный Discord будет закрыт. Личные шаблоны сохраняются.'
            if ((Read-Host 'Продолжить? [Y/N]') -ne 'Y') { exit 0 }
        }
        $release = Install-CSDT $PSScriptRoot $InstallRoot $discord $SettingsRoot
        try { if ($env:CSDT_SETUP_EXE -and (Test-Path -LiteralPath $env:CSDT_SETUP_EXE)) {
            $manager = Join-Path $release 'Manager.exe'
            if (-not (Test-Path -LiteralPath $manager)) { Copy-Item -LiteralPath $env:CSDT_SETUP_EXE -Destination $manager }
            $programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Discord Tickets'
            [IO.Directory]::CreateDirectory($programs) | Out-Null
            $shell = New-Object -ComObject WScript.Shell
            foreach ($action in @(@('Обновить Discord Tickets', '--update'), @('Откатить Discord Tickets', '--rollback'))) {
                $shortcut = $shell.CreateShortcut((Join-Path $programs ($action[0] + '.lnk')))
                $shortcut.TargetPath = $manager; $shortcut.Arguments = $action[1]; $shortcut.WorkingDirectory = $InstallRoot
                $shortcut.Save()
            }
        } } catch { Write-Warning 'Установка завершена, но создать ярлыки не удалось. Для обновления запустите новый установщик из GitHub Releases.' }
    }
    if ($env:CSDT_RESULT_FILE) {
        Write-CSDTJson $env:CSDT_RESULT_FILE ([ordered]@{ executable = $discord.Exe })
    } else { Write-Host 'Установка завершена. Откройте Discord обычным ярлыком.' }
    exit 0
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
