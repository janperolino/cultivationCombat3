import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, CELL } from '../src/sim.ts';
import { StudyCamera } from '../src/study-camera.ts';
import { StudyState } from '../src/study-state.ts';
import { TechniqueVisuals } from '../src/technique-visuals.ts';
import { actorPalette } from '../src/study-scene.ts';
import { project } from '../src/projection.ts';
import { captureDisplayFrame, validateDisplayFrame, ReplicaClient, ReplicationStream, MAX_VISUAL_EFFECTS, serializePage } from '../src/replication.ts';

test('study camera drawing and ground picking agree across zoom, altitude, shake and sloping terrain', () => {
    const w = new World(), camera = new StudyCamera();
    for (const zoom of [2.5, 6, 14]) {
        camera.zoom = camera.targetZoom = zoom; camera.width = 1270; camera.height = 720; camera.shake = { x: 7, y: -4 };
        camera.follow({ ...w.actors[0], z: 35 }, 1 / 60, true);
        for (const p of [{ x: 232, y: 256 }, { x: 277, y: 250 }, { x: 218, y: 294 }]) {
            const z = w.groundHeight(p.x, p.y), screen = camera.screen(p, z), ground = camera.ground(screen, w.groundHeight.bind(w));
            assert.ok(Math.hypot(ground.x - p.x, ground.y - p.y) < .001); assert.ok(Math.abs(ground.z! - z) < .001);
        }
    }
});

test('projected movement remains screen-relative and stays inside authority input bounds', () => {
    const camera = new StudyCamera();
    for (const [x, y] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [0, 0]]) {
        const move = camera.movement(x, y), screen = project(move, true);
        assert.ok(Math.abs(move.x) <= 1 && Math.abs(move.y) <= 1 && Math.hypot(move.x, move.y) <= 1.0000001);
        assert.ok(Math.abs(screen.x * y - screen.y * x) < 1e-9);
        assert.ok(screen.x * x + screen.y * y >= 0);
    }
});

test('display adapter isolates actors/attacks/effects and never steps or casts a local world', () => {
    const host = new World(); host.ai = false;
    host.cast(host.actors[0], 'bolt', host.actors[1]); host.cast(host.actors[0], 'nova', host.actors[1]);
    host.effect('impact', host.actors[1], 4, .5);
    const frame = captureDisplayFrame(host, 1, { received: 0, applied: 0 }), before = structuredClone(frame);
    const terrain = new World(); terrain.step = () => { throw Error('display must not step'); }; terrain.cast = () => { throw Error('display must not cast'); };
    const state = new StudyState(terrain); state.receive(frame, frame.actors, structuredClone(host.cells), 0);
    state.scene.actors[0].x = 900; state.scene.actors[0].cool[0] = 900;
    state.scene.bolts[0].x = 900; state.scene.casts[0].left = 900; state.scene.effects[0].life = 900;
    assert.deepEqual(frame, before); assert.equal(host.actors[0].x, 232); assert.equal(host.time, 0); assert.equal(terrain.time, 0);
});

test('visual events deduplicate across frames, do not replay a join/recovery, and retain stable object identity', () => {
    const w = new World(), state = new StudyState(new World());
    w.effect('impact', w.actors[0], 3, .5);
    let frame = captureDisplayFrame(w, 1, { received: 0, applied: 0 });
    assert.deepEqual(state.receive(frame, frame.actors, w.cells, 0), []);
    const same = state.scene.effects[0]; w.effects[0].life = .4;
    frame = captureDisplayFrame(w, 2, { received: 0, applied: 0 });
    assert.deepEqual(state.receive(frame, frame.actors, w.cells, 0), []); assert.equal(state.scene.effects[0], same); assert.equal(same.life, .4);
    w.effect('nova', w.actors[1], 20, 1.8); frame = captureDisplayFrame(w, 3, { received: 0, applied: 0 });
    assert.equal(state.receive(frame, frame.actors, w.cells, 0)!.length, 1);
    assert.equal(state.receive(frame, frame.actors, w.cells, 0), undefined, 'same tick cannot replay events');
    state.clear(); assert.deepEqual(state.receive(frame, frame.actors, w.cells, 0), []);
});

test('replicated terrain stamps dirty changed cells without rebaking unchanged delta pages', () => {
    const w = new World(), state = new StudyState(new World()), frame = captureDisplayFrame(w, 1, { received: 0, applied: 0 });
    const cells = structuredClone(w.cells); state.receive(frame, frame.actors, cells, 0); assert.equal(state.terrainReset, true);
    state.receive(frame, frame.actors, cells.slice(), 0); assert.equal(state.terrainReset, false);
    const next = cells.slice(), index = 64 * 128 + 60; next[index] = { ...next[index], depth: 2 };
    state.receive({ ...frame, tick: 2 }, frame.actors, next, 1);
    assert.equal(state.scene.cellVersions[index], 1); assert.equal(state.scene.cellVersions[index + 1], 0);
    assert.equal(state.terrainReset, false); assert.equal(state.scene.groundHeight(index % 128 * CELL + 2, Math.floor(index / 128) * CELL + 2), next[index].elevation - 2);
    const sameRevision = next.slice(); sameRevision[index] = { ...sameRevision[index], depth: 3 };
    state.receive({ ...frame, tick: 3 }, frame.actors, sameRevision, 1); assert.equal(state.terrainReset, true);
});

test('original trail renderer supports the bounded encounter roster and drops removed actors', () => {
    const w = new World(), visuals = new TechniqueVisuals();
    for (let id = 2; id < 8; id++) w.actors.push(w.actor(id, 250 + id * 3, 260));
    for (let i = 0; i < 180; i++) { w.time += 1 / 60; w.actors.forEach(a => { a.x += .2; }); visuals.sample(w); }
    assert.equal(visuals.trackedActors, 8); assert.ok(visuals.trailPoints <= 8 * 40);
    w.actors = w.actors.slice(0, 2); visuals.sample(w); assert.equal(visuals.trackedActors, 2);
    visuals.clear(); assert.equal(visuals.trackedActors, 0);
    assert.notEqual(actorPalette({ id: 2, enemyId: 'ruin-skirmisher' }).glow, actorPalette({ id: 1 }).glow);
});

test('visual replication is bounded, retains needed presentation fields and rejects malformed frames atomically', () => {
    const w = new World(); w.cast(w.actors[0], 'bolt', w.actors[1]); w.cast(w.actors[0], 'nova', w.actors[1]);
    for (let i = 0; i < MAX_VISUAL_EFFECTS + 20; i++) w.effect('impact', w.actors[0], 3, .5);
    const frame = captureDisplayFrame(w, 1, { received: 0, applied: 0 }); validateDisplayFrame(frame);
    assert.equal(frame.effects.length, MAX_VISUAL_EFFECTS); assert.ok(frame.effects[0].visualId > 1);
    assert.equal(frame.bolts[0].vx, w.bolts[0].vx); assert.equal(frame.casts[0].sourceX, w.casts[0].sourceX);
    assert.equal('hp' in frame.effects[0], false, 'visual events must not copy arbitrary actor fields');
    const client = new ReplicaClient('study'), stream = new ReplicationStream(w, 'study', () => frame);
    for (let i = 0; i < 100; i++) { const page = stream.reply(client.request()); assert.ok(Buffer.byteLength(serializePage(page)) <= 65536); if (client.apply(page) === 'committed') break; }
    const before = structuredClone(client.state), next = stream.reply(client.request());
    for (const change of [
        (f: any) => { f.bolts[0].vx = Infinity; }, (f: any) => { f.bolts[0].power = -1; },
        (f: any) => { f.casts[0].angle = NaN; }, (f: any) => { delete f.casts[0].sourceY; },
        (f: any) => { f.effects.push(f.effects[0]); }, (f: any) => { f.effects[1].visualId = f.effects[0].visualId; },
        (f: any) => { f.effects[0].kind = 'bad'; }, (f: any) => { f.effects[0].life = Infinity; },
        (f: any) => { f.effects[0].maxLife = 0; }, (f: any) => { f.effects[0].text = 'x'.repeat(41); },
    ]) {
        const bad = structuredClone(frame); change(bad);
        assert.throws(() => client.apply({ ...next, state: bad }), /Invalid state frame/); assert.deepEqual(client.state, before);
    }
});
