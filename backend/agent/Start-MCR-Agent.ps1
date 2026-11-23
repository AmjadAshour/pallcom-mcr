Add-Type -AssemblyName Microsoft.VisualBasic
Add-Type -AssemblyName System.Windows.Forms
$ErrorActionPreference = 'Stop'
$title = 'PALLCOM MCR Agent'
$launcherLock = New-Object System.Threading.Mutex($false, 'Local\PallcomMcrAgentLauncher')
$ownsLock = $false

try {
    try {
        $ownsLock = $launcherLock.WaitOne(0)
    } catch [System.Threading.AbandonedMutexException] {
        $ownsLock = $true
    }
    if (-not $ownsLock) { return }

    $node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Source
    $entry = Join-Path $PSScriptRoot 'src\index.js'
    $configDir = $env:MCR_AGENT_CONFIG_DIR
    if (-not $configDir) { $configDir = Join-Path $env:USERPROFILE '.mcr-agent' }
    New-Item -Path $configDir -ItemType Directory -Force | Out-Null
    $credentials = Join-Path $configDir 'credentials.json'
    $agentCommand = '"' + $entry + '" start'
    $sessionId = (Get-Process -Id $PID).SessionId
    $running = Get-CimInstance Win32_Process -Filter "Name = 'node.exe' AND SessionId = $sessionId" |
        Where-Object { $_.CommandLine -and $_.CommandLine.TrimEnd().EndsWith($agentCommand, [StringComparison]::OrdinalIgnoreCase) }
    $pair = -not (Test-Path -LiteralPath $credentials)

    if (-not $pair) {
        $choice = [Windows.Forms.MessageBox]::Show(
            "Yes: start the saved station.$([Environment]::NewLine)No: pair this computer again.",
            $title, 'YesNoCancel', 'Question')
        if ($choice -eq 'Cancel') { return }
        $pair = $choice -eq 'No'
    }

    if ($pair) {
        $server = [Microsoft.VisualBasic.Interaction]::InputBox('Enter the MCR dashboard HTTPS address.', $title).Trim()
        if (-not $server) { return }
        $origin = $null
        if ($server -notmatch '^https://[A-Za-z0-9.-]+(?::[0-9]{1,5})?/?$' -or
            -not [Uri]::TryCreate($server, [UriKind]::Absolute, [ref]$origin) -or
            $origin.HostNameType -eq [UriHostNameType]::Unknown) {
            throw 'Enter an HTTPS dashboard address such as https://mcr.example.com.'
        }
        $code = [Microsoft.VisualBasic.Interaction]::InputBox('Enter the pairing code from the dashboard.', $title).Trim().ToUpperInvariant()
        if (-not $code) { return }
        if ($code -cnotmatch '^MCR-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$') {
            throw 'Enter a pairing code in the format MCR-XXXX.'
        }
        $pairError = Join-Path $configDir 'pairing-error.log'
        $pairProcess = Start-Process -FilePath $node -ArgumentList @(
            ('"' + $entry + '"'), 'pair', '--code', $code, '--server', $origin.GetLeftPart([UriPartial]::Authority)
        ) -WindowStyle Hidden -RedirectStandardError $pairError -PassThru -Wait
        if ($pairProcess.ExitCode -ne 0) {
            $detail = Get-Content -LiteralPath $pairError -Tail 3
            throw "Pairing failed. Check the address, code, and network connection. $detail"
        }
        if ($running) { $running | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue } }
        $running = $null
    }

    if (-not $running) {
        $workerOptions = @{
            FilePath = $node
            ArgumentList = $agentCommand
            WindowStyle = 'Hidden'
            RedirectStandardOutput = Join-Path $configDir 'agent.log'
            RedirectStandardError = Join-Path $configDir 'agent-error.log'
            PassThru = $true
        }
        $worker = Start-Process @workerOptions
        if ($worker.WaitForExit(1200)) {
            throw "The agent stopped. See the logs in $configDir."
        }
    }
    [void][Windows.Forms.MessageBox]::Show('The agent is running in the background. Check the station status in the dashboard.', $title)
} catch {
    [void][Windows.Forms.MessageBox]::Show($_.Exception.Message, $title, 'OK', 'Error')
} finally {
    if ($ownsLock) { $launcherLock.ReleaseMutex() }
    $launcherLock.Dispose()
}
