import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim.ts';
import { DEFAULT_CONTENT, SKIRMISH_ENCOUNTER, MAX_ENEMIES } from '../src/content.ts';
import { captureDisplayFrame, validateDisplayFrame, ReplicaClient, ReplicationStream, serializePage, MAX_PACKET_BYTES } from '../src/replication.ts';
import { MotionPredictor, RemoteInterpolator } from '../src/client-motion.ts';

function setup() {
    const content = structuredClone(DEFAULT_CONTENT) as any;
    content.encounters[1].spawns = [{ enemyId: 'ruin-skirmisher', count: MAX_ENEMIES, x: 150, y: 100, altitude: 5 }];
    const w = new World(content, SKIRMISH_ENCOUNTER);
    w.cells.forEach(c => Object.assign(c, { kind: 0, hp: 0, max: 0, elevation: 0, depth: 0 }));
    Object.assign(w.actors[0], { x: 130, y: 100, z: 5 });
    Object.assign(w.actors[1], { x: 120, y: 110, z: 5 });
    w.actors.slice(2).forEach(a => { a.z = 5; });
    w.stepPlayers(new Map());
    const capture = () => captureDisplayFrame(w, Math.round(w.time * 60), { received: 0, applied: 0 });
    return { w, capture, stream: new ReplicationStream(w, 'roster', capture), client: new ReplicaClient('roster') };
}
function sync(stream: ReplicationStream, client: ReplicaClient) {
    for (let i = 0; i < 100; i++) {
        const page = stream.reply(client.request());
        assert.ok(Buffer.byteLength(serializePage(page)) <= MAX_PACKET_BYTES);
        if (client.apply(page) === 'committed') return;
    }
    assert.fail('bounded transfer did not finish');
}

test('maximum roster and all telegraphs survive bounded join, retry, recovery and movement adapters', () => {
    const { w, capture, stream, client } = setup();
    assert.equal(w.telegraphs.length, MAX_ENEMIES);
    const first = stream.reply(client.request()); client.apply(first);
    assert.equal(client.state, undefined); assert.deepEqual(stream.reply({ ...client.request(), ack: 0 }), first);
    sync(stream, client); assert.deepEqual(client.state!.actors, w.actors); assert.deepEqual(client.state!.telegraphs, w.telegraphs);
    const p = new MotionPredictor(0), remote = new RemoteInterpolator();
    p.setTerrain(client.cells); p.reconcile(client.state!, 0); remote.push(client.state!);
    assert.equal(p.actor!.id, 0); assert.equal(remote.sample(1).length, 8);
    for (let i = 0; i < 30; i++) w.stepPlayers(new Map());
    const live = capture(); validateDisplayFrame(live, client.state);
    client.reset(); sync(stream, client);
    assert.deepEqual(client.state!.actors, live.actors); assert.deepEqual(client.state!.telegraphs, live.telegraphs);
    assert.deepEqual(client.cells, w.cells);
});

test('invalid roster and warning data reject atomically at live and final snapshot boundaries', () => {
    const { capture, stream, client } = setup(); sync(stream, client);
    const before = structuredClone(client.state);
    const changes = [
        (f: any) => { f.actors.push({ ...f.actors[2], id: 8 }); },
        (f: any) => { f.actors[2].id = 8; },
        (f: any) => { f.actors[2].id = 1; },
        (f: any) => { f.actors[2].enemyId = 'bad id'; },
        (f: any) => { f.actors[2].cool[0] = NaN; },
        (f: any) => { f.telegraphs[0].owner = 0; },
        (f: any) => { f.telegraphs[0].targetId = 5; },
        (f: any) => { f.telegraphs[0].remaining = Infinity; },
        (f: any) => { f.telegraphs[0].aim.z = NaN; },
        (f: any) => { f.telegraphs[0].duration = .01; },
        (f: any) => { f.telegraphs[0].remaining = 6; },
        (f: any) => { f.telegraphs[0].kind = 'unknown'; },
        (f: any) => { f.telegraphs[1] = f.telegraphs[0]; },
        (f: any) => { f.telegraphs.push(f.telegraphs[0]); },
    ];
    const page = stream.reply(client.request());
    for (const change of changes) {
        const f = capture(); f.tick++; change(f);
        assert.throws(() => validateDisplayFrame(f, client.state), /Invalid state frame/);
        assert.throws(() => client.apply({ ...page, state: f }), /Invalid state frame/);
        assert.deepEqual(client.state, before);
    }
});

test('roster changes commit together and remote interpolation ignores an older snapshot roster', () => {
    const { w, capture, stream, client } = setup(); sync(stream, client);
    client.reset(); client.apply(stream.reply(client.request())); // Pin old roster.
    w.actors[2].hp = 0; w.enemyStates.delete(3); w.actors = w.actors.filter(a => a.id !== 3);
    w.stepPlayers(new Map());
    const live = capture(), remote = new RemoteInterpolator(); remote.push(live);
    sync(stream, client);
    remote.push(client.state!); // Old pinned state cannot replace newer actor history.
    assert.equal(remote.sample(live.tick).some(a => a.id === 3), false);
    sync(stream, client); // Next delta carries the new roster atomically.
    assert.equal(client.state!.actors.some(a => a.id === 3), false);
    assert.equal(client.state!.telegraphs.some(t => t.owner === 2 || t.owner === 3), false);
    assert.equal(client.state!.actors.find(a => a.id === 2)!.hp, 0);
});

test('sixty seconds at the maximum enemy count keeps attacks, warnings and live JSON bounded', () => {
    const { w, capture } = setup();
    w.actors.slice(0, 2).forEach(p => { p.hp = p.maxHp = 1e9; p.ward = 0; }); // Sustain the diagnostic only.
    let maxWarnings = 0, maxWaves = 0, maxBytes = 0;
    for (let i = 0; i < 3600; i++) {
        w.stepPlayers(new Map());
        if (i % 3 === 0) {
            const frame = capture(); validateDisplayFrame(frame);
            maxWarnings = Math.max(maxWarnings, frame.telegraphs.length);
            maxWaves = Math.max(maxWaves, frame.waves.length);
            maxBytes = Math.max(maxBytes, Buffer.byteLength(JSON.stringify(frame)));
        }
    }
    assert.equal(w.actors.length, 8); assert.ok(w.actors[0].hp < 1e9 || w.actors[1].hp < 1e9);
    assert.equal(maxWarnings, MAX_ENEMIES); assert.ok(maxWaves > 0 && maxWaves <= MAX_ENEMIES);
    assert.ok(maxBytes < MAX_PACKET_BYTES);
});
