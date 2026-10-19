[CmdletBinding()]
param([ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$Label = 'sample', [ValidateRange(10,120)][int]$Seconds = 30)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$stateDir = Join-Path $root 'bots/local-watch'
$tracked = @()
foreach ($file in Get-ChildItem -LiteralPath $stateDir -Filter '*-process.json') {
    $record = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
    $process = Get-Process -Id $record.processId -ErrorAction SilentlyContinue
    if ($process -and $record.startedAt -and [math]::Abs(($process.StartTime.ToUniversalTime() - ([datetime]$record.startedAt).ToUniversalTime()).TotalSeconds) -gt 10) { continue }
    if ($process) {
        $tracked += [pscustomobject]@{name=$record.name; id=$process.Id; started=$process.StartTime; cpu=$process.TotalProcessorTime.TotalSeconds}
    }
}
# The development viewer has a small process tree. Count its children as shared overhead.
$processes = @(Get-CimInstance Win32_Process)
$viewer = $tracked | Where-Object name -eq 'viewer'
if ($viewer) {
    $parents = @($viewer.id)
    do {
        $children = @($processes | Where-Object { $_.ParentProcessId -in $parents -and $_.ProcessId -notin $tracked.id })
        $parents = @()
        foreach ($child in $children) {
            $process = Get-Process -Id $child.ProcessId -ErrorAction SilentlyContinue
            if ($process) {
                $tracked += [pscustomobject]@{name='viewer-child';id=$process.Id;started=$process.StartTime;cpu=$process.TotalProcessorTime.TotalSeconds}
                $parents += $process.Id
            }
        }
    } while ($parents.Count -gt 0)
}
function Get-Skills {
    $controlFile = Join-Path $stateDir 'control-config.json'
    $names = if (Test-Path -LiteralPath $controlFile) { @((Get-Content -LiteralPath $controlFile -Raw | ConvertFrom-Json).botName) } else { @() }
    $manifest = Join-Path $stateDir 'fleet.json'
    if (Test-Path -LiteralPath $manifest) { $names += @((Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json).name) }
    foreach ($name in $names) {
        try {
            $s = Invoke-RestMethod ("http://127.0.0.1:7780/state/" + $name) -TimeoutSec 2
            [pscustomobject]@{name=$name;status=$s.botStatus;skills=$s.state.skills;position=@($s.state.player.worldX,$s.state.player.worldZ)}
        } catch {}
    }
}
$before = @(Get-Skills)
$startMemory = Get-CimInstance Win32_OperatingSystem
$samples = @()
$watch = [Diagnostics.Stopwatch]::StartNew()
do {
    foreach ($entry in $tracked) {
        $process = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
        if ($process -and $process.StartTime -eq $entry.started) {
            $samples += [pscustomobject]@{id=$entry.id;rssMiB=$process.WorkingSet64/1MB;privateMiB=$process.PrivateMemorySize64/1MB}
        }
    }
    Start-Sleep -Seconds 2
} while ($watch.Elapsed.TotalSeconds -lt $Seconds)
$elapsed = $watch.Elapsed.TotalSeconds
$cores = [Environment]::ProcessorCount
$rows = foreach ($entry in $tracked) {
    $process = Get-Process -Id $entry.id -ErrorAction SilentlyContinue
    if ($process -and $process.StartTime -eq $entry.started) {
        $own = @($samples | Where-Object id -eq $entry.id)
        [pscustomobject]@{
            name=$entry.name;id=$entry.id
            meanRssMiB=[math]::Round(($own | Measure-Object rssMiB -Average).Average,1)
            peakRssMiB=[math]::Round(($own | Measure-Object rssMiB -Maximum).Maximum,1)
            meanPrivateMiB=[math]::Round(($own | Measure-Object privateMiB -Average).Average,1)
            cpuOneCorePercent=[math]::Round(100*($process.TotalProcessorTime.TotalSeconds-$entry.cpu)/$elapsed,2)
            cpuWholeMachinePercent=[math]::Round(100*($process.TotalProcessorTime.TotalSeconds-$entry.cpu)/$elapsed/$cores,2)
        }
    }
}
$after = @(Get-Skills)
$report = [pscustomobject]@{label=$Label;at=[datetime]::UtcNow.ToString('o');seconds=[math]::Round($elapsed,1);logicalProcessors=$cores;totalRamGiB=[math]::Round($startMemory.TotalVisibleMemorySize/1MB,2);availableRamGiB=[math]::Round($startMemory.FreePhysicalMemory/1MB,2);processes=@($rows);before=$before;after=$after}
$directory = Join-Path $stateDir 'benchmarks'
$null = New-Item -ItemType Directory -Path $directory -Force
$path = Join-Path $directory ($Label + '.json')
$report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $path
$rows | Format-Table -AutoSize | Out-Host
Write-Host "Saved $path"
