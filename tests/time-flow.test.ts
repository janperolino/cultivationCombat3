import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, DT } from '../src/sim.ts';
import { dashProfile } from '../src/time-flow.ts';
const idle = { move: { x: 0, y: 0 }, aim: { x: 400, y: 300 } };
function arena(realm = 1) { const w = new World(); w.ai = false; w.cells.forEach(c => { c.elevation = 0; c.depth = 0; c.kind = 0; c.hp = 0; }); const a = w.actors[0], b = w.actors[1]; a.x = 100; a.y = 200; a.z = 10; a.realm = realm; b.x = 400; b.y = 300; b.z = 10; return w; }
test('higher realms get longer dodge windows and stronger scene dilation', () => { let previous = 0, scale = 1, speed = 30; for (let realm = 0; realm < 4; realm++) {
    const p = dashProfile(realm);
    assert.ok(p.duration > previous);
    assert.ok(p.worldScale < scale);
    assert.ok(p.speed > speed);
    const w = arena(realm), a = w.actors[0];
    w.dash(a, { x: 1, y: 0 });
    const x = a.x;
    for (let i = 0; i < Math.ceil(p.duration / DT); i++)
        w.step(idle);
    assert.ok(Math.abs(a.x - x - p.speed * p.duration) < .02);
    assert.ok(a.dashLeft < .00001);
    previous = p.duration;
    scale = p.worldScale; speed = p.speed;
} });
test('dodge changes direction throughout the window without losing flight speed', () => { const w = arena(), a = w.actors[0]; w.dash(a, { x: 1, y: 0 }); for (let i = 0; i < 10; i++)
    w.step({ ...idle, move: { x: 1, y: 0 } }); const x = a.x, y = a.y; for (let i = 0; i < 12; i++) {
    w.step({ ...idle, move: { x: 0, y: 1 } });
    assert.ok(Math.abs(Math.hypot(a.vx, a.vy) - dashProfile(a.realm).speed) < 1e-8);
} assert.ok(a.y - y > 4); assert.ok(a.x - x < 4); assert.ok(a.dashLeft > 0); assert.ok(a.vy > dashProfile(a.realm).speed - 1); });
test('the player keeps real time while the scene slows and then smoothly recovers', () => { const w = arena(), a = w.actors[0]; w.dash(a, { x: 1, y: 0 }); for (let i = 0; i < 30; i++)
    w.step(idle); assert.ok(Math.abs(w.time - .5) < 1e-8); assert.ok(w.sceneTime < .23); assert.ok(w.timeScale < .3); assert.ok(Math.abs(a.x - (100 + dashProfile(a.realm).speed * .5)) < .001); for (let i = 0; i < Math.ceil((dashProfile(a.realm).duration + 1.5) / DT); i++)
    w.step(idle); assert.equal(w.timeScale, 1); });
test('personal cooldown and qi clocks remain normal while enemy clocks slow', () => { const w = arena(), a = w.actors[0], b = w.actors[1]; w.dash(a, { x: 1, y: 0 }); a.cool[0] = 2; b.cool[0] = 2; a.qi = 0; b.qi = 0; for (let i = 0; i < 30; i++)
    w.step(idle); assert.ok(Math.abs(a.cool[0] - 1.5) < 1e-8); assert.ok(b.cool[0] > 1.75); assert.ok(Math.abs(a.qi - 5) < 1e-8); assert.ok(b.qi < 2.3); });
test('enemy movement and vertical pursuit slow during the dodge', () => { const normal = arena(), slow = arena(); normal.ai = slow.ai = true; normal.aiClock = slow.aiClock = 100; normal.actors[1].z = slow.actors[1].z = 30; slow.dash(slow.actors[0], { x: 1, y: 0 }); for (let i = 0; i < 30; i++) {
    normal.step(idle);
    slow.step(idle);
} assert.ok(normal.actors[1].x < slow.actors[1].x - 5); assert.ok(normal.actors[1].z < slow.actors[1].z - 2); });
test('bolts, crescents, and palm windups share the slowed scene clock', () => { const normal = arena(), slow = arena(); for (const w of [normal, slow]) {
    const a = w.actors[1];
    w.cast(a, 'bolt', { x: 200, y: 300 });
    w.cast(a, 'slash', { x: 500, y: 300 });
    w.cast(a, 'nova', { x: 320, y: 300 });
} const nb = normal.bolts[0], sb = slow.bolts[0], nw = normal.waves[0], sw = slow.waves[0], nc = normal.casts[0], sc = slow.casts[0]; slow.dash(slow.actors[0], { x: 1, y: 0 }); for (let i = 0; i < 18; i++) {
    normal.step(idle);
    slow.step(idle);
} assert.ok(sb.age < nb.age * .65); assert.ok(sb.life > nb.life); assert.ok(sw.remaining > nw.remaining); assert.ok(sc.left > nc.left + .1); });
test('finishing a dodge retains momentum and keeps ascent responsive', () => { const w = arena(0), a = w.actors[0]; w.dash(a, { x: 1, y: 0 }); for (let i = 0; i < Math.ceil(dashProfile(0).duration / DT); i++)
    w.step({ ...idle, climb: 1 }); assert.ok(a.z > 17); assert.ok(Math.hypot(a.vx, a.vy) > 29); const x = a.x; w.step(idle); assert.ok(a.x > x); assert.ok(Math.hypot(a.vx, a.vy) > 28); assert.ok(a.dashCool > 0); });
test('time dilation grants no invulnerability and cannot be refreshed while active', () => { const w = arena(), a = w.actors[0]; w.dash(a, { x: 1, y: 0 }); const left = a.dashLeft; a.dashCool = 0; assert.equal(w.dash(a, { x: 0, y: 1 }), false); assert.equal(a.dashLeft, left); w.damage(a, 100); assert.ok(a.hp < 500); a.hp = 0; w.step(idle); assert.equal(a.dashLeft, 0); for (let i = 0; i < 70; i++)
    w.step(idle); assert.equal(w.timeScale, 1); });


