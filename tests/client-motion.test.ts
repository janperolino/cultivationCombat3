import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, DT, GRID } from '../src/sim.ts';
import { MotionPredictor, RemoteInterpolator, HISTORY_LIMIT, PREDICTION_HORIZON } from '../src/client-motion.ts';
import { captureDisplayFrame } from '../src/replication.ts';
import { NetworkLab } from '../src/network-lab.ts';
import type { ActorInput } from '../src/sim.ts';

const idle: ActorInput = { move: { x: 0, y: 0 }, aim: { x: 300, y: 100 } };
function setup() {
    const w = new World();
    w.cells.forEach(c => { c.kind = 0; c.hp = 0; c.max = 0; c.depth = 0; c.elevation = 0; });
    Object.assign(w.actors[0], { x: 100, y: 100, z: 10 });
    Object.assign(w.actors[1], { x: 400, y: 400, z: 10 });
    const p = new MotionPredictor(0); p.setTerrain(w.cells);
    p.reconcile(captureDisplayFrame(w, 0, { received: 0, applied: 0 }), 0);
    return { w, p };
}
test('prediction is immediate and never casts, grants resources, damages actors, or mutates terrain', () => {
    const { w, p } = setup(), before = JSON.stringify(w);
    p.advance({ ...idle, move: { x: 1, y: 0 }, climb: 1, fire: 'nova', dash: true });
    assert.ok(p.actor!.x > 100); assert.ok(p.actor!.z > 10);
    assert.equal(p.actor!.qi, 100); assert.equal(p.actor!.hp, 500); assert.equal(p.actor!.dashLeft, 0);
    assert.equal(JSON.stringify(w), before);
});
test('reconciliation replays only samples after capture and matches shared collision-safe movement', () => {
    const { w, p } = setup();
    const input = { ...idle, move: { x: 1, y: 0 }, climb: 1 };
    let frame = captureDisplayFrame(w, 0, { received: 0, applied: 0 });
    for (let t = 1; t <= 12; t++) {
        p.advance(input); w.stepPlayers(new Map([[0, input], [1, idle]]));
        if (t === 6) frame = captureDisplayFrame(w, 6, { received: 3, applied: 3 });
    }
    p.reconcile(frame, 6);
    for (const key of ['x', 'y', 'z', 'vx', 'vy', 'vz'] as const) assert.ok(Math.abs(p.actor![key] - w.actors[0][key]) < 1e-9, key);
});
test('prediction shares terrain collision and actor blocking with the authority', () => {
    const { w, p } = setup();
    Object.assign(w.actors[0], { z: 1 });
    Object.assign(w.cells[25 * GRID + 26], { kind: 2, hp: 200, max: 200 });
    p.reconcile(captureDisplayFrame(w, 1, { received: 0, applied: 0 }), 0);
    const move = { ...idle, move: { x: 1, y: 0 } };
    for (let t = 1; t <= 120; t++) {
        p.advance(move); w.stepPlayers(new Map([[0, move], [1, idle]]));
        if (t % 6 === 0) p.reconcile(captureDisplayFrame(w, t + 1, { received: t, applied: t }), p.tick);
    }
    assert.ok(p.actor!.x < 104); assert.equal(p.actor!.x, w.actors[0].x);
});
test('prediction freezes on missing live state, bounds retained work, and falls back when history is too old', () => {
    const { w, p } = setup();
    p.advance({ ...idle, move: { x: 1, y: 0 } }, false); // Browser wall-clock stall also gates extrapolation.
    assert.equal(p.actor!.x, 100);
    for (let t = 0; t < PREDICTION_HORIZON; t++) p.advance({ ...idle, move: { x: 1, y: 0 } });
    const x = p.actor!.x;
    for (let t = 0; t < 500; t++) { p.advance({ ...idle, move: { x: 1, y: 0 } }); p.noteCommand(t + 1); }
    assert.equal(p.actor!.x, x); assert.equal(p.historySize, HISTORY_LIMIT); assert.equal(p.pendingCount, 64);
    p.reconcile(captureDisplayFrame(w, 2, { received: 500, applied: 500 }), 0);
    assert.equal(p.actor!.x, w.actors[0].x); assert.equal(p.pendingCount, 0);
});
test('death and server correction replace prediction; stale frames cannot roll back receipts or actors', () => {
    const { w, p } = setup(); p.advance({ ...idle, move: { x: 1, y: 0 } });
    w.actors[0].hp = 0;
    const dead = captureDisplayFrame(w, 2, { received: 2, applied: 2 });
    p.reconcile(dead, p.tick); p.advance({ ...idle, move: { x: 1, y: 0 } });
    assert.equal(p.actor!.x, 100); assert.equal(p.actor!.hp, 0);
    assert.equal(p.reconcile(captureDisplayFrame(new World(), 1, { received: 0, applied: 0 }), 0), false);
    assert.equal(p.actor!.hp, 0); assert.ok(p.maxCorrection > 0);
});
test('remote interpolation buffers ordered samples, takes the shortest angle, and never extrapolates', () => {
    const { w } = setup(), r = new RemoteInterpolator();
    w.actors[1].x = 100; w.actors[1].aim = Math.PI - .1;
    r.push(captureDisplayFrame(w, 10, { received: 0, applied: 0 }));
    w.actors[1].x = 200; w.actors[1].aim = -Math.PI + .1;
    r.push(captureDisplayFrame(w, 20, { received: 0, applied: 0 }));
    const middle = r.sample(24)[1]; // 150 ms buffer: target tick 15.
    assert.equal(middle.x, 150); assert.ok(Math.abs(middle.aim - Math.PI) < 1e-9);
    assert.equal(r.sample(0)[1].x, 100); assert.equal(r.sample(1000)[1].x, 200);
    r.push(captureDisplayFrame(w, 1, { received: 0, applied: 0 })); assert.equal(r.size, 2);
    for (let t = 21; t < 100; t++) r.push(captureDisplayFrame(w, t, { received: 0, applied: 0 }));
    assert.equal(r.size, 32);
});
test('network profiles are seeded, bounded, and independently impair both message directions', () => {
    const a = new NetworkLab('harsh', 123), b = new NetworkLab('harsh', 123);
    let dropped = 0;
    for (let i = 0; i < 10000; i++) {
        const sample = a.next(); assert.deepEqual(sample, b.next());
        assert.ok(sample.up >= 50 && sample.up <= 100 && sample.down >= 50 && sample.down <= 100);
        if (sample.dropRequest || sample.dropResponse) dropped++;
    }
    assert.ok(dropped > 400 && dropped < 800);
    const local = new NetworkLab().next(); assert.equal(local.up + local.down, 0);
    assert.equal(local.dropRequest || local.dropResponse, false);
});

test('measured motion buffering delays a reversal while preserving resources and collision authority', () => {
    const { w, p } = setup();
    const idleFrame = captureDisplayFrame(w, 1, { received: 0, applied: 0 });
    p.reconcile(idleFrame, p.tick, 4);
    assert.equal(p.bufferTicks, 4);
    for (let i = 0; i < 4; i++) p.advance({ ...idle, move: { x: 1, y: 0 }, fire: 'nova', dash: true });
    assert.equal(p.actor!.x, 100);
    p.advance({ ...idle, move: { x: 1, y: 0 } });
    assert.ok(p.actor!.x > 100); assert.equal(p.actor!.qi, 100); assert.equal(p.actor!.dashLeft, 0);
    p.reconcile(captureDisplayFrame(w, 2, { received: 0, applied: 0 }), p.tick, 100);
    assert.equal(p.bufferTicks, 8);
});
