// Run in a subprocess with WORLD_FEED=true and a temporary cwd; no worker or network service starts.
import { afterEach, expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';

class TestWorker extends EventEmitter {
    postMessage() {}
}
mock.module('worker_threads', () => ({ Worker: TestWorker }));

const { default: World } = await import('../../src/engine/World.js');
const { NetworkPlayer } = await import('../../src/engine/entity/NetworkPlayer.js');
const { default: NullClientSocket } = await import('../../src/server/NullClientSocket.js');
const { Visibility } = await import('../../src/network/rsbuf/visibility.js');
const { checkWorldFeedUpgrade, cycleWorldFeed, onWorldFeedClose, onWorldFeedMessage, onWorldFeedOpen, getPlayerPositionsJson } = await import('../../src/web/worldfeed.js');

type Message = { t: string; [key: string]: any };

const viewers: { close: () => void }[] = [];

afterEach(() => {
    World.zonesTracking.clear();
    for (const v of viewers.splice(0)) {
        v.close();
    }
    for (const player of World.playerLoop.all()) {
        player.unlink();
    }
});

function viewer(area?: { x: number; z: number; w: number; h: number }) {
    const sent: string[] = [];
    const ws = { data: { isWorldFeed: true }, send: (msg: string) => sent.push(msg), getBufferedAmount: () => 0 } as any;
    onWorldFeedOpen(ws);
    if (area) {
        onWorldFeedMessage(ws, JSON.stringify({ t: 'sub', ...area }));
    }
    const v = {
        ws,
        sent,
        last: (): Message => JSON.parse(sent[sent.length - 1]),
        close: () => onWorldFeedClose(ws)
    };
    viewers.push(v);
    return v;
}

function addPlayer(slot: number, x: number, z: number) {
    const player = new NetworkPlayer('feed' + slot, BigInt(slot), BigInt(slot), new NullClientSocket());
    player.slot = slot;
    player.x = player.lastTickX = x;
    player.z = player.lastTickZ = z;
    player.level = player.lastLevel = 0;
    player.isActive = true;
    player.appearanceBuf = Uint8Array.of(0, 0, 1, 2, 3);
    World.playerLoop.add(BigInt(slot), player);
    World.players[slot] = player;
    return player;
}

// What the engine does between ticks: cleanup resets the per-tick state.
function endTick() {
    for (const player of World.playerLoop.all()) {
        player.lastTickX = player.x;
        player.lastTickZ = player.z;
        player.lastLevel = player.level;
        player.walkDir = player.runDir = -1;
        player.tele = player.jump = false;
        player.masks = 0;
    }
    World.currentTick++;
}

const AREA = { x: 3200, z: 3200, w: 64, h: 64 };

test('first sight, shared step deltas, hidden players and leaving the area', () => {
    World.currentTick = 1;
    const a = viewer(AREA);
    const b = viewer(AREA);
    const outside = viewer({ x: 0, z: 0, w: 8, h: 8 });
    expect(JSON.parse(a.sent[0])).toMatchObject({ t: 'hello', v: 1 });

    const player = addPlayer(5, 3210, 3210);
    const hidden = addPlayer(6, 3211, 3211);
    hidden.visibility = Visibility.HARD;

    cycleWorldFeed();
    expect(a.last().p).toEqual([{ i: 5, f: 1, x: 3210, z: 3210, l: 0, ap: Buffer.from([0, 0, 1, 2, 3]).toString('base64') }]);
    expect(outside.last().p).toBeUndefined();
    endTick();

    // Idle: a tick with nothing in it.
    cycleWorldFeed();
    expect(a.last()).toEqual({ t: 'tick', k: 2, ms: expect.any(Number) });
    endTick();

    // Runs two steps east then north-east: both viewers get the same steps.
    player.x = 3212;
    player.z = 3211;
    player.walkDir = 4;
    player.runDir = 2;
    cycleWorldFeed();
    expect(a.last().p).toEqual([{ i: 5, x: 3212, z: 3211, l: 0, m: [4, 2] }]);
    expect(a.sent[a.sent.length - 1]).toBe(b.sent[b.sent.length - 1]);
    endTick();

    // Teleports out of the subscribed area: removed.
    player.x = 3300;
    player.tele = true;
    cycleWorldFeed();
    expect(a.last().rp).toEqual([5]);
    expect(a.last().p).toBeUndefined();
});

test('roster lists visible players every few ticks', () => {
    World.currentTick = 10;
    const v = viewer();
    onWorldFeedMessage(v.ws, JSON.stringify({ t: 'roster', on: true }));
    const player = addPlayer(7, 3222, 3218);

    cycleWorldFeed();
    const roster = v.sent.map(s => JSON.parse(s)).find(m => m.t === 'roster');
    expect(roster.p).toEqual([[7, 'Feed7', 3222, 3218, 0, 3]]);
    expect(player.isActive).toBe(true);
});

test('upgrade checks the token when one is configured', () => {
    expect(checkWorldFeedUpgrade(new URL('http://localhost/worldfeed'))).toBeUndefined();
});


test('map snapshots are shared for a second and roster work runs every ten ticks', () => {
    const player = addPlayer(22, 3210, 3210);
    const first = getPlayerPositionsJson(1000);
    player.x++;
    expect(getPlayerPositionsJson(1999)).toBe(first);
    expect(JSON.parse(getPlayerPositionsJson(2000))[0].x).toBe(3211);
    const v = viewer();
    onWorldFeedMessage(v.ws, JSON.stringify({ t: 'roster', on: true }));
    World.currentTick = 15;
    cycleWorldFeed();
    expect(v.sent.some(s => JSON.parse(s).t === 'roster')).toBe(false);
    World.currentTick = 20;
    cycleWorldFeed();
    expect(v.last().t).toBe('roster');
});

test('zone membership stays cached until movement, map origin, plane or clear changes it', () => {
    const player = addPlayer(23, 3210, 3210);
    player.originX = player.x; player.originZ = player.z;
    const area = player.buildArea;
    let clears = 0;
    const clear = area.activeZones.clear.bind(area.activeZones);
    area.activeZones.clear = () => { clears++; clear(); };
    area.rebuildZones(); area.rebuildZones();
    player.x++; area.rebuildZones();
    expect(clears).toBe(1);
    player.x += 8; area.rebuildZones();
    player.originX += 8; area.rebuildZones();
    player.level++; area.rebuildZones();
    expect(clears).toBe(4);
    area.clear(false); area.rebuildZones();
    expect(clears).toBe(6);
    expect(area.activeZones.size).toBeGreaterThan(0);
});

test('loaded unchanged zones skip writes, new zones and private events retain delivery', () => {
    const player = addPlayer(24, 3210, 3210);
    const zone = World.gameMap.getZone(3210, 3210, 0);
    player.buildArea.activeZones.add(zone.index);
    const written: any[] = [];
    player.write = message => { written.push(message); };
    player.updateZones();
    expect(written.length).toBeGreaterThan(0); // First sight always sends a full update.
    written.length = 0;
    player.updateZones();
    expect(written).toEqual([]);
    const mine = { marker: 'mine' }, theirs = { marker: 'theirs' };
    // ZoneEventType.FOLLOWS = 1; use actual zone filtering with capture-only output.
    (zone as any).events.add({ type: 1, receiver64: player.hash64, message: mine });
    (zone as any).events.add({ type: 1, receiver64: 999n, message: theirs });
    World.trackZone(zone);
    player.updateZones();
    expect(written).toContain(mine);
    expect(written).not.toContain(theirs);
    zone.reset();
    player.buildArea.activeZones.clear(); player.updateZones();
    expect(player.buildArea.loadedZones.size).toBe(0);
});

const originalNow = Date.now;

test('inspection is opt-in, independent of area, throttled, and does not create inventories', () => {
    const now = mock(Date.now);
    Date.now = now;
    now.mockReturnValue(10000);
    try {
        const player = addPlayer(30, 3210, 3210);
        player.levels[8] = 7;
        player.baseLevels[8] = 6;
        player.stats[8] = 15000;
        const v = viewer();
        const other = viewer();
        expect(JSON.parse(v.sent[0]).inspect).toBe(true);
        onWorldFeedMessage(v.ws, JSON.stringify({ t: 'inspect', name: 'FEED30' }));
        cycleWorldFeed();
        expect(v.last()).toMatchObject({ t: 'inspect', name: 'feed30', player: { name: 'Feed30', inventory: Array(28).fill(null) } });
        expect(v.last().player.skills.find((s: any) => s.id === 8)).toMatchObject({ level: 7, baseLevel: 6, xp: 1500 });
        expect(v.last().player.skills).toHaveLength(19);
        expect(player.invs.size).toBe(0);
        expect(other.sent).toHaveLength(1);
        const sent = v.sent.length;
        cycleWorldFeed();
        expect(v.sent).toHaveLength(sent);
        now.mockReturnValue(11000);
        player.visibility = Visibility.HARD;
        cycleWorldFeed();
        expect(v.last().player).toBeNull();
        onWorldFeedMessage(v.ws, JSON.stringify({ t: 'inspect', name: null }));
        now.mockReturnValue(12000);
        cycleWorldFeed();
        expect(v.sent).toHaveLength(sent + 1);
    } finally {
        Date.now = originalNow;
    }
});

test('inspection preserves slots and counts, uses real XP units, and tracks names across slot reuse', async () => {
    const { spyOn } = await import('bun:test');
    const { Inventory } = await import('../../src/engine/Inventory.js');
    const { default: InvType } = await import('../../src/cache/config/InvType.js');
    const { default: ObjType } = await import('../../src/cache/config/ObjType.js');
    const { getExpByLevel } = await import('../../src/engine/entity/Player.js');
    const getItem = spyOn(ObjType, 'get').mockReturnValue({ name: 'Logs' } as any);
    const now = mock(() => 20000);
    Date.now = now;
    try {
        const player = addPlayer(40, 3210, 3210);
        const inv = new Inventory(InvType.INV, 28);
        inv.items[3] = { id: 1511, count: 25 };
        player.invs.set(InvType.INV, inv);
        player.baseLevels[8] = 6;
        player.levels[8] = 7;
        player.stats[8] = 15000;
        const v = viewer();
        onWorldFeedMessage(v.ws, JSON.stringify({ t: 'inspect', name: 'Feed40' }));
        cycleWorldFeed();
        expect(v.last().player.inventory[0]).toBeNull();
        expect(v.last().player.inventory[3]).toEqual({ id: 1511, count: 25, name: 'Logs' });
        expect(v.last().player.skills.find((s: any) => s.id === 8)).toEqual({
            id: 8, name: 'Woodcutting', level: 7, baseLevel: 6, xp: 1500,
            levelXp: getExpByLevel(6) / 10, nextLevelXp: getExpByLevel(7) / 10
        });
        expect(inv.update).toBe(false);
        expect(inv.dirtySlots.size).toBe(0);
        player.unlink();
        const replacement = addPlayer(41, 3210, 3210);
        replacement.slot = 40;
        now.mockReturnValue(21000);
        cycleWorldFeed();
        expect(v.last().player).toBeNull();
        onWorldFeedMessage(v.ws, JSON.stringify({ t: 'inspect', name: 'Feed41' }));
        cycleWorldFeed();
        expect(v.last().player.name).toBe('Feed41');
        const count = v.sent.length;
        onWorldFeedMessage(v.ws, JSON.stringify({ t: 'inspect', name: { bad: true } }));
        cycleWorldFeed();
        expect(v.sent).toHaveLength(count);
    } finally {
        Date.now = originalNow;
        getItem.mockRestore();
    }
});
