import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, DT } from '../src/sim.ts';
import { DEFAULT_CONTENT, SKIRMISH_ENCOUNTER, MAX_ENEMIES, validateContent } from '../src/content.ts';
import { SessionAuthority } from '../src/session-authority.ts';

function arena(count = 1) {
    const content = structuredClone(DEFAULT_CONTENT) as any;
    content.encounters[1].spawns = [{ enemyId: 'ruin-skirmisher', count, x: 150, y: 100, altitude: 5 }];
    const w = new World(content, SKIRMISH_ENCOUNTER);
    w.cells.forEach(c => Object.assign(c, { kind: 0, hp: 0, max: 0, elevation: 0, depth: 0 }));
    Object.assign(w.actors[0], { x: 100, y: 100, z: 5, ward: 0, hp: 10000, maxHp: 10000 });
    Object.assign(w.actors[1], { x: 400, y: 400, z: 5, ward: 0, hp: 10000, maxHp: 10000 });
    for (const a of w.actors.slice(2)) a.z = 5;
    return w;
}
function tick(w: World, n = 1) { for (let i = 0; i < n; i++) w.stepPlayers(new Map()); }
function untilWarning(w: World) {
    for (let i = 0; i < 600 && !w.telegraphs.length; i++) tick(w);
    assert.ok(w.telegraphs.length, 'enemy reached a clear firing position');
}

test('enemies perceive by 3D distance, break ties stably, retarget independently and ignore allied enemies', () => {
    const w = arena(2), [p, q, a, b] = w.actors;
    p.x = 500; p.y = 500; tick(w, 60);
    assert.equal(w.enemyStates.get(a.id)!.targetId, undefined); assert.equal(a.x, 150);
    Object.assign(p, { x: 130, y: 100 }); Object.assign(q, { x: 174, y: 100 });
    tick(w); assert.equal(w.enemyStates.get(a.id)!.targetId, 0); assert.equal(w.enemyStates.get(b.id)!.targetId, 1);
    assert.equal(w.telegraphs.length, 2);
    p.hp = 0; tick(w); assert.equal(w.enemyStates.get(a.id)!.warning, undefined);
    tick(w); assert.equal(w.enemyStates.get(a.id)!.targetId, 1);
    q.team = a.team; tick(w); assert.equal(w.telegraphs.length, 0);
    assert.equal(w.enemyStates.get(a.id)!.targetId, undefined);
    const tie = arena(); Object.assign(tie.actors[0], { x: 130 }); Object.assign(tie.actors[1], { x: 170, y: 100 });
    tick(tie); assert.equal(tie.telegraphs[0].targetId, 0);
});

test('windup commits aim and freezes motion, releases only after its duration and observes recovery', () => {
    const w = arena(), enemy = w.actors[2]; untilWarning(w);
    const warning = structuredClone(w.telegraphs[0]), origin = { x: enemy.x, y: enemy.y, z: enemy.z }, qi = enemy.qi;
    w.actors[0].y += 10;
    tick(w, 65); assert.equal(w.waves.length, 0); assert.equal(enemy.qi, qi);
    assert.deepEqual(w.telegraphs[0].aim, warning.aim);
    assert.deepEqual({ x: enemy.x, y: enemy.y, z: enemy.z }, origin);
    tick(w); assert.equal(w.telegraphs.length, 0); assert.equal(w.waves.length, 1);
    assert.equal(w.waves[0].owner, enemy.id);
    assert.equal(w.waves[0].angle, Math.atan2(warning.aim.y - origin.y, warning.aim.x - origin.x));
    assert.ok(w.enemyStates.get(enemy.id)!.recovery > 2);
    tick(w, 100); assert.equal(w.telegraphs.length, 0);
    tick(w, 50); assert.equal(w.telegraphs.length, 1);
});

test('pending attacks cancel on owner death, target death, departure or changed allegiance', () => {
    for (const invalidate of [
        (w: World) => { w.actors[2].hp = 0; },
        (w: World) => { w.actors[0].hp = 0; },
        (w: World) => { w.actors[0].x = 500; },
        (w: World) => { w.actors[0].team = 2; },
    ]) {
        const w = arena(); untilWarning(w); invalidate(w); tick(w, 90);
        assert.equal(w.telegraphs.length, 0); assert.equal(w.waves.length, 0);
        assert.equal(w.actors[2].qi, 100);
    }
});

test('flyers clear a blocking tree wall and ridge, gain altitude, and attack an airborne target', () => {
    const w = arena(), enemy = w.actors[2], player = w.actors[0];
    Object.assign(player, { x: 100, y: 100, z: 24 }); Object.assign(enemy, { x: 220, y: 100, z: 3 });
    // Tall ordinary cover across the direct approach, backed by raised ground.
    for (let y = 0; y < 128; y++) for (let x = 39; x <= 43; x++) {
        Object.assign(w.cells[y * 128 + x], { elevation: 10, kind: 1, hp: 55, max: 55 });
    }
    let peak = enemy.z;
    for (let i = 0; i < 1200 && !w.telegraphs.length; i++) { tick(w); peak = Math.max(peak, enemy.z); }
    assert.ok(enemy.x < 156, `crossed cover wall, x=${enemy.x}`); assert.ok(peak > 19);
    assert.equal(w.telegraphs.length, 1); assert.equal(w.telegraphs[0].aim.z, 24.7);
    const slope = Math.sign(24 - enemy.z);
    tick(w, 67); assert.equal(Math.sign(w.waves[0].vz), slope, 'crescent follows committed altitude');
    tick(w, 50); assert.ok(player.hp < player.maxHp, 'airborne target receives an actual hit');
});

test('a telegraphed crescent reaches a target well above the attacker', () => {
    const w = arena(); Object.assign(w.actors[0], { x: 120, z: 24 });
    tick(w); assert.equal(w.telegraphs[0].aim.z, 24.7);
    tick(w, 66); assert.ok(w.waves[0].vz > 0);
    tick(w, 40); assert.ok(w.actors[0].hp < 10000);
});

test('six enemies keep collision separation, make progress and do not override player authority', () => {
    const w = arena(MAX_ENEMIES), authority = new SessionAuthority(w, [0, 1]);
    const before = w.actors.slice(2).map(a => a.x);
    for (let i = 0; i < 90; i++) authority.step();
    w.actors.slice(2).forEach((a, i) => assert.ok(a.x < before[i]));
    for (const a of w.actors.slice(2)) for (const b of w.actors.slice(2)) {
        if (a !== b && Math.abs(a.z - b.z) < 1.8) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 1.49);
    }
    const generation = authority.connect('player', 0);
    assert.deepEqual(authority.submit('player', { generation, sequence: 1, actorId: 2,
        input: { move: { x: 1, y: 0 }, aim: w.actors[0] } }), { accepted: false, reason: 'not-owner' });
});

test('skirmisher configuration and expanded roster bounds reject malformed content', () => {
    for (const change of [
        (c: any) => { c.enemies[1].combat.windup = .1; },
        (c: any) => { c.enemies[1].combat.speed = Infinity; },
        (c: any) => { c.enemies[1].combat.range = 221; },
        (c: any) => { c.enemies[1].combat.recovery = -1; },
        (c: any) => { c.enemies[1].combat.technique = 'missing'; },
        (c: any) => { delete c.enemies[1].combat; },
        (c: any) => { c.enemies[0].combat = c.enemies[1].combat; },
        (c: any) => { c.encounters[1].spawns[0].count = 5; }, // sum 7
        (c: any) => { c.encounters[1].spawns[0].count = 2; c.encounters[1].spawns[0].x = 510; },
    ]) {
        const c = structuredClone(DEFAULT_CONTENT); change(c); assert.throws(() => validateContent(c), /Invalid content/);
    }
    const w = arena(MAX_ENEMIES); assert.equal(w.actors.length, 8);
    assert.deepEqual(w.actors.map(a => a.id), [0, 1, 2, 3, 4, 5, 6, 7]);
});
