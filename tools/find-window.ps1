param(
  [string]$Mode = 'find',
  [string]$TitleContains = 'LU4',
  [string]$ClassEquals = 'UnrealWindow',
  [string]$ProcessNameContains = 'lu4',
  [string]$HwndHex = '0x00040686'
)

Add-Type -Language CSharp -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class WinDet
{
    public class WinInfo
    {
        public string hwndHex;
        public ulong hwnd;
        public string title;
        public string className;
        public uint pid;
        public string processPath;
        public string processFile;
    }

    delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassNameW(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)] static extern bool QueryFullProcessImageNameW(IntPtr hProcess, uint flags, StringBuilder exeName, ref uint size);

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
    static void ReadProc(uint pid, out string path, out string file)
    {
        path = ""; file = "";
        try
        {
            IntPtr ph = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (ph == IntPtr.Zero) return;
            try
            {
                uint cap = 1024;
                var sb = new StringBuilder((int)cap);
                if (QueryFullProcessImageNameW(ph, 0, sb, ref cap))
                {
                    path = sb.ToString();
                    file = System.IO.Path.GetFileName(path);
                }
            }
            finally { CloseHandle(ph); }
        }
        catch { }
    }

    public static List<WinInfo> EnumVisible()
    {
        var list = new List<WinInfo>();
        EnumWindows((h, l) =>
        {
            if (!IsWindowVisible(h)) return true;
            uint pid; GetWindowThreadProcessId(h, out pid);
            string path, file; ReadProc(pid, out path, out file);
            var info = new WinInfo
            {
                hwnd = unchecked((ulong)(long)h),
                hwndHex = "0x" + unchecked((ulong)(long)h).ToString("x8"),
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

    public static WinInfo Active()
    {
        var h = GetForegroundWindow();
        if (h == IntPtr.Zero) return null;
        uint pid; GetWindowThreadProcessId(h, out pid);
        string path, file; ReadProc(pid, out path, out file);
        return new WinInfo
        {
            hwnd = unchecked((ulong)(long)h),
            hwndHex = "0x" + unchecked((ulong)(long)h).ToString("x8"),
            title = ReadTitle(h),
            className = ReadClass(h),
            pid = pid,
            processPath = path,
            processFile = file,
        };
    }

    public static bool Activate(ulong hwnd)
    {
        return SetForegroundWindow((IntPtr)(long)hwnd);
    }
}
"@

function ToJsonEsc([string]$s) { if ($null -eq $s) { return '' } ($s -replace '\\','\\\\') -replace '"','\"' }

$mode = $Mode.ToLowerInvariant()
if ($mode -eq 'enum') {
  $list = [WinDet]::EnumVisible()
  $first = $true
  Write-Output '['
  foreach ($w in $list) {
    if (-not $first) { Write-Output ',' }
    $first = $false
    Write-Output ("{`"hwnd`":`"$($w.hwndHex)`",`"title`":`"$(ToJsonEsc($w.title))`",`"className`":`"$(ToJsonEsc($w.className))`",`"processName`":`"$(ToJsonEsc($w.processFile))`"}")
  }
  Write-Output ']'
  exit 0
}
elseif ($mode -eq 'active') {
  $w = [WinDet]::Active()
  if ($null -ne $w) {
    Write-Output ("{`"found`":true,`"hwnd`":`"$($w.hwndHex)`",`"title`":`"$(ToJsonEsc($w.title))`",`"className`":`"$(ToJsonEsc($w.className))`",`"processName`":`"$(ToJsonEsc($w.processFile))`"}")
  } else {
    Write-Output '{"found":false}'
  }
  exit 0
}
elseif ($mode -eq 'activate') {
  # Activate by hwnd
  $wantHwnd = 0
  if ($HwndHex -match '^0x') { $wantHwnd = [int]::Parse($HwndHex.Substring(2), [System.Globalization.NumberStyles]::HexNumber) }
  if ($wantHwnd -eq 0) { Write-Output '{`"ok`":false,`"reason`":`"bad_hwnd`"}'; exit 1 }
  $list = [WinDet]::EnumVisible()
  foreach ($w in $list) {
    if (([int]$w.hwnd) -eq $wantHwnd) {
      $ok = [WinDet]::Activate([uint64]([long]$wantHwnd))
      if ($ok) { Write-Output '{`"ok`":true}'; exit 0 } else { Write-Output '{`"ok`":false}'; exit 1 }
    }
  }
  Write-Output '{`"ok`":false,`"reason`":`"not_found`"}'; exit 1
}
else {
  # find by OR-criteria
  $wantHwnd = 0
  if ($HwndHex -match '^0x') { $wantHwnd = [int]::Parse($HwndHex.Substring(2), [System.Globalization.NumberStyles]::HexNumber) }
  $list = [WinDet]::EnumVisible()
  foreach ($w in $list) {
    $byTitle = -not [string]::IsNullOrEmpty($TitleContains) -and ($w.title -like "*${TitleContains}*")
    $byClass = -not [string]::IsNullOrEmpty($ClassEquals) -and ($w.className -eq $ClassEquals)
    $procFile = if ($null -ne $w.processFile) { $w.processFile } else { '' }
    $byProc = -not [string]::IsNullOrEmpty($ProcessNameContains) -and (($procFile.ToLower()).Contains($ProcessNameContains.ToLower()))
    $byHwnd = $wantHwnd -gt 0 -and (([int]$w.hwnd) -eq $wantHwnd)
    if ($byTitle -or $byClass -or $byProc -or $byHwnd) {
      Write-Output ("{`"found`":true,`"hwnd`":`"$($w.hwndHex)`",`"title`":`"$(ToJsonEsc($w.title))`",`"className`":`"$(ToJsonEsc($w.className))`",`"processName`":`"$(ToJsonEsc($w.processFile))`"}")
      exit 0
    }
  }
  Write-Output '{"found":false}'
  exit 0
}
