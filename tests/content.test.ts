import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONTENT, BASELINE_ENCOUNTER, validateContent } from '../src/content.ts';
import { World } from '../src/sim.ts';
import { SessionAuthority } from '../src/session-authority.ts';
import { targetInRange } from '../src/targeting.ts';

const catalog = () => structuredClone(DEFAULT_CONTENT) as any;

test('content rejects hostile numbers, missing/duplicate IDs, behaviors, references and counts before creating actors', () => {
    let actorsCreated = 0;
    class ObservedWorld extends World {
        override actor(id: number, x: number, y: number) { actorsCreated++; return super.actor(id, x, y); }
    }
    const mutations = [
        (c: any) => { c.techniques[0].cost = NaN; },
        (c: any) => { c.techniques[0].cooldown = Infinity; },
        (c: any) => { c.techniques[0].powerScale = -1; },
        (c: any) => { c.techniques[0].cost = 101; },
        (c: any) => { c.techniques.pop(); },
        (c: any) => { delete c.enemies[0].id; },
        (c: any) => { c.enemies.push(c.enemies[0]); },
        (c: any) => { c.techniques[1].id = 'bolt'; },
        (c: any) => { c.encounters.push(c.encounters[0]); },
        (c: any) => { c.techniques[0].behavior = 'nova'; },
        (c: any) => { c.enemies[0].behavior = 'pursuer'; },
        (c: any) => { c.encounters[0].spawns[0].enemyId = 'missing'; },
        (c: any) => { c.encounters[0].spawns[0].count = 7; },
        (c: any) => { c.encounters[0].spawns[0].count = 0; },
        (c: any) => { c.encounters[0].spawns[0].count = 1.5; },
        (c: any) => { c.encounters[0].spawns = []; },
        (c: any) => { c.encounters[0].spawns[0].x = -1; },
        (c: any) => { c.encounters[0].spawns[0].altitude = Infinity; },
        (c: any) => { c.enemies[0].realm = 4; },
        (c: any) => { c.enemies[0].hp = 0; },
        (c: any) => { c.enemies[0].team = 1; },
        (c: any) => { c.enemies = Array.from({ length: 33 }, (_, i) => ({ ...c.enemies[0], id: `enemy-${i}` })); },
    ];
    for (const mutate of mutations) {
        const content = catalog(); mutate(content);
        assert.throws(() => new ObservedWorld(content, BASELINE_ENCOUNTER), /Invalid content:/);
    }
    assert.throws(() => new ObservedWorld(DEFAULT_CONTENT, 'missing'), /Unknown encounter: missing/);
    assert.equal(actorsCreated, 0);
    for (const raw of [null, [], {}, { ...catalog(), enemies: [null] }]) assert.throws(() => validateContent(raw), /Invalid content:/);
});

test('baseline preserves solo and creates a stationary host-owned allied encounter', () => {
    const solo = new World(); assert.equal(solo.ai, true); assert.equal(solo.actors.length, 2);
    assert.equal(solo.actors[0].team, undefined);
    const w = new World(DEFAULT_CONTENT, BASELINE_ENCOUNTER), [a, ally, enemy] = w.actors;
    assert.equal(w.ai, false); assert.equal(enemy.hp, 3000); assert.equal(enemy.x, 256);
    assert.equal(enemy.z, w.groundHeight(256, 256) + 3);
    assert.equal(targetInRange(a, ally, 220), false); assert.equal(targetInRange(a, enemy, 220), true);
    const authority = new SessionAuthority(w, [0, 1]);
    const generation = authority.connect('player', 0);
    assert.equal(authority.submit('player', { generation, actorId: 0, sequence: 1,
        input: { move: { x: 0, y: 0 }, aim: enemy, enemyId: 'other', damage: 999 } }).accepted, false);
    const before = { x: enemy.x, y: enemy.y, z: enemy.z };
    for (let i = 0; i < 120; i++) authority.step();
    assert.deepEqual({ x: enemy.x, y: enemy.y, z: enemy.z }, before);
});

test('definitions change real casts and spawns; caller mutation cannot retune a world', () => {
    const raw = catalog();
    Object.assign(raw.techniques[1], { cost: 7, cooldown: 2, powerScale: 2 });
    Object.assign(raw.enemies[0], { hp: 1234, realm: 2 });
    Object.assign(raw.encounters[0].spawns[0], { x: 110, y: 100, altitude: 8 });
    const w = new World(raw, BASELINE_ENCOUNTER), [a, , enemy] = w.actors;
    assert.equal(enemy.hp, 1234); assert.equal(enemy.realm, 2); assert.equal(enemy.x, 110);
    assert.equal(enemy.z, w.groundHeight(110, 100) + 8);
    raw.techniques[1].cost = 99; raw.encounters[0].spawns[0].x = 400;
    assert.ok(Object.isFrozen(w.content.encounters[0].spawns[0]));
    w.cells.forEach(c => Object.assign(c, { kind: 0, hp: 0, max: 0, depth: 0, elevation: 0 }));
    Object.assign(a, { x: 100, y: 100, z: 4 }); enemy.z = 4;
    assert.equal(w.cast(a, 'slash', enemy), true);
    assert.equal(a.qi, 93); assert.equal(a.cool[1], 2);
    for (let i = 0; i < 60; i++) w.stepPlayers(new Map());
    assert.equal(enemy.hp, 1234 - 80 * 3 ** a.realm * 2 / 3 ** enemy.realm);
    assert.equal(w.cast(a, 'slash', enemy), false);
});
