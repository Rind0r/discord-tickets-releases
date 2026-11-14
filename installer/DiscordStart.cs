// Discord Tickets, by Luf. GPL-3.0-or-later.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;

public static class DiscordStart {
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool FreeConsole();

    public static ProcessStartInfo Options(string executable) {
        return new ProcessStartInfo(executable) {
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = Path.GetDirectoryName(executable)
        };
    }

    public static void Start(string executable) {
        if (!File.Exists(executable)) throw new FileNotFoundException("Discord не найден. Откройте его обычным ярлыком.");
        // Electron may attach itself to its parent's console even though its EXE
        // uses the GUI subsystem. Detach our own installer before creating it.
        // Never redirect or collect Discord output: it can contain account data.
        if (!FreeConsole()) throw new Win32Exception(Marshal.GetLastWin32Error());
        using (var child = Process.Start(Options(executable))) {
            if (child == null) throw new Exception("Не удалось запустить Discord. Откройте его обычным ярлыком.");
        }
        // Do not wait for Discord's lifetime: installation has already finished.
    }
}
