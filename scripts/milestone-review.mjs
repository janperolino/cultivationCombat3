import assert from 'node:assert/strict';
import { createSpikeServer } from '../server/spike-server.mjs';
import { ReplicationStream, ReplicaClient, captureDisplayFrame } from '../src/replication.ts';

// CPU/JSON diagnostic, not an internet bandwidth or renderer benchmark.
const { world, authority } = createSpikeServer({ autoTick: false, scene: 'coop' });
world.actors[2].hp = world.actors[2].maxHp = 1e9; // Explicit load fixture: sustain attacks without respawning.
const clients = [0, 1].map(actorId => {
    const id = `load${actorId}`, generation = authority.connect(id, actorId);
    const replica = new ReplicaClient('load');
    const stream = new ReplicationStream(world, 'load', () => captureDisplayFrame(world, authority.tick, authority.receipt(id)));
    return { id, actorId, generation, replica, stream, sequence: 0, action: 0, pages: 0, bytes: 0 };
});
let maxPacketBytes = 0;
function page(c) {
    const payload = c.stream.reply(c.replica.request()), bytes = Buffer.byteLength(JSON.stringify(payload));
    maxPacketBytes = Math.max(maxPacketBytes, bytes); c.bytes += bytes; c.pages++;
    return c.replica.apply(payload);
}
const coldAt = performance.now();
for (const c of clients) while (!c.replica.ready) page(c);
const coldJoin = { pagesPerClient: clients.map(c => c.pages), bytesPerClient: clients.map(c => c.bytes), cpuMs: performance.now() - coldAt };
const memoryBefore = process.memoryUsage(), stepMs = [];
let liveJsonBytes = 0, commandJsonBytes = 0, peakBolts = 0, peakWaves = 0, peakCasts = 0;
for (let tick = 0; tick < 3600; tick++) {
    for (const c of clients) {
        const enemy = world.actors[2];
        const input = { move: { x: (tick % 360 < 180 ? -1 : 1) * (c.actorId ? -1 : 1), y: 0 },
            aim: { x: enemy.x, y: enemy.y, z: enemy.z + .7 }, autoAltitude: true };
        if (tick % 2 === 0) {
            const command = { generation: c.generation, sequence: ++c.sequence, actorId: c.actorId, input };
            commandJsonBytes += Buffer.byteLength(JSON.stringify(command));
            assert.equal(authority.submit(c.id, command).accepted, true);
        }
        if (tick % 90 === c.actorId * 30) {
            const action = { generation: c.generation, sequence: ++c.action, actorId: c.actorId,
                input: { ...input, fire: ['bolt', 'slash', 'nova'][Math.floor(tick / 90) % 3], dash: tick % 360 === 0 }, expiresTick: tick + 120 };
            commandJsonBytes += Buffer.byteLength(JSON.stringify(action));
            assert.equal(authority.submitAction(c.id, action).accepted, true);
        }
    }
    const start = performance.now(); authority.step(); stepMs.push(performance.now() - start);
    peakBolts = Math.max(peakBolts, world.bolts.length); peakWaves = Math.max(peakWaves, world.waves.length); peakCasts = Math.max(peakCasts, world.casts.length);
    for (const c of clients) {
        if (tick % 3 === 0) liveJsonBytes += Buffer.byteLength(JSON.stringify(captureDisplayFrame(world, authority.tick, authority.receipt(c.id))));
        if (tick % 3 === 0 || (c.replica.syncing && tick % 3 === 2)) page(c);
    }
}
for (const c of clients) {
    for (let i = 0; i < 70; i++) { page(c); if (c.replica.revision === world.revision && !c.replica.syncing) break; }
    assert.deepEqual(c.replica.cells, world.cells);
    assert.equal(authority.receipt(c.id).actionApplied, c.action);
}
assert.ok(world.actors[2].hp < 1e9); assert.equal(world.sceneTime, world.time);
assert.equal(world.actors[0].hp, 500); assert.equal(world.actors[1].hp, 500);
stepMs.sort((a, b) => a - b);
const memoryAfter = process.memoryUsage(), round = n => Math.round(n * 1000) / 1000;
console.log(JSON.stringify({ workload: '60 virtual seconds; two allied players + stationary high-HP target; 30Hz motion, staggered attacks, 20Hz live JSON, paged terrain',
    coldJoin: { ...coldJoin, cpuMs: round(coldJoin.cpuMs) }, steps: stepMs.length,
    authorityStepMs: { mean: round(stepMs.reduce((a, b) => a + b, 0) / stepMs.length), p95: round(stepMs[Math.floor(stepMs.length * .95)]), max: round(stepMs.at(-1)) },
    heapUsedBefore: memoryBefore.heapUsed, heapUsedAfter: memoryAfter.heapUsed, rssAfter: memoryAfter.rss,
    peaks: { bolts: peakBolts, waves: peakWaves, casts: peakCasts }, maxPacketBytes,
    modeledJsonBytes: { commands: commandJsonBytes, live: liveJsonBytes, terrain: clients.reduce((sum, c) => sum + c.bytes, 0) },
    terrainRevision: world.revision, terrainEqual: true, sharedClock: true, allyHealth: world.actors.slice(0, 2).map(a => a.hp),
    targetDamage: 1e9 - world.actors[2].hp, consumedActions: clients.map(c => authority.receipt(c.id).actionApplied) }, null, 2));
