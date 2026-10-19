# Shared-controller measurements

Two 30-second samples on a 32 GiB, Ryzen 5 5600X Windows desktop, with ten
skill-training bots. The first migration kept the game engine, gateway and all
ten clients running; it replaced ten standalone controllers with one shared
controller. Each account retained its own SDK connection and training state.

| Scope | Before working set | After working set | Before private commit | After private commit |
| --- | ---: | ---: | ---: | ---: |
| Controllers | 3.85 GiB | 0.41 GiB | 5.17 GiB | 0.55 GiB |
| Clients + controllers | 4.83 GiB | 1.40 GiB | 8.19 GiB | 3.46 GiB |

Client-plus-controller working sets fell about 71%. Controller working sets
alone fell about 89%. These are averages of per-process readings. The table
excludes engine, gateway, viewer, browser/GPU and console helper children; the
dashboard includes managed child processes, so its totals differ slightly.
Working sets can double-count shared pages; private commit is not all resident
RAM. This is a workload comparison, not a capacity guarantee for 1,000 bots.

Raw local reports: `bots/local-watch/benchmarks/ten-separate-controllers.json`
and `ten-shared-controller.json` (ignored by Git). A subsequent saved-character
stop/start and `ten-shared-controller-verified.json` sample confirmed all ten
clients remained connected and training continued. The benchmark's bot-name
array handling was corrected so subsequent skill snapshots include every bot;
the initial reports' process memory readings are unaffected.

The next potential memory reduction is consolidating headless game clients.
They remain one process per bot in this change. Shared controller memory is
shown once under All bots, separate from each bot's attributable client memory.
