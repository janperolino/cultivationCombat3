import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, DT } from '../src/sim.ts';
import type { ActorInput } from '../src/sim.ts';
import { DEFAULT_CONTENT, SKIRMISH_ENCOUNTER, validateContent } from '../src/content.ts';
import { SessionAuthority } from '../src/session-authority.ts';
import { ActionOutbox } from '../src/client-actions.ts';
import { captureDisplayFrame, validateDisplayFrame, ReplicaClient, ReplicationStream } from '../src/replication.ts';
import { MotionPredictor, RemoteInterpolator } from '../src/client-motion.ts';

const idle: ActorInput = { move: { x: 0, y: 0 }, aim: { x: 260, y: 256 } };
function arena(two = true, count = 1) {
    const c = structuredClone(DEFAULT_CONTENT) as any;
    c.encounters[1].spawns = [{ enemyId: 'ruin-skirmisher', count, x: 260, y: 256, altitude: 5 }];
    const w = new World(c, SKIRMISH_ENCOUNTER, true);
    w.cells.forEach(c => Object.assign(c, { hp: 0, max: 0, kind: 0, depth: 0, elevation: 0 }));
    Object.assign(w.actors[0], { x: 232, y: 256, z: 5 }); Object.assign(w.actors[1], { x: 235, y: 256, z: 5 });
    w.actors[2].z = 5;
    const authority = new SessionAuthority(w, [0, 1]), generation = authority.connect('a', 0);
    if (two) authority.connect('b', 1);
    return { w, e: w.encounter!, authority, generation };
}
function step(w: World, n = 1, input: ActorInput = idle) { for (let i = 0; i < n; i++) w.stepPlayers(new Map([[0, input], [1, idle]])); }
function holdRevive(w: World, n: number) { step(w, n, { ...idle, revive: true }); }

test('lifecycle is opt-in; unused seats do not prevent a solo wipe and joining never heals', () => {
    assert.equal(new World().encounter, undefined);
    const c = structuredClone(DEFAULT_CONTENT);
    const waiting = new World(c, SKIRMISH_ENCOUNTER, true); step(waiting, 120);
    assert.equal(waiting.encounter!.phase, 'waiting'); assert.equal(waiting.telegraphs.length, 0);
    const { w, e, authority } = arena(false);
    step(w); assert.ok(w.telegraphs.every(t => t.targetId === 0));
    assert.equal(w.canDamage(2, w.actors[1]), false);
    w.actors[0].hp = 0; authority.step(); assert.equal(e.phase, 'defeated');
    assert.equal(w.actors[1].hp, 500);
    authority.disconnect('a'); authority.connect('a2', 0); assert.equal(w.actors[0].hp, 0); assert.equal(e.phase, 'defeated');
});

test('victory and wipe cancel attacks and freeze combat; simultaneous elimination resolves as defeat', () => {
    for (const outcome of ['completed', 'defeated', 'both'] as const) {
        const { w, e } = arena(); step(w); assert.equal(w.telegraphs.length, 1);
        w.cast(w.actors[0], 'nova', w.actors[2]);
        if (outcome !== 'defeated') w.actors[2].hp = 0;
        if (outcome !== 'completed') w.actors.slice(0, 2).forEach(a => { a.hp = 0; });
        step(w); assert.equal(e.phase, outcome === 'completed' ? 'completed' : 'defeated');
        assert.equal(w.telegraphs.length + w.bolts.length + w.waves.length + w.casts.length, 0);
        const hp = w.actors.map(a => a.hp), qi = w.actors[0].qi;
        assert.equal(w.cast(w.actors[0], 'bolt', w.actors[2]), false);
        step(w, 120, { ...idle, fire: 'nova', move: { x: 1, y: 0 } });
        assert.deepEqual(w.actors.map(a => a.hp), hp); assert.equal(w.actors[0].qi, qi);
    }
});

test('ally revive needs two uninterrupted seconds and restores half health/qi without ward or invulnerability', () => {
    const { w, e } = arena(); w.actors[1].hp = 0; w.enemyStates.get(2)!.recovery = 100;
    holdRevive(w, 119); assert.equal(w.actors[1].hp, 0); assert.ok(e.revives.get(0)!.progress > 1.9);
    holdRevive(w, 1); assert.equal(w.actors[1].hp, 250); assert.equal(w.actors[1].qi, 50); assert.equal(w.actors[1].ward, 0);
    assert.equal(e.revives.size, 0); assert.equal(e.phase, 'active');
    w.damage(w.actors[1], 30); assert.equal(w.actors[1].hp, 240);
});

test('revive is interrupted by release, movement, altitude, distance, attack or dodge and cannot self-revive', () => {
    for (const interrupt of [
        (w: World) => step(w),
        (w: World) => step(w, 1, { ...idle, revive: true, move: { x: 1, y: 0 } }),
        (w: World) => step(w, 1, { ...idle, revive: true, climb: 1 }),
        (w: World) => { w.actors[1].z = 30; holdRevive(w, 1); },
        (w: World) => { w.actors[1].x = 260; holdRevive(w, 1); },
        (w: World) => step(w, 1, { ...idle, revive: true, fire: 'bolt' }),
        (w: World) => step(w, 1, { ...idle, revive: true, dash: true }),
    ]) {
        const { w, e } = arena(); w.actors[1].hp = 0; w.enemyStates.get(2)!.recovery = 100;
        holdRevive(w, 60); assert.ok(e.revives.get(0)); interrupt(w); assert.equal(e.revives.size, 0); assert.equal(w.actors[1].hp, 0);
    }
    const { w, e } = arena(false); w.actors[0].hp = 0; holdRevive(w, 180);
    assert.equal(e.phase, 'defeated'); assert.equal(w.actors[0].hp, 0);
});

test('an actual enemy hit interrupts revive progress despite ward absorption', () => {
    const { w, e } = arena(); w.actors[1].hp = 0; w.actors[0].ward = 100;
    w.enemyStates.get(2)!.recovery = 100; holdRevive(w, 60);
    w.cast(w.actors[2], 'slash', w.actors[0]);
    let interrupted = false;
    for (let i = 0; i < 30; i++) { holdRevive(w, 1); if (!e.revives.has(0)) { interrupted = true; break; } }
    assert.ok(interrupted); assert.equal(w.actors[1].hp, 0); assert.ok(w.actors[0].ward < 100);
});

test('leash cancels windups and projectiles, returns enemies and resets their health without healing players or terrain', () => {
    const { w, e } = arena(true, 2); w.actors[0].hp = 123; w.actors[1].hp = 0; w.actors[3].hp = 0;
    step(w); w.cast(w.actors[0], 'nova', w.actors[2]);
    w.terrain({ x: 232, y: 256 }, 10, 300); const terrain = w.saveTerrain();
    w.actors[2].hp = 30; w.actors[2].x = 390;
    step(w); assert.equal(e.phase, 'returning'); assert.equal(w.casts.length + w.telegraphs.length, 0);
    assert.equal(w.cast(w.actors[0], 'nova', w.actors[2]), false);
    for (let i = 0; i < 600 && e.phase === 'returning'; i++) step(w);
    assert.equal(e.phase, 'active'); assert.equal(e.attempt, 2); assert.equal(w.actors[2].hp, 400); assert.equal(w.actors[2].x, 260);
    assert.equal(w.actors[3].hp, 400, 'leash resets the whole authored enemy roster, including defeated enemies');
    assert.equal(w.actors[0].hp, 123); assert.equal(w.actors[1].hp, 0); assert.equal(w.saveTerrain(), terrain);
});

test('disengagement has a grace window and collision-blocked returns have a bounded fallback', () => {
    const { w, e } = arena(); w.actors.slice(0, 2).forEach(a => { a.x = 20; a.y = 20; });
    step(w, 179); assert.equal(e.attempt, 1);
    step(w, 1); assert.equal(e.attempt, 2); // Already home: return/reset may finish in this step.
    w.actors[0].x = 232; w.actors[0].y = 256;
    w.actors[2].x = 390;
    const originalMove = w.move.bind(w); w.move = () => {};
    step(w); assert.equal(e.phase, 'returning'); step(w, 480);
    assert.equal(e.phase, 'active'); assert.equal(w.actors[2].x, 260);
    w.move = originalMove;
});

test('terminal retry restores resources and safe positions, preserves scars and is not replayable in a later epoch', () => {
    const { w, e, authority, generation } = arena();
    w.terrain(w.actors[0], 15, 1000); const terrain = w.saveTerrain();
    w.actors.slice(0, 2).forEach(a => { a.hp = 0; a.qi = 0; }); authority.step();
    const command = { generation, round: e.epoch };
    assert.equal(authority.retry('a', command).accepted, true); assert.equal(e.attempt, 2);
    assert.equal(authority.retry('a', command).accepted, false); assert.equal(e.attempt, 2);
    assert.equal(w.saveTerrain(), terrain); assert.ok(w.actors.every(a => a.hp === a.maxHp && a.qi === 100));
    assert.ok(w.actors.every(a => a.z >= w.coverTop(a.x, a.y) + 2));
    assert.equal(authority.retry('unknown', { generation, round: e.epoch }).accepted, false);
    assert.equal(authority.retry('a', { generation, round: e.epoch, hp: 999 }).accepted, false);
    assert.equal(authority.retry('a', { generation, round: e.epoch }).accepted, false, 'active encounter cannot be healed by retry');
});

test('attempt boundaries expire queued actions, clear motion and reject late old-round commands', () => {
    const { w, e, authority, generation } = arena(); const old = e.epoch;
    assert.equal(authority.submit('a', { generation, sequence: 1, actorId: 0, round: old, input: { ...idle, move: { x: 1, y: 0 } } }).accepted, true);
    for (let sequence = 1; sequence <= 2; sequence++) assert.equal(authority.submitAction('a', {
        generation, sequence, actorId: 0, round: old, input: { ...idle, fire: 'nova' },
    }).accepted, true);
    w.actors.slice(0, 2).forEach(a => { a.hp = 0; }); authority.step();
    assert.equal(authority.receipt('a').actionApplied, 2);
    assert.ok(authority.receipt('a').outcomes!.some(o => o.status === 'expired'));
    authority.retry('a', { generation, round: e.epoch }); const x = w.actors[0].x;
    assert.deepEqual(authority.submitAction('a', { generation, sequence: 3, actorId: 0, round: old, input: { ...idle, fire: 'nova' } }), { accepted: false, reason: 'wrong-round' });
    authority.step(); assert.equal(w.casts.length, 0); assert.equal(w.actors[0].x, x);
    assert.equal(authority.submit('a', { generation, sequence: 2, actorId: 0, round: old, input: idle }).accepted, false);
    assert.equal(authority.submitAction('a', { generation, sequence: 3, actorId: 0, round: e.epoch, input: { ...idle, fire: 'nova' } }).accepted, true);
    authority.step(); assert.equal(w.casts.length, 1);
    const box = new ActionOutbox(); box.enqueue({ ...idle, fire: 'bolt' }, 999, old);
    box.reset(authority.receipt('a')); box.enqueue({ ...idle, fire: 'slash' }, 999, e.epoch);
    assert.equal(box.next!.sequence, 4); assert.equal(box.next!.round, e.epoch);
});

test('revive needs fresh host input; disconnect cancels channel and reconnect never revives', () => {
    const { w, e, authority, generation } = arena(); w.actors[1].hp = 0; w.enemyStates.get(2)!.recovery = 100;
    authority.submit('a', { generation, sequence: 1, actorId: 0, round: e.epoch, input: { ...idle, revive: true } });
    authority.step(); assert.ok(e.revives.has(0)); authority.disconnect('a'); authority.step(); assert.equal(e.revives.size, 0);
    authority.disconnect('b'); authority.connect('b2', 1); assert.equal(w.actors[1].hp, 0);
    assert.deepEqual([...e.participants], [0, 1]);
});

test('lifecycle content fields and snapshot state reject invalid values atomically', () => {
    for (const key of ['leash', 'disengage', 'returnTimeout', 'reviveRange', 'reviveSeconds']) {
        const c = structuredClone(DEFAULT_CONTENT) as any; c.encounters[1].rules[key] = Infinity;
        assert.throws(() => validateContent(c), /Invalid content/);
    }
    const { w, e } = arena(); w.actors[1].hp = 0; w.enemyStates.get(2)!.recovery = 100; holdRevive(w, 20);
    const frame = captureDisplayFrame(w, 20, { received: 0, applied: 0 }); validateDisplayFrame(frame);
    const replica = new ReplicaClient('life'), stream = new ReplicationStream(w, 'life', () => frame);
    for (let i = 0; i < 50; i++) if (replica.apply(stream.reply(replica.request())) === 'committed') break;
    assert.deepEqual(replica.state!.encounter, e.view());
    const page = stream.reply(replica.request()), before = structuredClone(replica.state);
    for (const change of [
        (f: any) => { f.encounter.epoch = 0; }, (f: any) => { f.encounter.phase = 'bad'; },
        (f: any) => { f.encounter.participants = [0, 0]; }, (f: any) => { f.encounter.revives[0].targetId = 2; },
        (f: any) => { f.encounter.revives[0].progress = NaN; }, (f: any) => { f.encounter.phase = 'defeated'; },
        (f: any) => { f.encounter.attempt = -1; }, (f: any) => { delete f.encounter; }, (f: any) => { f.encounter = null; },
    ]) {
        const invalid = structuredClone(frame); change(invalid);
        assert.throws(() => replica.apply({ ...page, state: invalid }), /Invalid state frame/); assert.deepEqual(replica.state, before);
    }
});

test('prediction pauses during return and neither movement replay nor interpolation crosses a reset epoch', () => {
    const { w, e, authority, generation } = arena();
    const predictor = new MotionPredictor(0), remote = new RemoteInterpolator();
    const capture = (tick: number) => captureDisplayFrame(w, tick, authority.receipt('a'));
    predictor.setTerrain(w.cells); predictor.reconcile(capture(1), 0); remote.push(capture(1));
    w.actors[0].x = 300; remote.push(capture(2));
    w.actors[2].x = 390; authority.step(); assert.equal(e.phase, 'returning');
    predictor.reconcile(capture(3), predictor.tick);
    const x = predictor.actor!.x;
    for (let i = 0; i < 10; i++) predictor.advance({ ...idle, move: { x: 1, y: 0 } });
    assert.equal(predictor.actor!.x, x);
    w.actors.slice(0, 2).forEach(a => { a.hp = 0; }); authority.step();
    authority.retry('a', { generation, round: e.epoch });
    const reset = capture(20); predictor.reconcile(reset, predictor.tick); remote.push(reset);
    assert.equal(predictor.historySize, 0); assert.equal(predictor.actor!.x, 232);
    assert.equal(remote.sample(20).find(a => a.id === 0)!.x, 232);
});

test('an action received during return cannot fire on the exact return-completion tick', () => {
    const { w, e, authority, generation } = arena();
    w.actors[2].x = 390; w.move = () => {};
    step(w); assert.equal(e.phase, 'returning'); step(w, 478);
    const old = e.epoch;
    assert.equal(authority.submitAction('a', { generation, sequence: 1, actorId: 0, round: old, input: { ...idle, fire: 'nova' } }).accepted, true);
    authority.step(); assert.equal(e.phase, 'active'); assert.ok(e.epoch > old);
    assert.equal(w.casts.length, 0); assert.equal(w.actors[0].qi, 100);
});

test('maximum-roster lifecycle frames remain bounded during sixty seconds of active combat', () => {
    const content = structuredClone(DEFAULT_CONTENT) as any;
    content.encounters[1].spawns = [{ enemyId: 'ruin-skirmisher', count: 6, x: 260, y: 256, altitude: 5 }];
    const w = new World(content, SKIRMISH_ENCOUNTER, true), authority = new SessionAuthority(w, [0, 1]);
    authority.connect('a', 0); authority.connect('b', 1);
    w.actors.slice(0, 2).forEach(a => { a.hp = a.maxHp = 1e9; }); // Diagnostic sustain only.
    for (let i = 0; i < 3600; i++) {
        authority.step();
        if (i % 3 === 0) {
            const frame = captureDisplayFrame(w, authority.tick, authority.receipt('a')); validateDisplayFrame(frame);
            assert.ok(Buffer.byteLength(JSON.stringify(frame)) < 64 * 1024);
            assert.ok(frame.telegraphs.length <= 6); assert.ok(frame.encounter!.revives.length <= 2);
        }
    }
    assert.equal(w.encounter!.phase, 'active'); assert.equal(w.encounter!.attempt, 1);
    assert.ok(w.actors.slice(0, 2).some(a => a.hp < 1e9));
});
