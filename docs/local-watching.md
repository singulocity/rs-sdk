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
bot client, and bot routine; it reuses processes already tracked by the launcher.
Stop ends the routine, requests a normal bot logout, waits for zero online players,
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
| routine | Runs the bot's watch.ts (or script.ts) | — |

The first start finds the bot automatically when only one bot folder exists.
To choose explicitly:

```powershell
.\local.cmd start -BotName KuUzmeFTw -ViewerPath C:\Users\jblac\Github\rs-world
```

The launcher remembers the choice in `bots/local-watch/control-config.json`.
Logs and process records are in `bots/local-watch/`; these are ignored by Git.
Logs prints the last 25 lines of both output and error logs; choose
`-Service engine|gateway|viewer|bot|routine|logout`.

Your character's inventory, skills and position persist in the engine's local
save data under `server/engine/data/players/`. Stop and restart preserve that data;
they do not reset the character. Temporary world activity (such as ground drops)
can reset when the engine restarts. No save/database deletion is part of these
commands.

Edit `bots/<name>/watch.ts` to change the bot's behavior, then use `restart` to run
the updated routine. This launcher does not freeze the simulation or edit XP,
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

The shared routine code is in `scripts/training.ts` and `scripts/training-more.ts`. Each bot has its own
`bots/<name>/watch.ts` entry point and separate client/controller processes.
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
and the machine's RAM usage. Click column headings to sort.

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
