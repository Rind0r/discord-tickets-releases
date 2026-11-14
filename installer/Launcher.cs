// Discord Tickets, by Luf. GPL-3.0-or-later.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Net;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows.Forms;

[assembly: AssemblyTitle("Discord Tickets")]
[assembly: AssemblyProduct("Discord Tickets")]
[assembly: AssemblyCompany("Luf")]
[assembly: AssemblyVersion("@VERSION@.0")]
[assembly: AssemblyFileVersion("@VERSION@.0")]

class Launcher {
    const string Version = "@VERSION@";
    const string Repository = "@REPOSITORY@";
    const string PayloadHash = "@PAYLOAD_HASH@";
    static string Hash(Stream input) {
        using (var sha = SHA256.Create()) { return BitConverter.ToString(sha.ComputeHash(input)).Replace("-", "").ToLowerInvariant(); }
    }
    static void Download(string url, string file, long limit) {
        var request = (HttpWebRequest)WebRequest.Create(url);
        request.Timeout = 30000; request.ReadWriteTimeout = 30000;
        request.UserAgent = "Discord-Tickets-Installer";
        using (var response = request.GetResponse()) {
            if (response.ContentLength > limit) throw new Exception("Файл обновления превышает допустимый размер.");
            using (var source = response.GetResponseStream()) using (var output = File.Create(file)) {
                var buffer = new byte[65536]; long total = 0; int count;
                while ((count = source.Read(buffer, 0, buffer.Length)) > 0) {
                    total += count; if (total > limit) throw new Exception("Файл обновления слишком большой.");
                    output.Write(buffer, 0, count);
                }
            }
        }
    }
    static string NewTemporaryDirectory() {
        string path = Path.Combine(Path.GetTempPath(), "Discord-Tickets-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(path); return path;
    }
    static string UpdateUrl(Dictionary<string, object> manifest, string current) {
        string next = Convert.ToString(manifest["version"]);
        System.Version parsed;
        if (!(manifest["format"] is int) || (int)manifest["format"] != 1 || !System.Text.RegularExpressions.Regex.IsMatch(next, "^[0-9]+\\.[0-9]+\\.[0-9]+$") || !System.Version.TryParse(next, out parsed))
            throw new Exception("Неверный формат информации об обновлении.");
        string expected = "https://github.com/" + Repository + "/releases/download/v" + next + "/Discord-Tickets-Setup.exe";
        if (Convert.ToString(manifest["url"]) != expected) throw new Exception("Обновление указывает на неизвестный адрес.");
        if (!System.Text.RegularExpressions.Regex.IsMatch(Convert.ToString(manifest["sha256"]), "^[a-f0-9]{64}$")) throw new Exception("Не указан SHA256 обновления.");
        return parsed > new System.Version(current) ? expected : null;
    }
    static int SelfTest() {
        var good = new Dictionary<string, object> { {"format", 1}, {"version", "999.0.0"}, {"sha256", new string('a', 64)}, {"url", "https://github.com/" + Repository + "/releases/download/v999.0.0/Discord-Tickets-Setup.exe"} };
        if (UpdateUrl(good, Version) == null || UpdateUrl(good, "999.0.0") != null || UpdateUrl(good, "999.1.0") != null) throw new Exception("Update version comparison failed");
        foreach (var key in new [] { "url", "sha256", "format", "version" }) {
            var bad = new Dictionary<string, object>(good);
            bad[key] = key == "url" ? "https://example.invalid/installer.exe" : key == "sha256" ? "broken" : key == "format" ? (object)2 : "999.0.0-beta";
            bool rejected = false; try { UpdateUrl(bad, Version); } catch { rejected = true; }
            if (!rejected) throw new Exception("Invalid update manifest accepted: " + key);
        }
        Console.WriteLine("Updater validation passed: upgrade, same version, downgrade, foreign URL, bad hash, format and version. No network or installation.");
        return 0;
    }
    static int Update() {
        ServicePointManager.SecurityProtocol = SecurityProtocolType.Tls12;
        string temp = NewTemporaryDirectory();
        try {
            Console.WriteLine("Проверяю обновления на GitHub...");
            string manifestPath = Path.Combine(temp, "latest.json");
            Download("https://github.com/" + Repository + "/releases/latest/download/latest.json", manifestPath, 65536);
            var manifest = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(manifestPath));
            string current = "0.0.0";
            string state = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Discord-Tickets", "state.json");
            if (File.Exists(state)) current = Convert.ToString(new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(File.ReadAllText(state))["version"]);
            string expectedUrl = UpdateUrl(manifest, current);
            if (expectedUrl == null) {
                MessageBox.Show("Установлена последняя опубликованная версия: " + current, "Discord Tickets"); return 0;
            }
            string expectedHash = Convert.ToString(manifest["sha256"]);
            string setup = Path.Combine(temp, "Discord-Tickets-Setup.exe");
            Download(expectedUrl, setup, 67108864);
            using (var input = File.OpenRead(setup)) { if (Hash(input) != expectedHash) throw new Exception("Файл обновления повреждён. Установка отменена."); }
            // The new installer shows its own confirmation before closing Discord.
            Process.Start(new ProcessStartInfo(setup) { UseShellExecute = true });
            // Keep the downloaded executable until it finishes; Windows locks it while running.
            return 0;
        } catch { throw new Exception("Не удалось получить обновление. Проверьте интернет и наличие опубликованного Release в GitHub. Discord и ваши шаблоны не изменены."); }
    }
    [STAThread]
    static int Main(string[] args) {
        Console.OutputEncoding = Encoding.UTF8;
        try {
            if (args.Length > 1 || (args.Length == 1 && args[0] != "--verify" && args[0] != "--rollback" && args[0] != "--update" && args[0] != "--self-test")) throw new Exception("Неизвестный параметр запуска.");
            if (args.Length == 1 && args[0] == "--self-test") return SelfTest();
            if (args.Length == 1 && args[0] == "--update") return Update();
            byte[] bytes;
            using (var payload = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip")) {
                if (payload == null) throw new Exception("В установщике отсутствует пакет.");
                if (Hash(payload) != PayloadHash) throw new Exception("Установщик повреждён: SHA256 пакета не совпадает.");
                payload.Position = 0;
                using (var memory = new MemoryStream()) { payload.CopyTo(memory); bytes = memory.ToArray(); }
            }
            if (args.Length == 1 && args[0] == "--verify") { Console.WriteLine("Embedded payload SHA256 verified. Version " + Version); return 0; }
            bool rollback = args.Length == 1 && args[0] == "--rollback";
            string prompt = rollback ? "Вернуть предыдущее подключение? Текущие шаблоны и настройки сохранятся."
                : "Установить или обновить Discord Tickets " + Version + "?\n\nБудет подключена сборка Vencord с плагином by Luf. Обычные настройки и личные шаблоны сохраняются. Другие пользовательские плагины из чужих сборок не переносятся.";
            prompt += "\n\nВыбранный Discord будет полностью закрыт, затем запущен заново. Сохраните несохранённые изменения. Продолжить?";
            if (MessageBox.Show(prompt, "Discord Tickets", MessageBoxButtons.YesNo, MessageBoxIcon.Information) != DialogResult.Yes) return 0;
            string directory = NewTemporaryDirectory();
            try {
                using (var zip = new ZipArchive(new MemoryStream(bytes), ZipArchiveMode.Read)) {
                    foreach (var entry in zip.Entries) {
                        string destination = Path.GetFullPath(Path.Combine(directory, entry.FullName));
                        if (!destination.StartsWith(directory + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new Exception("Небезопасный путь в пакете.");
                        Directory.CreateDirectory(Path.GetDirectoryName(destination));
                        entry.ExtractToFile(destination);
                    }
                }
                var process = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe"));
                process.UseShellExecute = false;
                process.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \"" + Path.Combine(directory, "Install.ps1") + "\"" + (rollback ? " -Rollback" : "");
                process.EnvironmentVariables["CSDT_CONFIRMED"] = "1";
                process.EnvironmentVariables["CSDT_SETUP_EXE"] = Assembly.GetExecutingAssembly().Location;
                using (var child = Process.Start(process)) { child.WaitForExit(); if (child.ExitCode != 0) throw new Exception("Установка не завершена. Подробности указаны в окне установщика. Предыдущая версия сохранена в резервной копии."); }
                MessageBox.Show(rollback ? "Предыдущее подключение восстановлено." : "Готово! Плагин установлен. Discord запущен.\n\nОбновление: ярлык «Обновить Discord Tickets» в меню Пуск или новый установщик из GitHub Releases.", "Discord Tickets");
                return 0;
            } finally {
                // This is our newly created extraction directory, never a user-supplied path.
                if (directory.StartsWith(Path.GetTempPath(), StringComparison.OrdinalIgnoreCase)) { try { Directory.Delete(directory, true); } catch { } }
            }
        } catch (Exception error) {
            Console.Error.WriteLine(error.Message);
            if (!(args.Length == 1 && (args[0] == "--verify" || args[0] == "--self-test"))) MessageBox.Show(error.Message, "Discord Tickets — ошибка", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
}
