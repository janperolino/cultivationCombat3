import { dashProfile } from '../src/time-flow.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, DT, CELL, GRID, power } from '../src/sim.ts';
const input = { move: { x: 0, y: 0 }, aim: { x: 280, y: 256 } };
function clear() { const w = new World(); w.ai = false; w.cells.forEach(c => { c.hp = 0; c.kind = 0; c.elevation = 0; c.depth = 0; }); w.actors.forEach(a => { a.z = 1; a.vz = 0; }); return w; }
test('fixed simulation is reproducible', () => {
    const a = new World(), b = new World();
    for (let i = 0; i < 600; i++) {
        a.step(input);
        b.step(input);
    }
    assert.deepEqual(a, b);
});
test('projectile cannot tunnel through cover; shield and health take real damage', () => {
    const w = clear();
    w.actors[0].x = 230;
    w.actors[1].x = 242;
    const c = w.cells[64 * GRID + 59];
    Object.assign(c, { kind: 2, hp: 200, max: 200 });
    // A fan can legitimately go around one cell, so use a wall to verify interception.
    for (let y = 60; y <= 68; y++)
        Object.assign(w.cells[y * GRID + 59], { kind: 2, hp: 200, max: 200 });
    w.cast(w.actors[0], 'bolt', w.actors[1]);
    for (let i = 0; i < 60; i++)
        w.step(input);
    assert.equal(w.actors[1].hp, 500);
    assert.ok(c.hp < 200);
    assert.equal(w.bolts.length, 0);
    w.cells.forEach(c => c.hp = 0);
    w.actors[0].cool[0] = 0;
    w.cast(w.actors[0], 'bolt', w.actors[1]);
    for (let i = 0; i < 60; i++)
        w.step(input);
    assert.ok(w.actors[1].hp < 500);
    assert.ok(w.actors[1].ward < 100);
});
test('movement cannot cross a solid cell or a living actor', () => {
    const w = clear();
    const a = w.actors[0];
    a.x = 234;
    a.y = 258;
    Object.assign(w.cells[64 * GRID + 59], { kind: 2, hp: 200, max: 200 });
    for (let i = 0; i < 120; i++)
        w.move(a, 1, 0, DT);
    assert.ok(a.x <= 235.26);
    w.cells.forEach(c => c.hp = 0);
    a.x = 278;
    a.y = 256;
    for (let i = 0; i < 120; i++)
        w.move(a, 1, 0, DT);
    assert.ok(a.x <= 278.51);
});
test('travelling slash is directional, costs qi, and obeys cooldown', () => {
    const w = clear(), a = w.actors[0], b = w.actors[1];
    b.x = a.x + 20;
    assert.equal(w.cast(a, 'slash', { x: a.x - 40, y: a.y }), true);
    assert.equal(w.cast(a, 'slash', b), false);
    assert.equal(a.qi, 84);
    for (let i = 0; i < 40; i++)
        w.step(input);
    assert.equal(b.hp, 500);
    a.cool[1] = 0;
    w.cast(a, 'slash', b);
    assert.equal(b.hp, 500);
    for (let i = 0; i < 60; i++)
        w.step(input);
    assert.ok(b.hp < 500);
    const hp = b.hp;
    for (let i = 0; i < 40; i++)
        w.step(input);
    assert.equal(b.hp, hp);
});
test('realm gaps amplify offense and defense', () => { assert.equal(power(3) / power(0), 27); const low = clear(), high = clear(); high.actors[1].realm = 3; low.actors[1].realm = 0; low.damage(low.actors[1], 500); high.damage(high.actors[1], 500); assert.ok(high.actors[1].hp > low.actors[1].hp); });
test('area attack has a windup, damages enemies and deforms ground', () => {
    const w = clear(), a = w.actors[0], b = w.actors[1];
    w.cast(a, 'nova', b);
    for (let i = 0; i < 30; i++)
        w.step(input);
    assert.equal(b.hp, 500);
    for (let i = 0; i < 15; i++)
        w.step(input);
    assert.ok(b.hp < 500);
    assert.equal(a.hp, 500);
    assert.ok(w.cells.some(c => c.depth > 0));
});
test('durability accumulates damage and terrain survives save/load', () => { const w = new World(); const index = w.cells.findIndex(c => c.kind === 2), c = w.cells[index], p = { x: index % GRID * CELL + 2, y: Math.floor(index / GRID) * CELL + 2 }; w.terrain(p, 3, 80); assert.equal(c.hp, 120); w.terrain(p, 3, 150); assert.equal(c.hp, 0); assert.equal(c.kind, 0); assert.ok(c.depth > 0); const clone = new World(); clone.loadTerrain(w.saveTerrain()); assert.deepEqual(clone.cells, w.cells); assert.equal(clone.destroyed, w.destroyed); assert.throws(() => clone.loadTerrain('{"version":99}')); });
test('dead actors cannot attack and qi limits attacks', () => { const w = clear(), a = w.actors[0]; a.qi = 0; assert.equal(w.cast(a, 'nova', input.aim), false); a.qi = 100; a.hp = 0; assert.equal(w.cast(a, 'bolt', input.aim), false); assert.throws(() => w.step(input, 1)); });
test('highest realm overwhelms the combat frame with a real 160m blast', () => {
    const w = new World();
    w.ai = false;
    const a = w.actors[0];
    a.realm = 3;
    w.cast(a, 'nova', { x: a.x + 500, y: a.y });
    const c = w.casts[0];
    assert.equal(c.radius, 80);
    assert.equal(c.x - a.x, 120);
    // The destructive footprint is simulation state, not just a renderer effect.
    for (let i = 0; i < 45; i++)
        w.step(input);
    assert.ok(w.destroyed > 150);
    assert.ok(w.cells.some(cell => cell.depth > 10));
});
test('realm scaling changes physical attack reach and blast footprint', () => {
    const low = clear(), high = clear();
    low.actors[0].realm = 0;
    high.actors[0].realm = 3;
    low.cast(low.actors[0], 'nova', low.actors[1]);
    high.cast(high.actors[0], 'nova', high.actors[1]);
    assert.equal(high.casts[0].radius / low.casts[0].radius, 8);
    const a = high.actors[0];
    high.cast(a, 'slash', { x: a.x + 40, y: a.y });
    assert.ok(high.effects.find(e => e.kind === 'slash')!.radius > 30);
});
test('realm-scaled dodge costs qi, preserves its tuned speed, and cannot be spammed', () => {
    const w = clear(), a = w.actors[0];
    w.actors[1].x = 450;
    const x = a.x;
    assert.equal(w.dash(a, { x: 1, y: 0 }), true);
    assert.equal(a.qi, 90);
    assert.equal(w.dash(a, { x: 1, y: 0 }), false);
    const profile = dashProfile(a.realm);
    for (let i = 0; i < Math.ceil(profile.duration / DT); i++)
        w.step(input);
    assert.ok(Math.abs((a.x - x) - profile.duration * profile.speed) < .02);
    assert.equal(a.dashLeft, 0);
    assert.ok(a.dashCool > 0);
    a.dashCool = 0;
    a.qi = 9;
    assert.equal(w.dash(a, { x: 1, y: 0 }), false);
    a.qi = 100;
    a.hp = 0;
    assert.equal(w.dash(a, { x: 1, y: 0 }), false);
});
test('dash substeps stop at cover, actors, and world edges', () => {
    const w = clear(), a = w.actors[0];
    a.x = 234;
    a.y = 258;
    Object.assign(w.cells[64 * GRID + 59], { kind: 2, hp: 200, max: 200 });
    w.dash(a, { x: 1, y: 0 });
    for (let i = 0; i < 10; i++)
        w.step(input);
    assert.ok(a.x <= 235.26);
    w.cells.forEach(c => c.hp = 0);
    a.x = 278;
    a.y = 256;
    a.dashCool = 0;
    w.dash(a, { x: 1, y: 0 });
    for (let i = 0; i < 10; i++)
        w.step(input);
    assert.ok(a.x < 278.51);
    a.x = 510;
    a.y = 100;
    a.dashCool = 0;
    w.dash(a, { x: 1, y: 0 });
    for (let i = 0; i < 10; i++)
        w.step(input);
    assert.ok(a.x <= 511.25);
});
test('faster flight retains momentum, steers smoothly, and caps diagonal speed', () => {
    const w = clear(), a = w.actors[0];
    w.actors[1].x = 450;
    w.actors[1].y = 450;
    for (let i = 0; i < 40; i++)
        w.step({ ...input, move: { x: 1, y: 0 } });
    assert.ok(a.vx > 29 && a.vx <= 30);
    const x = a.x;
    for (let i = 0; i < 12; i++)
        w.step(input);
    assert.ok(a.x > x + 4);
    assert.ok(a.vx > 15 && a.vx < 20);
    w.step({ ...input, move: { x: 0, y: 1 } });
    assert.ok(a.vx > 0 && a.vy > 0);
    for (let i = 0; i < 50; i++)
        w.step({ ...input, move: { x: 1, y: 1 } });
    assert.ok(Math.hypot(a.vx, a.vy) <= 30.001);
    for (let i = 0; i < 180; i++)
        w.step(input);
    assert.equal(a.vx, 0);
    assert.equal(a.vy, 0);
});
test('sword crescent reaches beyond melee and cuts a persistent terrain corridor', () => {
    const w = clear(), a = w.actors[0], b = w.actors[1];
    a.realm = 1;
    b.x = a.x + 45;
    const c = w.cells[64 * GRID + 67];
    Object.assign(c, { kind: 1, hp: 55, max: 55 });
    w.cast(a, 'slash', b);
    for (let i = 0; i < 40; i++)
        w.step(input);
    assert.ok(b.hp < 500);
    assert.equal(c.hp, 0);
    assert.ok(c.depth > 0);
    assert.equal(w.waves.length, 0);
});
test('palm strike preserves the launch direction and source through impact', () => {
    const w = clear(), a = w.actors[0];
    const target = { x: a.x - 25, y: a.y + 25 };
    w.cast(a, 'nova', target);
    const c = w.casts[0];
    assert.equal(c.sourceX, a.x);
    assert.equal(c.sourceY, a.y);
    assert.ok(Math.abs(c.angle - 3 * Math.PI / 4) < .001);
    // Moving the caster after release must not rotate or redirect a committed palm.
    a.x += 10;
    for (let i = 0; i < 45; i++)
        w.step(input);
    const impact = w.effects.find(e => e.kind === 'nova')!;
    assert.ok(impact);
    assert.equal(impact.angle, c.angle);
    assert.equal(impact.x, target.x);
    assert.equal(impact.y, target.y);
});
test('terrain mutation stamps isolate small impacts and refresh loaded saves', () => {
    const w = clear(), before = w.revision;
    w.terrain({ x: 234, y: 258 }, 4, 50);
    const changed = Array.from(w.cellVersions).filter(v => v > before).length;
    assert.ok(changed > 0 && changed < 10);
    const last = w.revision;
    Object.assign(w.cells[64 * GRID + 59], { kind: 1, hp: 55, max: 55 });
    w.cast(w.actors[0], 'slash', { x: 300, y: 256 });
    for (let i = 0; i < 5; i++)
        w.step(input);
    assert.ok(Array.from(w.cellVersions).some(v => v > last));
    const loaded = clear();
    loaded.loadTerrain(w.saveTerrain());
    assert.ok(Array.from(loaded.cellVersions).every(v => v === loaded.revision));
});
test('volleys launch in irregular order and timing with bounded aiming error', () => {
    const w = clear(), a = w.actors[0];
    w.actors[1].x = 450;
    w.actors[1].y = 450;
    const target = { x: a.x + 60, y: a.y };
    w.cast(a, 'bolt', target);
    assert.equal(w.bolts.length, 5);
    assert.equal(a.qi, 91);
    assert.equal(a.cool[0], .95);
    const bolts = [...w.bolts], delays = bolts.map(b => b.delay);
    assert.equal(delays[0], 0);
    assert.ok(delays[4] > .18 && delays[4] < .45);
    assert.ok(new Set(delays.slice(1).map((v, i) => (v - delays[i]).toFixed(4))).size > 1);
    assert.ok(bolts.every(b => Math.hypot(b.targetX - target.x, b.targetY - target.y) <= 3.1));
    assert.ok(new Set(bolts.map(b => b.targetY)).size > 1);
    w.step(input);
    assert.equal(bolts.filter(b => b.launched).length, 1);
    assert.equal(w.cast(a, 'bolt', target), false);
    for (let i = 0; i < 40; i++)
        w.step(input);
    assert.ok(bolts.every(b => b.launched));
    for (let i = 0; i < 180; i++)
        w.step(input);
    assert.equal(w.bolts.length, 0);
    a.cool[0] = 0;
    w.cast(a, 'bolt', target);
    assert.notDeepEqual(w.bolts.map(b => b.delay), delays);
});
test('irregular volleys keep a shared damage budget and release from the moving caster', () => {
    const w = clear(), a = w.actors[0];
    w.actors[1].x = 450;
    w.actors[1].y = 450;
    w.cast(a, 'bolt', { x: a.x + 60, y: a.y });
    const bolts = [...w.bolts];
    assert.equal(bolts.reduce((sum, b) => sum + b.damageScale, 0), 1);
    for (let i = 0; i < 30; i++)
        w.step({ ...input, move: { x: 1, y: 0 } });
    assert.ok(bolts[4].startX > bolts[0].startX + 2);
});
test('death cancels bolts still awaiting release', () => {
    const w = clear(), a = w.actors[0];
    w.cast(a, 'bolt', { x: a.x + 60, y: a.y });
    w.step(input);
    a.hp = 0;
    for (let i = 0; i < 40; i++)
        w.step(input);
    assert.ok(w.bolts.every(b => b.launched));
});

