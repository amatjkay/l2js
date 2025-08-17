using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

class WindowFinder
{
    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")] static extern int GetClassNameW(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool QueryFullProcessImageNameW(IntPtr hProcess, uint flags, StringBuilder exeName, ref uint size);

    const uint PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

    static string ReadTitle(IntPtr h)
    {
        var sb = new StringBuilder(512);
        GetWindowTextW(h, sb, sb.Capacity);
        return sb.ToString();
    }
    static string ReadClass(IntPtr h)
    {
        var sb = new StringBuilder(256);
        GetClassNameW(h, sb, sb.Capacity);
        return sb.ToString();
    }
    static (string path, string file) ReadProc(uint pid)
    {
        try
        {
            IntPtr ph = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (ph == IntPtr.Zero) return ("", "");
            try
            {
                uint cap = 1024;
                var sb = new StringBuilder((int)cap);
                if (QueryFullProcessImageNameW(ph, 0, sb, ref cap))
                {
                    string p = sb.ToString();
                    string f = System.IO.Path.GetFileName(p);
                    return (p, f);
                }
            }
            finally { CloseHandle(ph); }
        }
        catch { }
        return ("", "");
    }

    public class WinInfo
    {
        public string hwndHex { get; set; } = "";
        public ulong hwnd { get; set; }
        public string title { get; set; } = "";
        public string className { get; set; } = "";
        public uint pid { get; set; }
        public string processPath { get; set; } = "";
        public string processFile { get; set; } = "";
    }

    static IEnumerable<WinInfo> EnumVisible()
    {
        var list = new List<WinInfo>();
        EnumWindows((h, l) =>
        {
            if (!IsWindowVisible(h)) return true;
            uint pid; GetWindowThreadProcessId(h, out pid);
            var (path, file) = ReadProc(pid);
            var info = new WinInfo
            {
                hwnd = (ulong)h.ToInt64(),
                hwndHex = "0x" + ((ulong)h.ToInt64()).ToString("x8"),
                title = ReadTitle(h),
                className = ReadClass(h),
                pid = pid,
                processPath = path,
                processFile = file,
            };
            list.Add(info);
            return true;
        }, IntPtr.Zero);
        return list;
    }

    static bool Matches(WinInfo w)
    {
        // OR-criteria based on user's exact data
        if (!string.IsNullOrEmpty(w.title) && w.title.Contains("LU4")) return true;
        if (w.className == "UnrealWindow") return true;
        if (!string.IsNullOrEmpty(w.processFile) && w.processFile.ToLower().Contains("lu4")) return true;
        if (w.hwnd == 0x00040686UL) return true;
        return false;
    }

    static void Main(string[] args)
    {
        var list = EnumVisible();
        WinInfo found = null;
        foreach (var w in list)
        {
            if (found == null && Matches(w)) found = w;
        }
        if (found != null)
        {
            Console.WriteLine($"{{\"found\":true,\"hwnd\":\"{found.hwndHex}\",\"title\":\"{Escape(found.title)}\",\"className\":\"{Escape(found.className)}\",\"processName\":\"{Escape(found.processFile)}\"}}");
        }
        else
        {
            Console.WriteLine("{\"found\":false}");
        }
    }

    static string Escape(string s) => (s ?? string.Empty).Replace("\\", "\\\\").Replace("\"", "\\\"");
}
