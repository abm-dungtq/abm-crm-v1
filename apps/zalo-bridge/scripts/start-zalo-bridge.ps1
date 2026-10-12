<#
.SYNOPSIS
  Starts the Zalo bridge sidecar unless it is already running.

.DESCRIPTION
  - Exits 0 without starting anything when a node process already runs apps/zalo-bridge/src/main.ts.
  - Loads apps/zalo-bridge/.env (KEY=VALUE lines) into this process only; values are never printed.
    Empty values are skipped so the sidecar's defaults apply.
  - Runs `pnpm -F @abm/zalo-bridge start` from the repository root and appends its output to
    apps/zalo-bridge/logs/bridge.log (rotated to bridge.log.1 above 10 MB).
  - Stays in the foreground and exits with the sidecar's exit code, so a scheduled task can restart it.
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$appDir = Split-Path -Parent $PSScriptRoot
$repoRoot = (Resolve-Path (Join-Path $appDir '..\..')).Path

# tsx runs the entry as `node ...\apps\zalo-bridge\node_modules\.bin\..\tsx\dist\cli.mjs src/main.ts`.
$running = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -match 'zalo-bridge[\\/].*src[\\/]main\.ts' })
if ($running.Count -gt 0) {
  Write-Output ("zalo-bridge is already running (PID {0}); not starting another." -f (($running | ForEach-Object { $_.ProcessId }) -join ', '))
  exit 0
}

$envFile = Join-Path $appDir '.env'
if (Test-Path -LiteralPath $envFile) {
  foreach ($line in Get-Content -LiteralPath $envFile -Encoding UTF8) {
    if ($line -match '^\s*#' -or $line -notmatch '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$') { continue }
    $name = $Matches[1]
    $value = $Matches[2].Trim()
    if ($value.Length -ge 2 -and (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'")))) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    if ($value -ne '') { [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
  }
}

$logDir = Join-Path $appDir 'logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir 'bridge.log'
if ((Test-Path -LiteralPath $logFile) -and (Get-Item -LiteralPath $logFile).Length -gt 10MB) {
  Move-Item -LiteralPath $logFile -Destination "$logFile.1" -Force
}

# Only a .cmd or .exe can be run by cmd.exe; `Get-Command pnpm` may resolve to pnpm.ps1.
$pnpm = Get-Command -Name 'pnpm.cmd', 'pnpm.exe' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$pnpmPath = if ($pnpm) { $pnpm.Source } else { Join-Path $env:APPDATA 'npm\pnpm.cmd' }
if (-not (Test-Path -LiteralPath $pnpmPath)) {
  Write-Error 'pnpm not found on PATH or in %APPDATA%\npm.'
  exit 1
}

Add-Content -LiteralPath $logFile -Value ("{0} start-zalo-bridge: starting" -f (Get-Date).ToString('o'))
Set-Location -LiteralPath $repoRoot
# cmd.exe does the redirection so stderr lines are written as plain text, not turned into PowerShell errors.
# /s strips only the outer pair of quotes around the command.
$cmdLine = '/d /s /c ""{0}" -F @abm/zalo-bridge start >> "{1}" 2>&1"' -f $pnpmPath, $logFile

# The node process is a grandchild of this wrapper. cmd.exe is created suspended, assigned to a job
# with KILL_ON_JOB_CLOSE, then resumed, so the whole tree dies when this PowerShell exits.
if (-not ('ChildProcessJob' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public class ChildProcessJob {
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);
    [DllImport("kernel32.dll")]
    static extern bool SetInformationJobObject(IntPtr hJob, int JobObjectInfoClass, IntPtr lpJobObjectInfo, uint cbJobObjectInfoLength);
    [DllImport("kernel32.dll")]
    static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CreateProcess(string lpApplicationName, StringBuilder lpCommandLine, IntPtr lpProcessAttributes, IntPtr lpThreadAttributes, bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment, string lpCurrentDirectory, ref STARTUPINFO lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);
    [DllImport("kernel32.dll")]
    static extern uint ResumeThread(IntPtr hThread);
    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr hObject);
    [DllImport("kernel32.dll")]
    static extern bool TerminateProcess(IntPtr hProcess, uint uExitCode);
    [DllImport("kernel32.dll")]
    static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);
    [DllImport("kernel32.dll")]
    static extern bool GetExitCodeProcess(IntPtr hProcess, out uint lpExitCode);
    const int JobObjectExtendedLimitInformation = 9;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;
    const uint CREATE_SUSPENDED = 0x00000004;
    const uint CREATE_NO_WINDOW = 0x08000000;
    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX;
        public int dwY;
        public int dwXSize;
        public int dwYSize;
        public int dwXCountChars;
        public int dwYCountChars;
        public int dwFillAttribute;
        public int dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION {
        public IntPtr hProcess;
        public IntPtr hThread;
        public int dwProcessId;
        public int dwThreadId;
    }
    IntPtr handle;
    IntPtr childProcess;
    int processId;
    public int Id { get { return processId; } }
    public ChildProcessJob() {
        handle = CreateJobObject(IntPtr.Zero, null);
        if (handle == IntPtr.Zero) throw new InvalidOperationException("CreateJobObject failed");
        var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        int length = Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
        IntPtr ptr = Marshal.AllocHGlobal(length);
        try {
            Marshal.StructureToPtr(info, ptr, false);
            if (!SetInformationJobObject(handle, JobObjectExtendedLimitInformation, ptr, (uint)length))
                throw new InvalidOperationException("SetInformationJobObject failed");
        } finally {
            Marshal.FreeHGlobal(ptr);
        }
    }
    public void AddProcess(IntPtr processHandle) {
        if (!AssignProcessToJobObject(handle, processHandle))
            throw new InvalidOperationException("AssignProcessToJobObject failed");
    }
    public void StartAssigned(string applicationName, string arguments, string currentDirectory) {
        var si = new STARTUPINFO();
        si.cb = Marshal.SizeOf(typeof(STARTUPINFO));
        var commandLine = new StringBuilder(32768);
        commandLine.Append('"').Append(applicationName).Append('"').Append(' ').Append(arguments);
        PROCESS_INFORMATION pi;
        if (!CreateProcess(applicationName, commandLine, IntPtr.Zero, IntPtr.Zero, false, CREATE_SUSPENDED | CREATE_NO_WINDOW, IntPtr.Zero, currentDirectory, ref si, out pi))
            throw new InvalidOperationException("CreateProcess failed: " + Marshal.GetLastWin32Error());
        bool resumed = false;
        try {
            AddProcess(pi.hProcess);
            if (ResumeThread(pi.hThread) == 0xFFFFFFFF)
                throw new InvalidOperationException("ResumeThread failed: " + Marshal.GetLastWin32Error());
            resumed = true;
            childProcess = pi.hProcess;
            processId = pi.dwProcessId;
        } catch {
            TerminateProcess(pi.hProcess, 1);
            throw;
        } finally {
            CloseHandle(pi.hThread);
            if (!resumed) CloseHandle(pi.hProcess);
        }
    }
    public bool HasExited {
        get { return childProcess == IntPtr.Zero || WaitForSingleObject(childProcess, 0) == 0; }
    }
    public void Wait() {
        if (WaitForSingleObject(childProcess, 0xFFFFFFFF) != 0)
            throw new InvalidOperationException("WaitForSingleObject failed: " + Marshal.GetLastWin32Error());
    }
    public int ExitCode {
        get {
            uint code;
            if (!GetExitCodeProcess(childProcess, out code))
                throw new InvalidOperationException("GetExitCodeProcess failed: " + Marshal.GetLastWin32Error());
            return unchecked((int)code);
        }
    }
}
'@
}
$script:bridgeJob = New-Object ChildProcessJob
$script:bridgeJob.StartAssigned((Join-Path $env:SystemRoot 'System32\cmd.exe'), $cmdLine, $repoRoot)

try {
  $script:bridgeJob.Wait()
} finally {
  if (-not $script:bridgeJob.HasExited) {
    & taskkill.exe /PID $script:bridgeJob.Id /T /F 2>&1 | Out-Null
  }
}
$exitCode = $script:bridgeJob.ExitCode
Add-Content -LiteralPath $logFile -Value ("{0} start-zalo-bridge: exited with code {1}" -f (Get-Date).ToString('o'), $exitCode)
exit $exitCode
