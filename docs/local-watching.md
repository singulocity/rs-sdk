# Running the local bot viewer on Windows

This setup runs entirely on your PC. Run commands from your rs-sdk folder in
PowerShell or Windows Terminal:

```powershell
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
then closes the managed services and the viewer's child processes. If logout
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
