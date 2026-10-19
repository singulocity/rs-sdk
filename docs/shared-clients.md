# Shared headless client measurements

Measured on 2026-10-19 on the same Windows PC with ten existing training accounts
and a shared controller. Both samples cover 30 seconds. Before: one Bun game-client
process per account. After: one Bun host with ten independent LiteClient sessions.

| Scope | Before working set (MiB) | After working set (MiB) | Before private commit (MiB) | After private commit (MiB) |
| --- | ---: | ---: | ---: | ---: |
| Clients | 1027.4 | 134.7 | 3071.5 | 366.4 |
| Clients + controller | 1466.9 | 558.3 | 3654.4 | 935.0 |

Client working set fell about 87%, and client private commit about 88%. The host
shares the Bun runtime, static game configuration and immutable world loc index.
Each bot retains its own network connections, packet buffers, dynamic scene,
copy-on-write interface state and action queue. The preexisting standalone runner
remains available with -ClientMode separate. Nothing is rendered by either client
mode; the spectator viewer handles 3D rendering in its own browser.

Client CPU during these samples was 1.4% before and 0.7% after,
expressed as a fraction of all 12 logical processors. Workloads vary; these short
samples do not establish throughput or maximum capacity. Switching modes requires
saved logout and reconnect, so server, gateway and controller were also restarted.
Their heap ages and workload phases differ. The client comparison is more useful
than comparing the entire machine's RAM across those restarts.

Ten bots were active before and after the sample. Eight gained XP during the
30-second shared-client window; cooking and crafting gained none during that
window. Distinct inventory snapshots and existing real packet-handler tests
confirmed interface isolation. A real single-account logout left the other nine
connected in the same process. Full saved logout and cold start were also checked.

These figures exclude console helper children, engine, gateway, viewer and browser/GPU.
The Processes dashboard includes managed helper children, so its All bots total
is slightly larger. Shared clients and controller are counted once there. Working
sets can double-count shared pages; private commit can be paged out. Neither is
a reliable per-bot allocation once accounts share a heap.

Raw reports live locally in ignored bots/local-watch/benchmarks/ten-separate-clients.json
and ten-shared-clients.json. The session status file clients-status.json and all
credentials remain local. Game cache files now use the OS home directory on Windows;
the previous HOME-based default could accidentally create an undefined directory.

For 1,000 bots, measure additional fleet sizes and server tick latency before
estimating capacity. A shared host has one JavaScript event loop and one failure
domain. Multiple smaller hosts could distribute CPU and limit the impact of a
process crash, but host pooling is not implemented in this change.
