import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, DT } from '../src/sim.ts';
import type { ActorInput } from '../src/sim.ts';

function arena() {
    const w = new World();
    w.cells.forEach(c => { c.elevation = 0; c.depth = 0; c.kind = 0; c.hp = 0; });
    w.actors[0].x = 100; w.actors[0].y = 150; w.actors[0].z = 10;
    w.actors[1].x = 350; w.actors[1].y = 350; w.actors[1].z = 10;
    return w;
}
const idle: ActorInput = { move: { x: 0, y: 0 }, aim: { x: 250, y: 250 } };

test('shared step controls actors by ID without rival AI overriding a player', () => {
    const w = arena(); // AI remains enabled intentionally.
    const a = w.actors[0], b = w.actors[1];
    for (let i = 0; i < 30; i++) w.stepPlayers(new Map([
        [a.id, { ...idle, move: { x: 1, y: 0 } }],
        [b.id, { ...idle, move: { x: 0, y: -1 }, climb: 1 }],
    ]));
    assert.ok(a.x > 110); assert.equal(a.y, 150);
    assert.equal(b.x, 350); assert.ok(b.y < 340); assert.ok(b.z > 15);
    assert.equal(w.bolts.length, 0);
    assert.ok(Math.abs(w.sceneTime - .5) < 1e-9);
});

test('either player can step and cast without slowing the shared clock or partner', () => {
    const w = arena(), control = arena();
    const aim = { x: 450, y: 350, z: 10.7 };
    w.stepPlayers(new Map([
        [0, { ...idle, move: { x: 1, y: 0 } }],
        [1, { ...idle, aim, dash: true, fire: 'bolt', move: { x: 1, y: 0 } }],
    ]));
    assert.ok(w.actors[1].dashLeft > 0);
    assert.equal(w.bolts.length, 5);
    assert.ok(w.bolts.every(b => b.owner === 1));
    assert.ok(w.actors[1].qi < 82);
    for (let i = 0; i < 29; i++) w.stepPlayers(new Map([
        [0, { ...idle, move: { x: 1, y: 0 } }], [1, idle],
    ]));
    for (let i = 0; i < 30; i++) control.stepPlayers(new Map([
        [0, { ...idle, move: { x: 1, y: 0 } }], [1, idle],
    ]));
    assert.equal(w.timeScale, 1);
    assert.equal(w.sceneTime, w.time);
    assert.equal(w.actors[0].x, control.actors[0].x);
    assert.ok(Math.abs(w.actors[1].cool[0] - .45) < 1e-9);
});

test('shared step input map order does not change simulation ordering or random casts', () => {
    const a = arena(), b = arena();
    const first: ActorInput = { ...idle, fire: 'bolt' };
    const second: ActorInput = { ...idle, fire: 'bolt', climb: -1 };
    for (let i = 0; i < 60; i++) {
        a.stepPlayers(new Map([[0, first], [1, second]]));
        b.stepPlayers(new Map([[1, second], [0, first]]));
    }
    assert.deepEqual(a.actors, b.actors);
    assert.deepEqual(a.bolts, b.bolts);
    assert.equal(a.saveTerrain(), b.saveTerrain());
    assert.throws(() => a.stepPlayers(new Map(), DT * 4));
});
