[CmdletBinding()]
param(
    [ValidateSet('help', 'start', 'stop', 'restart', 'status', 'logs')]
    [string]$Action = 'status',
    [string]$BotName,
    [string]$ViewerPath,
    [string]$LogBot,
    [ValidateSet('shared', 'separate')]
    [string]$ControllerMode,
    [ValidateSet('engine', 'gateway', 'viewer', 'bot', 'routine', 'controller', 'logout')]
    [string]$Service = 'routine'
)

if ($Action -eq 'help') {
    Write-Host @'
Usage: .\local.cmd <command> [options]

Commands:
  help      Show this reference.
  status    Show services, process IDs, and ports.
  start     Start the server, gateway, viewer, bot clients, and controller.
  stop      Log out and save the bot, then stop the local setup.
  restart   Stop the local setup, then start it again.
  logs      Show the last 25 lines of output and errors (default: routine).

Options:
  -LogBot      Select a fleet bot for bot/routine/logout logs.
  -Service     engine | gateway | viewer | bot | routine | controller | logout
               Select which logs to display.
  -ControllerMode shared (default) | separate; the choice is remembered.
  -BotName     Choose the bot when starting; the choice is remembered.
  -ViewerPath  Path to your rs-world checkout; the choice is remembered.

Examples:
  .\local.cmd status
  .\local.cmd stop
  .\local.cmd logs -Service engine
  .\local.cmd logs -Service routine -LogBot PondPiper
  .\local.cmd start -BotName KuUzmeFTw -ViewerPath C:\Users\jblac\Github\rs-world

Viewer: http://localhost:3000
Start, stop, and status include additional bots in bots/local-watch/fleet.json.
Closing the browser or terminal does not stop the background services.
Stop retries logout for up to 90 seconds if combat blocks it.
If logout cannot complete, the server stays running to preserve progress.
'@
    exit 0
}

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$stateDir = Join-Path $repoRoot 'bots/local-watch'
$logDir = Join-Path $stateDir 'logs'
$configFile = Join-Path $stateDir 'control-config.json'
$config = if (Test-Path -LiteralPath $configFile) { Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json } else { $null }
if (!$ControllerMode) { $ControllerMode = if ($config -and $config.controllerMode) { $config.controllerMode } else { 'shared' } }
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
    controller = @{ cwd = $repoRoot; entry = 'scripts/fleet-controller.ts'; pattern = 'scripts[\\/]fleet-controller\.ts'; port = 0 }
    routine = @{ cwd = $repoRoot; entry = $routineFile; pattern = [regex]::Escape([IO.Path]::GetFileName($routineFile)); port = 0 }
}
$serviceNames = @('engine', 'gateway', 'viewer', 'bot')
$serviceNames += $(if ($ControllerMode -eq 'shared') { 'controller' } else { 'routine' })
$specs.bot.botName = $BotName
$specs.routine.botName = $BotName
$botGroups = @(@{name=$BotName;client='bot';routine='routine';logout='logout'})
$fleetFile = Join-Path $stateDir 'fleet.json'
if (Test-Path -LiteralPath $fleetFile) {
    $seen = @($BotName)
    $members = Get-Content -LiteralPath $fleetFile -Raw | ConvertFrom-Json
    foreach ($member in $members) {
        $name = [string]$member.name
        if ($name -notmatch '^[a-zA-Z0-9]{1,12}$' -or $name -in $seen) { throw "Invalid or duplicate fleet bot: $name" }
        $seen += $name
        $clientKey = 'bot-' + $name
        $routineKey = 'routine-' + $name
        $entry = Join-Path $repoRoot ("bots/" + $name + "/watch.ts")
        $specs[$clientKey] = @{cwd=Join-Path $repoRoot 'server/webclient';entry='src/lite/runner.ts';pattern='src[\\/]lite[\\/]runner\.ts';port=0;botName=$name}
        $specs[$routineKey] = @{cwd=$repoRoot;entry=$entry;pattern=[regex]::Escape($entry);port=0;botName=$name}
        $botGroups += @{name=$name;client=$clientKey;routine=$routineKey;logout='logout-'+$name}
        $serviceNames += $clientKey
        if ($ControllerMode -eq 'separate') { $serviceNames += $routineKey }
    }
}


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
    if ($spec.botName) { $arguments += $spec.botName }
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

function Stop-Controller {
    $process = Get-ManagedProcess 'controller'
    if (!$process) { return }
    $startedAt = $null
    try {
        $status = Get-Content -LiteralPath (Join-Path $stateDir 'controller-status.json') -Raw | ConvertFrom-Json
        if ($status.processId -eq $process.ProcessId) { $startedAt = $status.startedAt }
    } catch {}
    @{processId=$process.ProcessId;startedAt=$startedAt} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $stateDir 'controller-stop.json')
    $deadline = [datetime]::UtcNow.AddSeconds(15)
    while ((Get-ManagedProcess 'controller') -and [datetime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 250 }
    if (Get-ManagedProcess 'controller') { Write-Warning 'Controller shutdown timed out; stopping its managed process tree.' }
    Stop-LocalService 'controller'
}

function Wait-Controller {
    $deadline = [datetime]::UtcNow.AddSeconds(60)
    do {
        $process = Get-ManagedProcess 'controller'
        if (!$process) { throw 'Shared controller exited. See local.cmd logs -Service controller.' }
        try {
            $status = Get-Content -LiteralPath (Join-Path $stateDir 'controller-status.json') -Raw | ConvertFrom-Json
            $ready = $status.processId -eq $process.ProcessId -and
                ([datetime]$status.updatedAt).ToUniversalTime() -ge $process.CreationDate.ToUniversalTime()
            foreach ($group in $botGroups) { if ($status.bots.($group.name).state -ne 'running') { $ready = $false } }
            if ($ready) { return }
        } catch {}
        Start-Sleep -Milliseconds 500
    } while ([datetime]::UtcNow -lt $deadline)
    throw 'Some shared-controller bots are not ready. The controller keeps retrying; see local.cmd logs -Service controller.'
}

function Show-Status {
    $rows = foreach ($name in $serviceNames) {
        $process = Get-ManagedProcess $name
        [pscustomobject]@{ Service = $name; State = $(if ($process) { 'Running' } else { 'Stopped' });
            PID = $(if ($process) { $process.ProcessId } else { '-' }); Port = $(if ($specs[$name].port) { $specs[$name].port } else { '-' }) }
    }
    $rows | Format-Table -AutoSize | Out-Host
    if ($ControllerMode -eq 'shared' -and (Get-ManagedProcess 'controller')) {
        try {
            $status = Get-Content -LiteralPath (Join-Path $stateDir 'controller-status.json') -Raw | ConvertFrom-Json
            $status.bots.PSObject.Properties | ForEach-Object {
                [pscustomobject]@{Bot=$_.Name;Role=$_.Value.role;Training=$_.Value.state}
            } | Format-Table -AutoSize | Out-Host
        } catch {}
    }
    Write-Host ("Bots: " + (($botGroups | ForEach-Object { $_.name }) -join ", "))
    Write-Host 'Viewer: http://localhost:3000'
    Write-Host "Logs: $logDir"
}

function Start-BotGroup($Group) {
    Start-LocalService $Group.client
    $ready = $false
    $deadline = [datetime]::UtcNow.AddSeconds(40)
    do {
        try {
            $state = Invoke-RestMethod ("http://127.0.0.1:7780/state/" + $Group.name) -TimeoutSec 2
            if ($state.botStatus -eq 'active' -and $state.state) { $ready = $true; break }
        } catch {}
        if (!(Get-ManagedProcess $Group.client)) { throw ("Bot exited: " + $Group.name) }
        Start-Sleep -Milliseconds 500
    } while ([datetime]::UtcNow -lt $deadline)
    if (!$ready) { throw ("Bot did not connect: " + $Group.name) }
    if ($ControllerMode -eq 'separate') { Start-LocalService $Group.routine }
}

function Stop-Stack {
    Stop-Controller
    foreach ($group in $botGroups) { Stop-LocalService $group.routine }
    if (Get-ManagedProcess 'engine') {
        foreach ($group in $botGroups) {
            if (!(Get-ManagedProcess $group.client)) { continue }
            Write-Host ("Logging out " + $group.name + " and waiting for its character save...")
            $logout = Join-Path $repoRoot 'scripts/local-logout.ts'
            $arguments = @($logout, $group.name) | ForEach-Object { '"' + $_ + '"' }
            $job = Start-Process -FilePath (Get-BunPath) -ArgumentList $arguments -WorkingDirectory $repoRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir ($group.logout + '.out.log')) -RedirectStandardError (Join-Path $logDir ($group.logout + '.err.log'))
            $logoutDeadline = [datetime]::UtcNow.AddSeconds(120)
            $elapsedSeconds = 0
            while (!$job.WaitForExit(1000) -and [datetime]::UtcNow -lt $logoutDeadline) {
                $elapsedSeconds++
                if ($elapsedSeconds % 5 -eq 0) { Write-Host ("Waiting for " + $group.name + " logout ($elapsedSeconds seconds); combat can delay it.") }
            }
            if (!$job.HasExited) {
                $job.Kill()
                throw 'Logout timed out. Server was left running. Check logout logs.'
            }
            Get-Content -LiteralPath (Join-Path $logDir ($group.logout + '.out.log')) -Tail 1 | Out-Host
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
    foreach ($group in $botGroups) { Stop-LocalService $group.client }
    foreach ($name in @('viewer', 'engine', 'gateway')) { Stop-LocalService $name }
    Write-Host 'Local setup stopped. Saved characters and databases are preserved.'
}

try {
    if ($Action -eq 'status') { Show-Status; exit 0 }
    if ($Action -eq 'logs') {
        $logKey = if ($Service -eq 'routine' -and !$LogBot -and $ControllerMode -eq 'shared') { 'controller' } else { $Service }
        if ($LogBot) {
            $group = $botGroups | Where-Object { $_.name -eq $LogBot } | Select-Object -First 1
            if (!$group -or $Service -notin @('bot','routine','logout')) { throw 'Choose a configured -LogBot with -Service bot, routine, or logout.' }
            $logKey = switch ($Service) { 'bot' {$group.client} 'routine' {$group.routine} 'logout' {$group.logout} }
        }
        $paths = @((Join-Path $logDir ($logKey + '.out.log')), (Join-Path $logDir ($logKey + '.err.log')))
        foreach ($path in $paths) {
            Write-Host $path
            if (Test-Path -LiteralPath $path) { Get-Content -LiteralPath $path -Tail 25 }
        }
        exit 0
    }
    if ($Action -eq 'stop' -or $Action -eq 'restart') { Stop-Stack }
    if ($Action -eq 'start' -or $Action -eq 'restart') {
        if (!(Test-Path -LiteralPath (Join-Path $botDir 'bot.env'))) { throw "Missing bot credentials in $botDir" }
        if ($ControllerMode -eq 'separate' -and !(Test-Path -LiteralPath $routineFile)) { throw 'Create watch.ts or script.ts in the bot folder first.' }
        foreach ($group in $botGroups) {
            $envPath = Join-Path $repoRoot ("bots/" + $group.name + "/bot.env")
            if (!(Test-Path -LiteralPath $envPath) -or ($ControllerMode -eq 'separate' -and !(Test-Path -LiteralPath $specs[$group.routine].entry))) { throw ("Missing credentials or routine for " + $group.name) }
        }
        $null = New-Item -ItemType Directory -Path $logDir -Force
        $primaryRole = if ($config -and $config.primaryRole) { $config.primaryRole } else { 'woodcutting' }
        @{ botName = $BotName; viewerPath = $ViewerPath; controllerMode=$ControllerMode; primaryRole=$primaryRole } | ConvertTo-Json | Set-Content -LiteralPath $configFile
        if ($ControllerMode -eq 'shared') {
            & (Get-BunPath) (Join-Path $repoRoot 'scripts/fleet-controller.ts') --check
            if ($LASTEXITCODE -ne 0) { throw 'Shared-controller preflight failed; existing routines were left running.' }
            foreach ($group in $botGroups) { Stop-LocalService $group.routine }
        } else { Stop-Controller }
        $env:WORLD_FEED = 'true'
        $env:EASY_STARTUP = 'true'
        $env:BUILD_VERIFY = 'false'
        $env:GATEWAY_HOSTNAME = '127.0.0.1'
        $env:LOCAL_PROCESS_METRICS = 'true'
        $env:BROWSER = 'none'
        $env:HOST = '127.0.0.1'
        $env:PORT = '3000'
        Start-LocalService 'engine'
        Wait-Http 'engine' 'http://127.0.0.1:8888/playercount'
        Start-LocalService 'gateway'
        Wait-Http 'gateway' 'http://127.0.0.1:7780/' 30
        Start-LocalService 'viewer'
        Wait-Http 'viewer' 'http://127.0.0.1:3000'
        foreach ($group in $botGroups) { Start-BotGroup $group }
        if ($ControllerMode -eq 'shared') { Start-LocalService 'controller'; Wait-Controller }
        Show-Status
    }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
