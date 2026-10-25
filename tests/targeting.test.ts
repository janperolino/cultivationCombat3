import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, GRID, DT } from '../src/sim.ts';
import { cursorTarget, targetInRange, steerVelocity, LOCK_RANGE } from '../src/targeting.ts';
const idle = { move: { x: 0, y: 0 }, aim: { x: 272, y: 256 } };
function arena() { const w = new World(); w.ai = false; w.cells.forEach(c => { c.elevation = 0; c.depth = 0; c.hp = 0; c.kind = 0; }); w.actors.forEach(a => { a.z = 1; a.vz = 0; }); w.actors[1].x = 272; return w; }
test('generous cursor assist works near either the visible target or its shadow', () => { const w = arena(), a = w.actors[0], b = w.actors[1]; b.z = 35; const candidates = [{ actor: b, screen: { x: 400, y: 200 }, ground: { x: 400, y: 410 } }]; assert.equal(cursorTarget(a, { x: 455, y: 215 }, candidates)?.id, b.id); assert.equal(cursorTarget(a, { x: 460, y: 405 }, candidates)?.id, b.id); assert.equal(cursorTarget(a, { x: 500, y: 200 }, candidates), undefined); b.hp = 0; assert.equal(cursorTarget(a, { x: 400, y: 200 }, candidates), undefined); });
test('soft lock range is wider than cursor acquisition and excludes dead targets', () => { const w = arena(), a = w.actors[0], b = w.actors[1]; b.x = a.x + 200; assert.equal(cursorTarget(a, { x: 400, y: 200 }, [{ actor: b, screen: { x: 400, y: 200 }, ground: { x: 400, y: 200 } }]), undefined); assert.equal(targetInRange(a, b, LOCK_RANGE), true); b.x = a.x + 221; assert.equal(targetInRange(a, b, LOCK_RANGE), false); b.x = a.x + 40; b.hp = 0; assert.equal(targetInRange(a, b, LOCK_RANGE), false); });
test('3D steering respects its turning limit and preserves projectile speed', () => { const rate = 2.8, v = steerVelocity({ x: 95, y: 0, z: 0 }, { x: 0, y: 1, z: 1 }, 95, rate, DT); assert.ok(Math.abs(Math.hypot(v.x, v.y, v.z) - 95) < 1e-8); assert.ok(Math.acos(v.x / 95) <= rate * DT + 1e-8); assert.ok(v.z > 0); const reverse = steerVelocity({ x: 0, y: 0, z: 95 }, { x: 0, y: 0, z: -1 }, 95, rate, DT); assert.ok(Object.values(reverse).every(Number.isFinite)); });
test('assisted volleys hit an aerial rival without matching the caster altitude', () => {
    const w = arena(), a = w.actors[0], b = w.actors[1];
    b.z = 22;
    w.cast(a, 'bolt', { x: b.x, y: b.y, z: b.z + .7, targetId: b.id, locked: true });
    for (let i = 0; i < 100; i++)
        w.step(idle);
    assert.ok(b.hp < 500);
    assert.equal(a.z, 1);
});
test('guidance follows a moving aerial target with bounded turning', () => {
    const w = arena(), a = w.actors[0], b = w.actors[1];
    b.z = 18;
    w.cast(a, 'bolt', { x: b.x, y: b.y, z: b.z + .7, targetId: b.id });
    for (let i = 0; i < 110; i++) {
        b.y = 256 + 8 * Math.sin(w.time * .8);
        b.z = 18 + 4 * Math.sin(w.time * .8);
        b.vy = 6.4 * Math.cos(w.time * .8);
        b.vz = 3.2 * Math.cos(w.time * .8);
        w.step(idle);
    }
    assert.ok(b.hp < 500);
});
test('guided shots still collide with an intervening ridge', () => {
    const w = arena(), a = w.actors[0], b = w.actors[1];
    for (let y = 0; y < GRID; y++)
        w.cells[y * GRID + 60].elevation = 18;
    w.cast(a, 'bolt', { x: b.x, y: b.y, z: b.z + .7, targetId: b.id, locked: true });
    for (let i = 0; i < 110; i++)
        w.step(idle);
    assert.equal(b.hp, 500);
    assert.equal(w.bolts.length, 0);
});
test('tracking drops a dead or out-of-range target and projectiles still expire', () => {
    const w = arena(), a = w.actors[0], b = w.actors[1];
    b.z = 20;
    w.cast(a, 'bolt', { x: b.x, y: b.y, z: b.z + .7, targetId: b.id, locked: true });
    for (let i = 0; i < 22; i++)
        w.step(idle);
    b.hp = 0;
    for (let i = 0; i < 30; i++)
        w.step(idle);
    assert.ok(w.bolts.every(p => p.targetId === undefined));
    for (let i = 0; i < 180; i++)
        w.step(idle);
    assert.equal(w.bolts.length, 0);
});
test('an assisted crescent climbs toward target height but keeps a committed trajectory', () => {
    const w = arena(), a = w.actors[0], b = w.actors[1];
    b.z = 22;
    w.cast(a, 'slash', { x: b.x, y: b.y, z: b.z + .7, targetId: b.id });
    assert.ok(w.waves[0].vz > 0);
    for (let i = 0; i < 45; i++)
        w.step(idle);
    assert.ok(b.hp < 500);
    assert.equal(a.z, 1);
});
test('assisted palms begin above high targets and commit to the aimed position', () => {
    const w = arena(), a = w.actors[0], b = w.actors[1];
    b.z = 60;
    w.cast(a, 'nova', { x: b.x, y: b.y, z: b.z + .7, targetId: b.id });
    const cast = w.casts[0];
    assert.ok(cast.startZ > b.z + 20);
    const x = cast.x;
    for (let i = 0; i < 60; i++)
        w.step(idle);
    assert.ok(b.hp < 500);
    assert.equal(cast.x, x);
});
test('steep assisted crescents keep the same total speed and bounded lifetime', () => { const w = arena(), a = w.actors[0], b = w.actors[1]; b.x = a.x + 8; b.z = 48; w.cast(a, 'slash', { x: b.x, y: b.y, z: b.z + .7, targetId: b.id }); const wave = w.waves[0]; assert.ok(Math.abs(Math.hypot(wave.speed, wave.vz) - 120) < 1e-8); for (let i = 0; i < 60; i++)
    w.step(idle); assert.equal(w.waves.length, 0); });
test('lock guidance is dropped beyond retention range', () => { const w = arena(), a = w.actors[0], b = w.actors[1]; b.z = 20; w.cast(a, 'bolt', { x: b.x, y: b.y, z: b.z + .7, targetId: b.id, locked: true }); for (let i = 0; i < 22; i++)
    w.step(idle); b.x = 510; for (let i = 0; i < 20; i++)
    w.step(idle); assert.ok(w.bolts.every(p => p.targetId === undefined)); });
