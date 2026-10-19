# Running the local bot viewer on Windows

This setup runs entirely on your PC. Run commands from your rs-sdk folder in
PowerShell or Windows Terminal:

```powershell
.\local.cmd help
.\local.cmd status
.\local.cmd start
.\local.cmd stop
.\local.cmd restart
.\local.cmd logs
.\local.cmd logs -Service engine
```

Open http://localhost:3000 to watch. Start launches the engine, gateway, viewer,
one shared client host, and one shared controller; it reuses tracked processes.
Stop cancels all controller routines, requests a normal bot logout, waits for zero online players,
then closes the managed services and the viewer's child processes. Combat blocks
logout until 10 seconds after it ends; the launcher retries for up to 90 seconds
and prints waiting messages. It requires an observed client disconnect, rather
than treating a successful button dispatch as a completed logout. If logout
cannot finish, it leaves the server running and reports the problem.

Closing the browser or terminal does **not** stop background services. Use
`local.cmd stop` when finished. Status lists their PIDs so you can identify them
in Task Manager. Avoid stopping every Bun or Node process by name, since other
projects may use them.

| Service | Purpose | Port |
| --- | --- | --- |
| engine | Game server and persistent characters | 8888 |
| gateway | Routes bot state and script commands | 7780 |
| viewer | rs-world website | 3000 |
| bot | Logged-in headless game client | — |
| controller | Runs all configured training routines with one shared pathfinder | — |
| routine | Per-bot watch.ts entry point in optional separate mode | — |

The first start finds the bot automatically when only one bot folder exists.
To choose explicitly:

```powershell
.\local.cmd start -BotName KuUzmeFTw -ViewerPath C:\Users\jblac\Github\rs-world
```

The launcher remembers the choice in `bots/local-watch/control-config.json`.
Logs and process records are in `bots/local-watch/`; these are ignored by Git.
Logs prints the last 25 lines of both output and error logs; choose
`-Service engine|gateway|viewer|bot|routine|controller|clients|logout`.
Without `-LogBot`, routine logs show the shared controller; `-LogBot` selects the
individual bot's log. Status includes each supervised bot's role and training state.

Your character's inventory, skills and position persist in the engine's local
save data under `server/engine/data/players/`. Stop and restart preserve that data;
they do not reset the character. Temporary world activity (such as ground drops)
can reset when the engine restarts. No save/database deletion is part of these
commands.

Shared mode runs the reusable roles in `scripts/training.ts`,
`scripts/training-more.ts` and `scripts/training-woodcutting.ts`. Edit these and
restart to change training behavior. Individual `bots/<name>/watch.ts` files
remain available in separate mode. This launcher does not freeze the simulation or edit XP,
inventories or world state; those are separate server/game operations.

## Ten-bot training fleet

Run the original bot plus nine training bots:

| Bot | Activity | Location |
| --- | --- | --- |
| KuUzmeFTw | Woodcutting | Lumbridge |
| BladeBram | Attack and Hitpoints, fighting chickens | Lumbridge chicken farm |
| PondPiper | Small-net fishing | Draynor shore, south of the dark wizards |
| OreOtis | Copper/tin mining | Southeast Varrock mine |
| EmberEtta | Firemaking; chops replacement logs | West of Lumbridge |
| ChefCora | Cooking; catches its own fish | Draynor |
| FletchFinn | Fletching arrow shafts | Lumbridge |
| WeaverWren | Shearing sheep and spinning wool | Lumbridge farm/castle |
| SneakSage | Pickpocketing men | Lumbridge |
| BoneBasil | Burying bones | Lumbridge chicken farm |

The training functions run concurrently in `scripts/fleet-controller.ts`. Each bot
has its own SDK connection, state, cancellation scope and retry loop. One process
owns the shared collision map/pathfinder. Game sessions run in one shared client process by default.
They keep their own skills, inventory and position. Low-HP bots eat available
food; combat pauses at low HP when food runs out. Safe gathering can continue
during natural healing. Fishing/mining bots drop their catches/ore when nearly full.

To recreate the nine extra accounts locally without committing credentials:

```powershell
bun scripts/setup-training-fleet.ts
.\local.cmd start
.\local.cmd status
.\local.cmd logs -Service routine -LogBot PondPiper
.\local.cmd stop
```

The extra bots are listed in `bots/local-watch/fleet.json`.
The regular start/stop/restart/status commands include all listed bots.
Stop ends all routines before logging out all ten characters and stopping
the server. Credentials and character saves stay local.

To repeat a resource sample while the bots are actively training:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/measure-local.ps1 -Label five-bots -Seconds 30
```

Reports are saved under `bots/local-watch/benchmarks/`. They include average
and peak resident memory, private memory allocations, CPU usage, and before/after
skill XP. Viewer development-server children are counted as shared overhead.
Browser/GPU usage is outside the report. These short samples are comparisons of
this workload, not maximum fleet capacity or a linear scaling guarantee.

See [Skill coverage](training-skills.md) for the 19 enabled skills and remaining training roles.

## Process memory dashboard

Click **Processes** in the viewer's bottom-right corner to see all managed
services, bot clients/controllers and their child processes. It replaces Info.
The table includes PIDs, working sets and private committed bytes, with totals
and the machine's RAM usage. Expand **All bots** for per-bot client totals and
the **Shared clients** and **Shared controller** rows. Shared memory is counted
once under All bots and cannot be attributed to individual characters. In separate
client mode, expand a bot for its processes and PIDs. The bot count includes configured
fleet members, including ones whose sessions have ended.
Engine, gateway and viewer remain outside that total. Click column headings to sort.

The Windows gateway samples on demand and shares a cached reading for five seconds.
Closing the panel stops polling. Browser/GPU memory is excluded; working-set
sums can double-count shared pages, and private committed memory may be paged out.
On sampling failure the last good reading stays visible with a warning.

`local.cmd start` enables the loopback-only `GET http://localhost:7780/local/metrics`
endpoint using `LOCAL_PROCESS_METRICS=true`. Existing gateway processes need one
restart to load the new endpoint. The sampler reads process records and verifies
their creation time to exclude stale/reused PIDs; it does not expose command lines.

Drag the character inspector by its title to reposition it. The title also accepts
arrow keys when focused. It stays within the window when dragged or resized.

## Shared controller

Shared mode is the default. `start -ControllerMode shared` validates the fleet,
stops any old standalone routines, and attaches the shared controller to the
existing game clients. Character state and live client sessions are preserved
during this migration. Shutdown cancels controller work before requesting saved
game logouts. The shared controller supports the ten roles listed in
`scripts/fleet-config.ts`; credentials stay in each bot's local env file.

The primary role defaults to woodcutting; `primaryRole` in
`bots/local-watch/control-config.json` can select another supported role. Other
roles come from `bots/local-watch/fleet.json`. Restart after changing membership
or roles so the controller reloads them. Startup rejects duplicate names,
unsupported roles and mismatched credentials before stopping existing routines.

Use `local.cmd logs -Service controller` for combined logs, or
`local.cmd logs -Service routine -LogBot ChefCora` for one bot.
`controller-status.json` reports each bot's state and is ignored by Git.

To use personal standalone watch scripts or roll back to individual controllers:

```powershell
.\local.cmd start -ControllerMode separate
.\local.cmd start -ControllerMode shared
```

The selected mode is remembered. A failed bot session is cancelled and retried
without restarting healthy sessions. A process-level crash still affects the
whole controller, and synchronous pathfinding shares its CPU thread. This is a
first memory optimization; it is not a validated 1,000-bot capacity claim.

See [Shared-controller measurements](shared-controller.md) for the initial comparison.

## Shared game clients

The default is one client host for the configured fleet. Each character still has
its own login, game socket, gateway connection, action queue, scene, inventory and
skills. The Bun runtime, game definitions, base interfaces and immutable world
location index are shared. The Windows cache path uses the user's home directory.

Switch modes with:

```powershell
.\local.cmd start -ClientMode shared
.\local.cmd start -ClientMode separate
.\local.cmd logs -Service clients
```

The mode is remembered independently of ControllerMode. Switching client modes
uses the normal logout/save/stop/start sequence because game sockets cannot move
between processes. Changing only controller mode can reuse running clients.

Shared clients must use the same SERVER and PROFANITY_FILTER settings. Preflight
rejects incompatible settings before stopping services and restores the previous
launcher configuration if validation fails. Use separate mode for mixed servers.

Status includes each account's client state. Shared client logs contain the whole
host; -Service bot (including -LogBot) selects those combined logs in shared mode.
Routine logs remain per bot. Client session failures and intentional logouts affect
only that account and do not automatically log it back in. Run start again to save
and restart a host with ended sessions, or restart explicitly. Controller retries
alone cannot restore an ended game-client session. A process crash affects all
hosted clients. Normal stop still confirms saved logout before terminating the host.

See [Shared-client measurements](shared-clients.md).

## Expand to 100 accounts

To keep the original ten and add nine more accounts to each routine:

```powershell
.\local.cmd stop
bun scripts/expand-training-fleet.ts --per-role=10
.\local.cmd start -ClientMode shared -ControllerMode shared
```

`--dry-run` previews the new names and assignments. The utility uses online-style
handles, avoids existing bot folders, preserves current credentials and routines,
and creates standalone watch.ts wrappers for new accounts. Running it again at
the requested count adds nothing. The ten routines each have ten accounts;
shared mode still uses one client host and one controller for all 100.

The local roster is bots/local-watch/fleet.json plus the primary account in
control-config.json. Account credentials and character saves remain local.
Startup, tutorial completion, travel, resource contention and low-HP rests can
make progress uneven across accounts; inspect their state and logs to check
what a particular bot is doing.