import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, GRID, DT, landscapeHeight } from '../src/sim.ts';
import { pickSurface, project, lift } from '../src/projection.ts';
const idle = { move: { x: 0, y: 0 }, aim: { x: 300, y: 256 } };
function flat() { const w = new World(); w.ai = false; w.cells.forEach(c => { c.elevation = 0; c.depth = 0; c.kind = 0; c.hp = 0; }); w.actors.forEach(a => { a.z = 1; a.vz = 0; }); return w; }
test('landscape has a genuine ridge and valley', () => { const w = new World(); assert.ok(w.groundHeight(280, 250) > 10); assert.ok(w.groundHeight(218, 294) < -3); });
test('climbing changes absolute altitude and descending stops at the floor', () => {
    const w = flat(), a = w.actors[0];
    for (let i = 0; i < 120; i++)
        w.step({ ...idle, climb: 1 });
    assert.ok(a.z > 26);
    for (let i = 0; i < 200; i++)
        w.step({ ...idle, climb: -1 });
    assert.ok(Math.abs(a.z - .65) < .001);
    for (let i = 0; i < 500; i++)
        w.step({ ...idle, climb: 1 });
    assert.equal(a.z, 65);
});
test('a ridge blocks low flight but can be crossed at sufficient altitude', () => {
    const w = flat(), a = w.actors[0];
    w.actors[1].x = 450;
    for (let y = 0; y < GRID; y++)
        w.cells[y * GRID + 59].elevation = 10;
    for (let i = 0; i < 30; i++)
        w.move(a, 1, 0, DT);
    assert.ok(a.x < 236);
    a.z = 15;
    for (let i = 0; i < 45; i++)
        w.move(a, 1, 0, DT);
    assert.ok(a.x > 250);
});
test('trees stop low movement but high flight passes over their canopy', () => {
    const w = flat(), a = w.actors[0];
    Object.assign(w.cells[64 * GRID + 59], { kind: 1, hp: 55, max: 55 });
    a.x = 234;
    a.y = 258;
    for (let i = 0; i < 10; i++)
        w.move(a, 1, 0, DT);
    assert.ok(a.x < 236);
    a.z = 10;
    for (let i = 0; i < 20; i++)
        w.move(a, 1, 0, DT);
    assert.ok(a.x > 240);
});
test('bolts pass below a high cultivator without damage', () => {
    const w = flat(), a = w.actors[0], b = w.actors[1];
    b.x = a.x + 40;
    b.z = 20;
    w.cast(a, 'bolt', { x: b.x, y: b.y });
    for (let i = 0; i < 100; i++)
        w.step(idle);
    assert.equal(b.hp, 500);
    assert.equal(b.ward, 100);
});
test('elevated bolts clear cover and hit an altitude-aligned target', () => {
    const w = flat(), a = w.actors[0], b = w.actors[1];
    a.z = 12;
    b.z = 12;
    b.x = a.x + 40;
    for (let y = 60; y < 69; y++)
        Object.assign(w.cells[y * GRID + 60], { kind: 1, hp: 55, max: 55 });
    w.cast(a, 'bolt', b);
    for (let i = 0; i < 100; i++)
        w.step(idle);
    assert.ok(b.hp < 500);
    assert.equal(w.cells[64 * GRID + 60].hp, 55);
});
test('sword waves miss targets at a different altitude and leave distant ground intact', () => {
    const w = flat(), a = w.actors[0], b = w.actors[1];
    b.x = a.x + 20;
    b.z = 20;
    w.cast(a, 'slash', b);
    for (let i = 0; i < 80; i++)
        w.step(idle);
    assert.equal(b.hp, 500);
    assert.ok(w.cells.every(c => c.depth === 0));
});
test('a descending palm hits an airborne target once as it passes through', () => {
    const w = flat(), a = w.actors[0], b = w.actors[1];
    b.x = a.x + 20;
    b.z = 20;
    w.cast(a, 'nova', b);
    for (let i = 0; i < 35; i++)
        w.step(idle);
    assert.ok(b.hp < 500);
    const hp = b.hp;
    for (let i = 0; i < 25; i++)
        w.step(idle);
    assert.equal(b.hp, hp);
    assert.ok(w.groundHeight(b.x, b.y) < 0);
});
test('a cultivator above the entire palm descent is safe', () => {
    const w = flat(), a = w.actors[0], b = w.actors[1];
    b.x = a.x + 20;
    b.z = 60;
    w.cast(a, 'nova', b);
    for (let i = 0; i < 60; i++)
        w.step(idle);
    assert.equal(b.hp, 500);
});
test('crater excavation lowers the physical floor and survives a save round-trip', () => { const w = flat(), p = { x: 234, y: 258 }; const before = w.groundHeight(p.x, p.y); w.terrain(p, 8, 900); assert.ok(w.groundHeight(p.x, p.y) < before - 2); const clone = new World(); clone.loadTerrain(w.saveTerrain()); assert.equal(clone.groundHeight(p.x, p.y), w.groundHeight(p.x, p.y)); });
test('old flat saves migrate to a height field without losing scars or durability', () => { const w = flat(); w.cells[0].depth = 4; Object.assign(w.cells[1], { kind: 2, max: 200, hp: 70 }); const raw = JSON.stringify({ version: 1, cells: w.cells.map(({ elevation, ...c }) => c), destroyed: 7 }); const restored = new World(); restored.loadTerrain(raw); assert.equal(restored.cells[0].depth, 4); assert.equal(restored.cells[1].hp, 70); assert.equal(restored.destroyed, 7); assert.equal(restored.cells[0].elevation, landscapeHeight(2, 2)); assert.equal(JSON.parse(restored.saveTerrain()).version, 2); });
test('cursor surface picking agrees with rendered sloped ground', () => { const height = (x: number, y: number) => 2 + x * .02 + y * .03; const original = { x: 120, y: 130 }; const offset = lift(height(original.x, original.y), true); const flatPoint = { x: original.x + offset.x, y: original.y + offset.y }; const picked = pickSurface(flatPoint, height, true); assert.ok(Math.hypot(picked.x - original.x, picked.y - original.y) < .001); assert.ok(Math.abs((picked.z ?? 0) - height(picked.x, picked.y)) < .001); });
test('intact shrine roofs block low flight across their interior', () => { const w = flat(); for (let y = 0; y < 3; y++)
    for (let x = 0; x < 5; x++) {
        if (y === 1 && x > 0 && x < 4)
            continue;
        Object.assign(w.cells[(54 + y) * GRID + 52 + x], { kind: 2, hp: 200, max: 200 });
    } assert.equal(w.blocked(218, 222, .75, 4), true); assert.equal(w.blocked(218, 222, .75, 10), false); });
