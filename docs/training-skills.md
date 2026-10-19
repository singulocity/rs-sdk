# Skill training coverage

This server build has 21 stat slots and 19 enabled skills. Slots STAT18 and
STAT19 are disabled placeholders; they are not additional trainable skills.
The source of truth is `server/engine/src/engine/entity/PlayerStat.ts`.

| Skill | Current bot |
| --- | --- |
| Attack | BladeBram |
| Defence | Not assigned |
| Strength | Not assigned |
| Hitpoints | Gained alongside combat |
| Ranged | Not assigned |
| Prayer | BoneBasil |
| Magic | Not assigned |
| Cooking | ChefCora |
| Woodcutting | KuUzmeFTw |
| Fletching | FletchFinn |
| Fishing | PondPiper |
| Firemaking | EmberEtta |
| Crafting | WeaverWren |
| Smithing | Not assigned |
| Mining | OreOtis |
| Herblore | Not assigned |
| Agility | Not assigned |
| Thieving | SneakSage |
| Runecraft | Not assigned |

The latest five routines use ordinary game actions and gather their own supplies:

- ChefCora catches shrimp/anchovies at Draynor, then cooks batches at a nearby fireplace.
- FletchFinn collects a knife, chops ordinary trees, and cuts logs into arrow shafts.
- WeaverWren earns a few coins for shears, shears sheep, and spins wool in Lumbridge Castle.
- SneakSage pickpockets men in Lumbridge, eats starter food, and rests at low HP.
- BoneBasil collects and buries chicken bones; it can fight chickens when no bones are available.

The primary routines can also earn supporting skills while collecting materials.
Cooking can burn food, and thieving can fail and stun the bot; these are normal
game outcomes. The bots retry and verify inventory or XP changes.

Use `bun scripts/setup-training-fleet.ts` to create missing bot folders and register
the nine extra bots alongside your original woodcutter. Credentials, process
records, and character saves remain local. `local.cmd start`, `stop`, `restart`,
and `status` include every bot in `bots/local-watch/fleet.json`.
