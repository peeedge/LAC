# LiteCAD — stop leftover processes that still have this folder open.
#
# A smoke test, Vite, or Vitest that never exited keeps the folder as its
# working directory, and Windows then refuses to rename or delete it. This
# stops those processes and the browsers they spawned. The shell that launched
# this script is left running.
#
#   .\stop-lingering.ps1
#   .\stop-lingering.ps1 -DryRun
#   stop-lingering.bat
#   npm run stop

[CmdletBinding()]
param(
  # List the processes that would be stopped, without stopping them.
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path -LiteralPath $PSScriptRoot).Path

if (-not ('LiteCad.ProcCwd' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;

namespace LiteCad {
  public static class ProcCwd {
    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_BASIC_INFORMATION {
      public IntPtr Reserved1;
      public IntPtr PebBaseAddress;
      public IntPtr Reserved2_0;
      public IntPtr Reserved2_1;
      public IntPtr UniqueProcessId;
      public IntPtr Reserved3;
    }

    [DllImport("ntdll.dll")]
    static extern int NtQueryInformationProcess(IntPtr h, int cls, ref PROCESS_BASIC_INFORMATION pbi, int len, out int ret);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr h);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, int size, out int read);

    public static string Get(int pid) {
      IntPtr handle = OpenProcess(0x0410, false, pid);
      if (handle == IntPtr.Zero) handle = OpenProcess(0x1010, false, pid);
      if (handle == IntPtr.Zero) return null;
      try {
        var info = new PROCESS_BASIC_INFORMATION();
        int returned;
        if (NtQueryInformationProcess(handle, 0, ref info, Marshal.SizeOf(typeof(PROCESS_BASIC_INFORMATION)), out returned) != 0) return null;
        byte[] pointer = new byte[8];
        int read;
        if (!ReadProcessMemory(handle, info.PebBaseAddress + 0x20, pointer, 8, out read)) return null;
        long parameters = BitConverter.ToInt64(pointer, 0);
        byte[] currentDirectory = new byte[16];
        if (!ReadProcessMemory(handle, (IntPtr)(parameters + 0x38), currentDirectory, 16, out read)) return null;
        ushort length = BitConverter.ToUInt16(currentDirectory, 0);
        long buffer = BitConverter.ToInt64(currentDirectory, 8);
        if (length == 0 || buffer == 0) return "";
        byte[] chars = new byte[length];
        if (!ReadProcessMemory(handle, (IntPtr)buffer, chars, length, out read)) return null;
        return Encoding.Unicode.GetString(chars);
      } finally {
        CloseHandle(handle);
      }
    }
  }
}
'@
}

function Test-InProject([string]$Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
  $full = [System.IO.Path]::GetFullPath($Path.TrimEnd('\', '/'))
  $rootFull = [System.IO.Path]::GetFullPath($Root)
  if ($full.Equals($rootFull, [StringComparison]::OrdinalIgnoreCase)) { return $true }
  return $full.StartsWith($rootFull + '\', [StringComparison]::OrdinalIgnoreCase)
}

function Test-EditorHelper([string]$CommandLine) {
  if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
  return $CommandLine -match '\\Cursor\\|\\cursor\\resources\\|\\Microsoft VS Code\\|\\Code\\resources\\|extensionHost|gitWorker'
}

function Test-AutomatedBrowser([string]$CommandLine) {
  if ([string]::IsNullOrWhiteSpace($CommandLine)) { return $false }
  return $CommandLine -match 'headless|remote-debugging|playwright|disable-dev-shm-usage'
}

function Test-Seed($Process) {
  $name = $Process.Name.ToLowerInvariant()
  $inProject = Test-InProject $Process.Cwd
  $mentionsProject = -not [string]::IsNullOrWhiteSpace($Process.CommandLine) -and
    ($Process.CommandLine.IndexOf($Root, [StringComparison]::OrdinalIgnoreCase) -ge 0)

  if ($name -eq 'node.exe') {
    if (Test-EditorHelper $Process.CommandLine) { return $false }
    return $inProject -or $mentionsProject
  }
  if ($name -eq 'chrome-headless-shell.exe') {
    return $inProject -or $mentionsProject
  }
  if ($name -in @('chrome.exe', 'msedge.exe', 'chromium.exe')) {
    return ($inProject -or $mentionsProject) -and (Test-AutomatedBrowser $Process.CommandLine)
  }
  return $false
}

function Format-Command([string]$CommandLine) {
  if ([string]::IsNullOrWhiteSpace($CommandLine)) { return '' }
  $text = ($CommandLine -replace '\s+', ' ').Trim()
  if ($text.Length -le 120) { return $text }
  return $text.Substring(0, 117) + '...'
}

$byId = @{}
Get-CimInstance Win32_Process | ForEach-Object {
  $byId[[int]$_.ProcessId] = [pscustomobject]@{
    ProcessId = [int]$_.ProcessId
    ParentProcessId = [int]$_.ParentProcessId
    Name = [string]$_.Name
    CommandLine = [string]$_.CommandLine
    Cwd = $null
  }
}

$cwdNames = @('node.exe', 'chrome-headless-shell.exe', 'chrome.exe', 'msedge.exe', 'chromium.exe')
foreach ($proc in $byId.Values) {
  if ($cwdNames -notcontains $proc.Name.ToLowerInvariant()) { continue }
  $proc.Cwd = [LiteCad.ProcCwd]::Get($proc.ProcessId)
}

$children = @{}
foreach ($proc in $byId.Values) {
  $parentId = $proc.ParentProcessId
  if (-not $children.ContainsKey($parentId)) {
    $children[$parentId] = New-Object System.Collections.Generic.List[int]
  }
  $children[$parentId].Add($proc.ProcessId)
}

# The shell running this script, and whatever launched it (npm, a terminal),
# also have this folder as their working directory. They are not leftovers.
$protected = @{}
$cursor = $PID
while ($cursor -and -not $protected.ContainsKey($cursor)) {
  $protected[$cursor] = $true
  if (-not $byId.ContainsKey($cursor)) { break }
  $cursor = $byId[$cursor].ParentProcessId
}

$targets = New-Object 'System.Collections.Generic.HashSet[int]'
$queue = New-Object 'System.Collections.Generic.Queue[int]'
foreach ($proc in $byId.Values) {
  if ($protected.ContainsKey($proc.ProcessId)) { continue }
  if (-not (Test-Seed $proc)) { continue }
  if ($targets.Add($proc.ProcessId)) { $queue.Enqueue($proc.ProcessId) }
}

while ($queue.Count -gt 0) {
  $id = $queue.Dequeue()
  if (-not $children.ContainsKey($id)) { continue }
  foreach ($childId in $children[$id]) {
    if ($protected.ContainsKey($childId)) { continue }
    if ($targets.Add($childId)) { $queue.Enqueue($childId) }
  }
}

if ($targets.Count -eq 0) {
  Write-Host "No leftover LiteCAD processes."
  exit 0
}

Write-Host "Leftover LiteCAD processes:"
foreach ($id in ($targets | Sort-Object)) {
  $proc = $byId[$id]
  Write-Host ("  {0,6}  {1,-28}  {2}" -f $proc.ProcessId, $proc.Name, (Format-Command $proc.CommandLine))
}

$roots = foreach ($id in $targets) {
  $proc = $byId[$id]
  if (-not $targets.Contains($proc.ParentProcessId)) { $proc }
}

if ($DryRun) {
  Write-Host "Dry run: nothing was stopped."
  exit 0
}

$failed = $false
foreach ($proc in $roots) {
  & taskkill.exe /PID $proc.ProcessId /T /F | Out-Host
  if ($LASTEXITCODE -ne 0) { $failed = $true }
}

if ($failed) { exit 1 }
Write-Host "Stopped leftover LiteCAD processes."
exit 0
