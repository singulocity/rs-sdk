[CmdletBinding()]
param(
    [ValidateSet('start', 'stop', 'restart', 'status', 'logs')]
    [string]$Action = 'status',
    [string]$BotName,
    [string]$ViewerPath,
    [ValidateSet('engine', 'gateway', 'viewer', 'bot', 'routine', 'logout')]
    [string]$Service = 'routine'
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$stateDir = Join-Path $repoRoot 'bots/local-watch'
$logDir = Join-Path $stateDir 'logs'
$configFile = Join-Path $stateDir 'control-config.json'
$config = if (Test-Path -LiteralPath $configFile) { Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json } else { $null }
if (!$BotName) {
    if ($config) { $BotName = $config.botName }
    else {
        $bots = @(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'bots') -Directory |
            Where-Object { $_.Name -ne '_template' -and (Test-Path -LiteralPath (Join-Path $_.FullName 'bot.env')) })
        if ($bots.Count -eq 1) { $BotName = $bots[0].Name }
    }
}
if (!$ViewerPath) {
    $ViewerPath = if ($config) { $config.viewerPath } else { Join-Path (Split-Path $repoRoot -Parent) 'rs-world' }
}
$ViewerPath = [IO.Path]::GetFullPath($ViewerPath)
if (!$BotName -or $BotName -notmatch '^[a-zA-Z0-9]{1,12}$') {
    throw 'Choose a bot: local.cmd start -BotName YourBotName'
}
$botDir = Join-Path $repoRoot ('bots/' + $BotName)
$routineFile = Join-Path $botDir 'watch.ts'
if (!(Test-Path -LiteralPath $routineFile)) { $routineFile = Join-Path $botDir 'script.ts' }
$specs = @{
    engine = @{ cwd = Join-Path $repoRoot 'server/engine'; entry = 'src/app.ts'; pattern = 'src[\\/]app\.ts'; port = 8888 }
    gateway = @{ cwd = Join-Path $repoRoot 'server/gateway'; entry = 'gateway.ts'; pattern = 'gateway\.ts'; port = 7780 }
    viewer = @{ cwd = $ViewerPath; entry = 'node_modules/@craco/craco/dist/bin/craco.js'; pattern = '[\\/]craco[\\/].*\bstart\b'; port = 3000 }
    bot = @{ cwd = Join-Path $repoRoot 'server/webclient'; entry = 'src/lite/runner.ts'; pattern = 'src[\\/]lite[\\/]runner\.ts'; port = 0 }
    routine = @{ cwd = $repoRoot; entry = $routineFile; pattern = [regex]::Escape([IO.Path]::GetFileName($routineFile)); port = 0 }
}
$serviceNames = @('engine', 'gateway', 'viewer', 'bot', 'routine')

function Get-ManagedProcess([string]$Name) {
    $file = Join-Path $stateDir ($Name + '-process.json')
    if (!(Test-Path -LiteralPath $file)) { return $null }
    $record = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    $managedId = [int]$record.processId
    if ($managedId -le 0) { return $null }
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $managedId"
    if (!$process) { return $null }
    $expectedTime = if ($record.startedAt) { ([datetime]$record.startedAt).ToUniversalTime() }
        else { (Get-Item -LiteralPath $file).LastWriteTimeUtc }
    if ($process.CommandLine -notmatch $specs[$Name].pattern -or
        [math]::Abs(($process.CreationDate.ToUniversalTime() - $expectedTime).TotalSeconds) -gt 10) {
        Write-Warning "$Name has an outdated process record; PID $managedId will be left alone."
        return $null
    }
    return $process
}

function Get-BunPath {
    $command = Get-Command bun.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    $node = Get-Command node.exe -ErrorAction Stop
    $candidates = @(
        (Join-Path (Split-Path $node.Source -Parent) 'node_modules/bun/bin/bun.exe'),
        (Join-Path $env:USERPROFILE '.bun/bin/bun.exe')
    )
    foreach ($candidate in $candidates) { if (Test-Path -LiteralPath $candidate) { return $candidate } }
    throw 'Bun executable not found. Install Bun or add bun.exe to PATH.'
}

function Test-LocalPort([int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try {
        $task = $client.ConnectAsync('127.0.0.1', $Port)
        return ($task.Wait(500) -and $client.Connected)
    } catch { return $false }
    finally { $client.Dispose() }
}

function Wait-Http([string]$Name, [string]$Url, [int]$Seconds = 90) {
    $deadline = [datetime]::UtcNow.AddSeconds($Seconds)
    do {
        if (!(Get-ManagedProcess $Name)) { throw "$Name exited. See local.cmd logs -Service $Name" }
        try { $null = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2; return } catch {}
        Start-Sleep -Milliseconds 500
    } while ([datetime]::UtcNow -lt $deadline)
    throw "$Name is not ready yet. See local.cmd logs -Service $Name"
}

function Start-LocalService([string]$Name) {
    $existing = Get-ManagedProcess $Name
    if ($existing) { Write-Host "$Name already running (PID $($existing.ProcessId))."; return }
    $spec = $specs[$Name]
    if ($spec.port -and (Test-LocalPort $spec.port)) {
        throw "Port $($spec.port) is already in use by an unmanaged process; no duplicate $Name was started."
    }
    $entry = if ([IO.Path]::IsPathRooted($spec.entry)) { $spec.entry } else { Join-Path $spec.cwd $spec.entry }
    if (!(Test-Path -LiteralPath $entry)) { throw "Missing $entry" }
    $exe = if ($Name -eq 'viewer') { (Get-Command node.exe -ErrorAction Stop).Source } else { Get-BunPath }
    $arguments = @($entry)
    if ($Name -eq 'viewer') { $arguments += 'start' }
    if ($Name -eq 'bot' -or $Name -eq 'routine') { $arguments += $BotName }
    $quoted = @($arguments | ForEach-Object { '"' + $_ + '"' })
    $process = Start-Process -FilePath $exe -ArgumentList $quoted -WorkingDirectory $spec.cwd -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir ($Name + '.out.log')) -RedirectStandardError (Join-Path $logDir ($Name + '.err.log'))
    $started = Get-CimInstance Win32_Process -Filter "ProcessId = $($process.Id)"
    @{ name = $Name; processId = $process.Id; startedAt = $started.CreationDate.ToUniversalTime().ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateDir ($Name + '-process.json'))
    Write-Host "Started $Name (PID $($process.Id))."
}

function Stop-LocalService([string]$Name) {
    $process = Get-ManagedProcess $Name
    if (!$process) { return }
    # CRACO starts child Node processes; include its own children, never other Node/Bun jobs.
    $snapshot = @(Get-CimInstance Win32_Process)
    function Stop-Branch($Parent) {
        foreach ($child in $snapshot | Where-Object { $_.ParentProcessId -eq $Parent.ProcessId }) {
            if ($child.CreationDate -ge $Parent.CreationDate) { Stop-Branch $child }
        }
        $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($Parent.ProcessId)"
        if ($current -and $current.CreationDate -eq $Parent.CreationDate) {
            Stop-Process -Id $Parent.ProcessId -ErrorAction SilentlyContinue
        }
    }
    Stop-Branch $process
    Write-Host "Stopped $Name."
}

function Show-Status {
    $rows = foreach ($name in $serviceNames) {
        $process = Get-ManagedProcess $name
        [pscustomobject]@{ Service = $name; State = $(if ($process) { 'Running' } else { 'Stopped' });
            PID = $(if ($process) { $process.ProcessId } else { '-' }); Port = $(if ($specs[$name].port) { $specs[$name].port } else { '-' }) }
    }
    $rows | Format-Table -AutoSize | Out-Host
    Write-Host "Bot: $BotName"
    Write-Host 'Viewer: http://localhost:3000'
    Write-Host "Logs: $logDir"
}

function Stop-Stack {
    Stop-LocalService 'routine'
    if (Get-ManagedProcess 'engine') {
        if (Get-ManagedProcess 'bot') {
            Write-Host 'Logging the bot out and waiting for its character save...'
            $logout = Join-Path $repoRoot 'scripts/local-logout.ts'
            $arguments = @($logout, $BotName) | ForEach-Object { '"' + $_ + '"' }
            $job = Start-Process -FilePath (Get-BunPath) -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir 'logout.out.log') -RedirectStandardError (Join-Path $logDir 'logout.err.log')
            if (!$job.WaitForExit(25000)) {
                $job.Kill()
                throw 'Logout timed out. Server was left running. Check local.cmd logs -Service logout'
            }
        }
        $deadline = [datetime]::UtcNow.AddSeconds(25)
        $empty = $false
        do {
            try {
                $count = Invoke-RestMethod 'http://127.0.0.1:8888/playercount' -TimeoutSec 2
                if ($count.count -eq 0) { $empty = $true; break }
            } catch {}
            Start-Sleep -Milliseconds 500
        } while ([datetime]::UtcNow -lt $deadline)
        if (!$empty) { throw 'Players are still connected or the server is not responding. Server was left running; check logout logs and log out other clients before stopping.' }
    }
    foreach ($name in @('bot', 'viewer', 'engine', 'gateway')) { Stop-LocalService $name }
    Write-Host 'Local setup stopped. Saved characters and databases are preserved.'
}

try {
    if ($Action -eq 'status') { Show-Status; exit 0 }
    if ($Action -eq 'logs') {
        $paths = @((Join-Path $logDir ($Service + '.out.log')), (Join-Path $logDir ($Service + '.err.log')))
        foreach ($path in $paths) {
            Write-Host $path
            if (Test-Path -LiteralPath $path) { Get-Content -LiteralPath $path -Tail 25 }
        }
        exit 0
    }
    if ($Action -eq 'stop' -or $Action -eq 'restart') { Stop-Stack }
    if ($Action -eq 'start' -or $Action -eq 'restart') {
        if (!(Test-Path -LiteralPath (Join-Path $botDir 'bot.env'))) { throw "Missing bot credentials in $botDir" }
        if (!(Test-Path -LiteralPath $routineFile)) { throw 'Create watch.ts or script.ts in the bot folder first.' }
        $null = New-Item -ItemType Directory -Path $logDir -Force
        @{ botName = $BotName; viewerPath = $ViewerPath } | ConvertTo-Json | Set-Content -LiteralPath $configFile
        $env:WORLD_FEED = 'true'
        $env:EASY_STARTUP = 'true'
        $env:BUILD_VERIFY = 'false'
        $env:GATEWAY_HOSTNAME = '127.0.0.1'
        $env:BROWSER = 'none'
        $env:HOST = '127.0.0.1'
        $env:PORT = '3000'
        Start-LocalService 'engine'
        Wait-Http 'engine' 'http://127.0.0.1:8888/playercount'
        Start-LocalService 'gateway'
        Wait-Http 'gateway' 'http://127.0.0.1:7780/' 30
        Start-LocalService 'viewer'
        Wait-Http 'viewer' 'http://127.0.0.1:3000'
        Start-LocalService 'bot'
        $ready = $false
        $deadline = [datetime]::UtcNow.AddSeconds(40)
        do {
            try {
                $state = Invoke-RestMethod ("http://127.0.0.1:7780/state/" + $BotName) -TimeoutSec 2
                if ($state.botStatus -eq 'active' -and $state.state) { $ready = $true; break }
            } catch {}
            if (!(Get-ManagedProcess 'bot')) { throw 'Bot exited. Check local.cmd logs -Service bot' }
            Start-Sleep -Milliseconds 500
        } while ([datetime]::UtcNow -lt $deadline)
        if (!$ready) { throw 'Bot did not connect. Check local.cmd logs -Service bot' }
        Start-LocalService 'routine'
        Show-Status
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
