[CmdletBinding()]
param([string]$StateDirectory)
$ErrorActionPreference = 'Stop'
if (!$StateDirectory) { $StateDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) 'bots/local-watch' }
$primaryBot = 'Original bot'
$configFile = Join-Path $StateDirectory 'control-config.json'
if (Test-Path -LiteralPath $configFile) {
    try {
        $config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
        if ($config.botName -match '^[a-zA-Z0-9]{1,12}$') { $primaryBot = [string]$config.botName }
    } catch {} # A partial config should not prevent memory sampling.
}
$snapshot = @(Get-CimInstance Win32_Process)
$byId = @{}
foreach ($entry in $snapshot) { $byId[[int]$entry.ProcessId] = $entry }
$tracked = @{}
foreach ($file in Get-ChildItem -LiteralPath $StateDirectory -Filter '*-process.json') {
    try {
        $record = Get-Content -LiteralPath $file.FullName -Raw | ConvertFrom-Json
        if ($record.name -notmatch '^(engine|gateway|viewer|bot|routine|controller|clients)(-[a-zA-Z0-9]{1,12})?$' -or
            $file.BaseName -ne ($record.name + '-process')) { continue }
        $entry = $byId[[int]$record.processId]
        if (!$entry -or !$record.startedAt -or
            [math]::Abs(($entry.CreationDate.ToUniversalTime() - ([datetime]$record.startedAt).ToUniversalTime()).TotalSeconds) -gt 10) { continue }
        $tracked[[int]$entry.ProcessId] = @{entry=$entry;service=[string]$record.name}
    } catch { continue } # Ignore incomplete/stale records during start/stop.
}
# Include descendants once, even if a child also has its own process record.
# This short-lived sampler is excluded from the workload it measures.
$queue = New-Object 'System.Collections.Generic.Queue[int]'
foreach ($key in @($tracked.Keys)) { $queue.Enqueue($key) }
while ($queue.Count -gt 0) {
    $parentKey = $queue.Dequeue()
    $parent = $tracked[$parentKey]
    foreach ($child in $snapshot) {
        $childKey = [int]$child.ProcessId
        if ($child.ParentProcessId -ne $parentKey -or $childKey -eq $PID -or $tracked.ContainsKey($childKey) -or
            $child.CreationDate -lt $parent.entry.CreationDate) { continue }
        $tracked[$childKey] = @{entry=$child;service=($parent.service -replace ' / child$', '') + ' / child'}
        $queue.Enqueue($childKey)
    }
}
$rows = @($tracked.Values | ForEach-Object {
    [pscustomobject]@{
        service=$_.service; pid=[int]$_.entry.ProcessId
        botName=$(if ($_.service -match '^(?:bot|routine)(?:-([a-zA-Z0-9]{1,12}))?(?: / child)?$') {
            if ($Matches[1]) { $Matches[1] } else { $primaryBot }
        } else { $null })
        workingSetBytes=[long]$_.entry.WorkingSetSize
        privateBytes=[long]$_.entry.PrivatePageCount
    }
} | Sort-Object service,pid)
$os = Get-CimInstance Win32_OperatingSystem
[pscustomobject]@{
    sampledAt=[datetime]::UtcNow.ToString('o')
    processes=$rows
    totals=@{
        processCount=$rows.Count
        workingSetBytes=[long](($rows | Measure-Object workingSetBytes -Sum).Sum)
        privateBytes=[long](($rows | Measure-Object privateBytes -Sum).Sum)
    }
    fleet=@{botCount=$(if ($config -and $config.botName) {
        $count = 1
        $manifest = Join-Path $StateDirectory 'fleet.json'
        if (Test-Path -LiteralPath $manifest) { try { $count += @((Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json)).Count } catch {} }
        $count
    } else { 0 })}
    host=@{totalBytes=[long]$os.TotalVisibleMemorySize*1024;availableBytes=[long]$os.FreePhysicalMemory*1024}
} | ConvertTo-Json -Depth 5 -Compress
