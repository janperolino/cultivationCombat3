import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, DT } from '../src/sim.ts';
import type { ActorInput } from '../src/sim.ts';
import { SessionAuthority, STALE_INPUT_TICKS, MAX_COMMANDS_PER_TICK, MAX_SEQUENCE_GAP } from '../src/session-authority.ts';

function setup() {
    const world = new World();
    world.cells.forEach(c => { c.elevation = 0; c.depth = 0; c.kind = 0; c.hp = 0; });
    Object.assign(world.actors[0], { x: 100, y: 150, z: 10 });
    Object.assign(world.actors[1], { x: 250, y: 150, z: 10 });
    const authority = new SessionAuthority(world, [0, 1]);
    const generation = authority.connect('alice', 0);
    const otherGeneration = authority.connect('bob', 1);
    return { world, authority, generation, otherGeneration };
}
const idle: ActorInput = { move: { x: 0, y: 0 }, aim: { x: 300, y: 150, z: 10.7 } };
function command(generation: number, sequence = 1, actorId = 0, input: unknown = idle) {
    return { generation, sequence, actorId, input };
}
function rejected(result: ReturnType<SessionAuthority['submit']>, reason: string) {
    assert.deepEqual(result, { accepted: false, reason });
}

test('host assignments are exclusive, bounded, and copied from configuration', () => {
    const w = new World();
    for (const ids of [[], [0, 0], [0, 1, 2], [99], [NaN], [-1]]) {
        assert.throws(() => new SessionAuthority(w, ids));
    }
    const ids = [0, 1], a = new SessionAuthority(w, ids);
    ids[0] = 99;
    a.connect('alice', 0);
    assert.throws(() => a.connect('bob', 0));
    assert.throws(() => a.connect('alice', 1));
    assert.throws(() => a.connect('bob', 99));
    assert.throws(() => a.connect('', 1));
    assert.throws(() => a.connect('x'.repeat(65), 1));
    assert.equal(a.disconnect('missing'), false);
});

test('two owners move and cast through a fixed shared clock independent of arrival order', () => {
    const a = setup(), b = setup();
    const first = { ...idle, move: { x: 1, y: 0 }, fire: 'bolt', dash: true };
    const second = { ...idle, move: { x: 0, y: 1 }, fire: 'bolt', climb: 1 };
    for (let tick = 0; tick < 30; tick++) {
        assert.equal(a.authority.submit('alice', command(a.generation, tick + 1, 0, first)).accepted, true);
        assert.equal(a.authority.submit('bob', command(a.otherGeneration, tick + 1, 1, second)).accepted, true);
        b.authority.submit('bob', command(b.otherGeneration, tick + 1, 1, second));
        b.authority.submit('alice', command(b.generation, tick + 1, 0, first));
        a.authority.step(); b.authority.step();
    }
    assert.ok(a.world.actors[0].x > 110);
    assert.ok(a.world.actors[1].y > 155);
    assert.ok(a.world.actors[1].z > 15);
    assert.ok(a.world.bolts.some(b => b.owner === 0));
    assert.ok(a.world.bolts.some(b => b.owner === 1));
    assert.equal(a.authority.tick, 30);
    assert.ok(Math.abs(a.world.time - 30 * DT) < 1e-9);
    assert.equal(a.world.sceneTime, a.world.time);
    assert.equal(a.world.timeScale, 1);
    assert.deepEqual(a.world.actors, b.world.actors);
    assert.deepEqual(a.world.bolts, b.world.bolts);
    assert.equal(a.world.saveTerrain(), b.world.saveTerrain());
});

test('untrusted identities, ownership, generations, and state grants are rejected without world mutation', () => {
    const { authority: a, world, generation: g } = setup();
    const before = JSON.stringify(world);
    rejected(a.submit('mallory', command(g)), 'unknown-client');
    rejected(a.submit('alice', command(g, 1, 1)), 'not-owner');
    rejected(a.submit('alice', command(g + 1)), 'wrong-generation');
    for (const field of ['clientId', 'damage', 'hp', 'realm', 'dt', 'time', 'x']) {
        rejected(a.submit('alice', { ...command(g), [field]: 100 }), 'invalid-command');
    }
    assert.equal(JSON.stringify(world), before);
    assert.equal(a.submit('alice', command(g)).accepted, true);
});

test('malformed and out-of-bounds JSON-shaped inputs do not consume sequence or enter simulation', () => {
    const { authority: a, generation: g } = setup();
    const badInputs: unknown[] = [null, [], 'move', {}, { ...idle, damage: 10 },
        { ...idle, fire: 'kill' }, { ...idle, dash: 1 }, { ...idle, autoAltitude: 'true' },
        { ...idle, climb: 1.01 }, { ...idle, move: { x: 1.01, y: 0 } },
        { ...idle, move: { x: 0, y: -1.01 } }, { ...idle, move: { x: 0, y: 0, z: 1 } },
        { ...idle, aim: { x: 1025, y: 0 } }, { ...idle, aim: { x: 0, y: -513 } },
        { ...idle, aim: { x: 0, y: 0, z: 129 } }, { ...idle, aim: { x: 0, y: 0, locked: true } },
        { ...idle, aim: { x: 0, y: 0, locked: 1 } }, { ...idle, aim: { x: 0, y: 0, targetId: -1 } },
        { ...idle, aim: { x: 0, y: 0, targetId: 0 } }, { ...idle, aim: { x: 0, y: 0, targetId: 99 } },
    ];
    for (const value of [NaN, Infinity, -Infinity, '1', null]) {
        badInputs.push({ ...idle, move: { x: value, y: 0 } }, { ...idle, climb: value },
            { ...idle, aim: { x: 0, y: value } }, { ...idle, aim: { x: 0, y: 0, z: value } });
    }
    for (const input of badInputs) rejected(a.submit('alice', command(g, 1, 0, input)), 'invalid-command');
    for (const data of [null, [], {}, { ...command(g), sequence: 1.5 },
        { ...command(g), actorId: NaN }, { ...command(g), generation: Infinity }]) {
        rejected(a.submit('alice', data), 'invalid-command');
    }
    assert.equal(a.submit('alice', command(g, 1, 0, {
        ...idle, move: { x: -1, y: 1 }, climb: -1, autoAltitude: false,
        aim: { x: -512, y: 1024, z: -128 },
    })).accepted, true);
    a.step();
});

test('sequencing rejects replay, backward, zero, and excessive jumps without poisoning later input', () => {
    const { authority: a, generation: g } = setup();
    rejected(a.submit('alice', command(g, 0)), 'sequence');
    rejected(a.submit('alice', command(g, MAX_SEQUENCE_GAP + 1)), 'sequence');
    assert.equal(a.submit('alice', command(g, 2)).accepted, true);
    rejected(a.submit('alice', command(g, 2)), 'sequence');
    rejected(a.submit('alice', command(g, 1)), 'sequence');
    rejected(a.submit('alice', command(g, Number.MAX_SAFE_INTEGER)), 'sequence');
    assert.equal(a.submit('alice', command(g, 2 + MAX_SEQUENCE_GAP)).accepted, true);
});

test('intake is bounded per owner and tick; latest motion cannot erase accepted one-shots', () => {
    const { authority: a, generation: g, otherGeneration: b, world } = setup();
    for (let seq = 1; seq <= MAX_COMMANDS_PER_TICK; seq++) {
        assert.equal(a.submit('alice', command(g, seq, 0, seq === 1 ? { ...idle, fire: 'bolt', dash: true } : idle)).accepted, true);
    }
    rejected(a.submit('alice', command(g, 5)), 'rate-limit');
    assert.equal(a.submit('bob', command(b, 1, 1)).accepted, true);
    a.step();
    assert.equal(world.bolts.length, 5);
    assert.ok(world.actors[0].dashLeft > 0);
    assert.equal(a.submit('alice', command(g, 5)).accepted, true);
});

test('casts and dodges are consumed once while movement persists and accepted input is copied', () => {
    const { authority: a, generation: g, world } = setup();
    const input: ActorInput = { ...idle, aim: { ...idle.aim }, move: { x: 1, y: 0 }, fire: 'bolt', dash: true };
    a.submit('alice', command(g, 1, 0, input));
    input.move.x = -1; input.aim.x = NaN; input.fire = 'nova';
    a.step();
    assert.equal(world.bolts.length, 5);
    assert.ok(world.actors[0].vx > 0);
    // Make an erroneous replay observable independently of the normal cooldowns.
    world.actors[0].cool = [0, 0, 0];
    world.actors[0].dashLeft = 0; world.actors[0].dashCool = 0;
    const qi = world.actors[0].qi;
    a.step();
    assert.equal(world.bolts.length, 5);
    assert.equal(world.casts.length, 0);
    assert.equal(world.actors[0].dashLeft, 0);
    assert.ok(world.actors[0].qi > qi);
    assert.ok(Number.isFinite(world.actors[0].aim));
});

test('stale input becomes neutral at the exact tick boundary; rejected replay does not refresh it', () => {
    const { authority: a, generation: g, world } = setup();
    let applied: ActorInput | undefined;
    const stepPlayers = world.stepPlayers.bind(world);
    world.stepPlayers = (inputs, dt) => { applied = inputs.get(0); stepPlayers(inputs, dt); };
    a.submit('alice', command(g, 1, 0, { ...idle, move: { x: 1, y: 0 }, climb: 1, autoAltitude: true }));
    for (let tick = 0; tick < STALE_INPUT_TICKS; tick++) {
        rejected(a.submit('alice', command(g)), 'sequence');
        a.step();
        assert.equal(applied?.move.x, 1);
    }
    const speed = world.actors[0].vx;
    a.step();
    assert.deepEqual(applied?.move, { x: 0, y: 0 });
    assert.equal(applied?.climb, undefined);
    assert.equal(applied?.autoAltitude, undefined);
    assert.ok(world.actors[0].vx < speed && world.actors[0].vx > 0);
    assert.equal(a.submit('alice', command(g, 2)).accepted, true);
});

test('disconnect clears pending actions, retains idle control, and new generations block old packets', () => {
    const { authority: a, generation: g, otherGeneration: b, world } = setup();
    a.submit('bob', command(b, 1, 1, { ...idle, fire: 'bolt', dash: true, move: { x: 1, y: 0 } }));
    assert.equal(a.disconnect('bob'), true);
    rejected(a.submit('bob', command(b, 2, 1)), 'unknown-client');
    for (let i = 0; i < 90; i++) a.step();
    assert.equal(world.actors[1].x, 250);
    assert.equal(world.bolts.length, 0); // AI remains enabled, but cannot reclaim the actor.
    const next = a.connect('bob', 1);
    assert.ok(next > b);
    rejected(a.submit('bob', command(b, 99, 1)), 'wrong-generation');
    assert.equal(a.submit('bob', command(next, 1, 1)).accepted, true);
    a.disconnect('alice');
    const transferred = a.connect('charlie', 0);
    rejected(a.submit('alice', command(g, 2)), 'unknown-client');
    assert.equal(a.submit('charlie', command(transferred)).accepted, true);
});

test('target hints are validated and their position comes from authority at consumption time', () => {
    const { authority: a, generation: g, world } = setup();
    const input = { ...idle, fire: 'bolt', aim: { x: 0, y: 0, z: -128, targetId: 1, locked: true } };
    world.actors[1].hp = 0;
    rejected(a.submit('alice', command(g, 1, 0, input)), 'invalid-command');
    world.actors[1].hp = 500; world.actors[1].x = 450;
    rejected(a.submit('alice', command(g, 1, 0, input)), 'invalid-command');
    world.actors[1].x = 250;
    assert.equal(a.submit('alice', command(g, 1, 0, input)).accepted, true);
    world.actors[1].y = 160; world.actors[1].z = 20;
    a.step();
    assert.equal(world.bolts.length, 5);
    assert.ok(world.bolts.every(b => b.targetId === 1 && b.targetZ === 20.7 && b.locked));
    assert.ok(world.actors[0].aim > 0 && world.actors[0].aim < .1);
});

test('targets invalidated between acceptance and stepping lose guidance', () => {
    for (const invalidate of [(w: World) => { w.actors[1].hp = 0; }, (w: World) => { w.actors[1].x = 450; }]) {
        const { authority: a, generation: g, world } = setup();
        a.submit('alice', command(g, 1, 0, { ...idle, fire: 'bolt', aim: { ...idle.aim, targetId: 1, locked: true } }));
        invalidate(world);
        a.step();
        assert.ok(world.bolts.length > 0);
        assert.ok(world.bolts.every(b => b.targetId === undefined && !b.locked));
    }
});

test('accepted commands cannot bypass simulation death, qi, or cooldown restrictions', () => {
    for (const block of [(w: World) => { w.actors[0].hp = 0; },
        (w: World) => { w.actors[0].qi = 0; },
        (w: World) => { w.actors[0].cool[0] = 10; w.actors[0].dashCool = 10; }]) {
        const { authority: a, generation: g, world } = setup();
        block(world);
        assert.equal(a.submit('alice', command(g, 1, 0, { ...idle, fire: 'bolt', dash: true })).accepted, true);
        a.step();
        assert.equal(world.bolts.length, 0);
        assert.equal(world.actors[0].dashLeft, 0);
    }
});
