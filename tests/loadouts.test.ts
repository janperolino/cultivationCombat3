import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim.ts';
import { DEFAULT_CONTENT, SKIRMISH_ENCOUNTER, VOLLEY_LOADOUT, CRESCENT_LOADOUT, validateContent } from '../src/content.ts';
import { SessionAuthority } from '../src/session-authority.ts';
import { hostile, sameTeam } from '../src/teams.ts';
import { targetInRange } from '../src/targeting.ts';
import { captureDisplayFrame, validateDisplayFrame, ReplicaClient, ReplicationStream } from '../src/replication.ts';

const idle = { move: { x: 0, y: 0 }, aim: { x: 112, y: 100 } };
function arena(lifecycle = false) {
    const w = new World(DEFAULT_CONTENT, SKIRMISH_ENCOUNTER, lifecycle);
    w.cells.forEach(c => Object.assign(c, { hp: 0, max: 0, kind: 0, depth: 0, elevation: 0 }));
    w.actors.slice(2).forEach((a, i) => Object.assign(a, { x: 112 + 20 * i, y: 100, z: 5, hp: 3000, maxHp: 3000, ward: 0 }));
    w.enemyStates.forEach(s => { s.recovery = 100; }); // Isolate player loadout effects from enemy attacks.
    return w;
}
function step(w: World, n: number) { for (let i = 0; i < n; i++) w.stepPlayers(new Map()); }

test('host presets drive distinct real attack paths and unequipped casts spend nothing', () => {
    const w = arena(), [volley, crescent, enemy] = w.actors;
    assert.equal(volley.loadoutId, VOLLEY_LOADOUT); assert.equal(crescent.loadoutId, CRESCENT_LOADOUT);
    Object.assign(volley, { x: 100, y: 100, z: 5 }); Object.assign(crescent, { x: 100, y: 130, z: 5 });
    const v = w.content.loadouts.find(l => l.id === volley.loadoutId)!, c = w.content.loadouts.find(l => l.id === crescent.loadoutId)!;
    assert.equal(w.cast(volley, v.slots[0], { ...enemy, targetId: enemy.id }), true); assert.equal(w.bolts.length, 5);
    assert.equal(w.cast(crescent, c.slots[0], enemy), true); assert.equal(w.waves.length, 1);
    const resources = w.actors.slice(0, 2).map(a => ({ qi: a.qi, cool: [...a.cool] }));
    assert.equal(w.cast(volley, 'slash', enemy), false); assert.equal(w.cast(crescent, 'bolt', enemy), false);
    assert.deepEqual(w.actors.slice(0, 2).map(a => ({ qi: a.qi, cool: [...a.cool] })), resources);
    step(w, 180); assert.ok(enemy.hp < 3000);
    for (const a of [volley, crescent]) assert.equal(w.cast(a, 'nova', enemy), true);
});

test('preset volleys acquire guidance while preset crescents keep their committed trajectory', () => {
    const w = arena(), [volley, crescent, enemy] = w.actors;
    Object.assign(volley, { x: 100, y: 100, z: 5 }); Object.assign(crescent, { x: 100, y: 140, z: 5 });
    Object.assign(enemy, { x: 160, y: 100, z: 5 });
    w.cast(volley, 'bolt', { ...enemy, targetId: 2, locked: true });
    step(w, 16); assert.ok(w.bolts.some(b => b.guided));
    enemy.y = 108; step(w, 120); assert.ok(enemy.hp < 3000, 'guided volley damages the displaced target');
    w.cast(crescent, 'slash', { ...enemy, targetId: 2 });
    const angle = w.waves[0].angle; enemy.y += 20; step(w, 1);
    assert.equal(w.waves[0].angle, angle);
});

test('both preset primaries and shared nova spare co-located allies while damaging enemies', () => {
    for (const [actorId, kind] of [[0, 'bolt'], [1, 'slash'], [0, 'nova'], [1, 'nova']] as const) {
        const w = arena(), actor = w.actors[actorId], ally = w.actors[1 - actorId], enemy = w.actors[2];
        Object.assign(actor, { x: 100, y: 100, z: 5 }); Object.assign(ally, { x: 112, y: 100, z: 5, ward: 0 });
        assert.equal(targetInRange(actor, ally, 220), false); assert.equal(targetInRange(actor, enemy, 220), true);
        assert.equal(w.cast(actor, kind, { ...enemy, z: 5.7, targetId: 2 }), true); step(w, 180);
        assert.equal(ally.hp, 500); assert.ok(enemy.hp < 3000, `${actorId}/${kind}`);
    }
});

test('team rules explicitly preserve undefined-team sparring and equal-team ally protection', () => {
    for (const [aTeam, bTeam, expected] of [[undefined, undefined, true], [1, undefined, true], [undefined, 1, true], [1, 2, true], [1, 1, false], [0, 0, false]] as const) {
        const w = new World(); w.ai = false; const [a, b] = w.actors; a.team = aTeam; b.team = bTeam;
        assert.equal(hostile(a, b), expected); assert.equal(sameTeam(a, b), !expected);
        assert.equal(w.canDamage(a.id, b), expected); assert.equal(targetInRange(a, b, 220), expected);
        assert.equal(w.canDamage(a.id, a), false); assert.equal(targetInRange(a, a, 220), false);
    }
    const solo = new World(); assert.equal(solo.actors[0].loadoutId, undefined);
    for (const kind of ['bolt', 'slash', 'nova'] as const) assert.equal(solo.techniqueEquipped(solo.actors[0], kind), true);
});

test('friendly health protection does not protect terrain from either preset', () => {
    for (const actorId of [0, 1]) {
        const w = arena(), actor = w.actors[actorId], ally = w.actors[1 - actorId];
        Object.assign(actor, { x: 100, y: 100, z: 1 }); Object.assign(ally, { x: 112, y: 100, z: 1, ward: 0 });
        const index = 25 * 128 + 28; Object.assign(w.cells[index], { kind: 1, hp: 55, max: 55 });
        w.cast(actor, 'nova', { x: 112, y: 100 }); step(w, 60);
        assert.equal(ally.hp, 500); assert.ok(w.cells[index].depth > 0); assert.equal(w.cells[index].hp, 0);
    }
});

test('content rejects malformed presets/assignments before constructing actors and freezes slot copies', () => {
    let created = 0;
    class ObservedWorld extends World { override actor(id: number, x: number, y: number) { created++; return super.actor(id, x, y); } }
    for (const change of [
        (c: any) => { c.loadouts = []; }, (c: any) => { c.loadouts.push(c.loadouts[0]); },
        (c: any) => { c.loadouts[0].slots[0] = null; }, (c: any) => { c.loadouts[0].slots[1] = 'bolt'; },
        (c: any) => { c.loadouts[0].slots[0] = 'bad'; }, (c: any) => { c.loadouts[0].slots[2] = NaN; },
        (c: any) => { c.loadouts[0].slots = ['bolt', null]; }, (c: any) => { c.loadouts[0].slots = ['bolt', null, null]; },
        (c: any) => { c.loadouts[0].name = 'x'.repeat(41); }, (c: any) => { c.loadouts[0].name = '\n'; },
        (c: any) => { c.loadouts[0].id = ''; }, (c: any) => { c.encounters[1].playerLoadouts[0] = 'missing'; },
        (c: any) => { c.encounters[1].playerLoadouts.pop(); },
        (c: any) => { c.loadouts = Array.from({ length: 33 }, (_, i) => ({ ...c.loadouts[0], id: `preset-${i}` })); },
    ]) {
        const c = structuredClone(DEFAULT_CONTENT); change(c);
        assert.throws(() => new ObservedWorld(c, SKIRMISH_ENCOUNTER, true), /Invalid content/);
    }
    assert.equal(created, 0);
    const c = structuredClone(DEFAULT_CONTENT) as any, w = new World(c, SKIRMISH_ENCOUNTER);
    c.loadouts[0].slots[0] = 'slash'; c.encounters[1].playerLoadouts.reverse();
    assert.ok(Object.isFrozen(w.content.loadouts[0].slots)); assert.equal(w.content.loadouts[0].slots[0], 'bolt');
    assert.equal(w.actors[0].loadoutId, VOLLEY_LOADOUT); assert.equal(validateContent(DEFAULT_CONTENT).loadouts.length, 2);
});

test('retry restores host-swapped seat presets, while revive and leash preserve player presets', () => {
    const c = structuredClone(DEFAULT_CONTENT) as any; c.encounters[1].playerLoadouts.reverse();
    const w = new World(c, SKIRMISH_ENCOUNTER, true), authority = new SessionAuthority(w, [0, 1]);
    const generation = authority.connect('a', 0); authority.connect('b', 1);
    assert.equal(w.actors[0].loadoutId, CRESCENT_LOADOUT);
    Object.assign(w.actors[1], { x: w.actors[0].x + 3, y: w.actors[0].y, z: w.actors[0].z, hp: 0 });
    w.enemyStates.forEach(s => { s.recovery = 100; });
    for (let i = 0; i < 120; i++) w.stepPlayers(new Map([[0, { ...idle, revive: true }]]));
    assert.equal(w.actors[1].hp, 250); assert.equal(w.actors[1].loadoutId, VOLLEY_LOADOUT);
    w.actors[0].loadoutId = 'unauthorized'; w.actors[0].team = 9;
    w.actors.slice(0, 2).forEach(a => { a.hp = 0; }); authority.step();
    assert.equal(authority.retry('a', { generation, round: w.encounter!.epoch }).accepted, true);
    assert.equal(w.actors[0].loadoutId, CRESCENT_LOADOUT); assert.equal(w.actors[0].team, 1);
    assert.equal(w.actors[1].loadoutId, VOLLEY_LOADOUT);
    assert.equal(w.techniqueEquipped(w.actors[0], 'slash'), true); assert.equal(w.techniqueEquipped(w.actors[0], 'bolt'), false);
    w.actors[2].x = 500; authority.step(); assert.equal(w.encounter!.phase, 'returning');
    for (let i = 0; i < 600 && w.encounter!.phase === 'returning'; i++) authority.step();
    assert.equal(w.encounter!.phase, 'active'); assert.equal(w.actors[0].loadoutId, CRESCENT_LOADOUT); assert.equal(w.actors[1].loadoutId, VOLLEY_LOADOUT);
});

test('replicated display presets are bounded, host-authored and reject malformed data atomically', () => {
    const content = structuredClone(DEFAULT_CONTENT) as any;
    content.loadouts[0].name = 'Host test variant'; content.loadouts[0].slots = ['slash', 'bolt', 'nova'];
    const w = new World(content, SKIRMISH_ENCOUNTER);
    const capture = () => captureDisplayFrame(w, 0, { received: 0, applied: 0 });
    const stream = new ReplicationStream(w, 'presets', capture), replica = new ReplicaClient('presets');
    for (let i = 0; i < 50; i++) if (replica.apply(stream.reply(replica.request())) === 'committed') break;
    assert.equal(replica.state!.loadouts[0].name, 'Host test variant'); assert.equal(replica.state!.loadouts[0].slots[0], 'slash');
    const before = structuredClone(replica.state), page = stream.reply(replica.request());
    for (const change of [
        (f: any) => { f.actors[0].loadoutId = 'missing'; }, (f: any) => { f.actors[2].loadoutId = VOLLEY_LOADOUT; },
        (f: any) => { f.loadouts[0].slots[0] = 'bad'; }, (f: any) => { f.loadouts[0].name = 'x'.repeat(1000); },
        (f: any) => { f.loadouts[1] = f.loadouts[0]; }, (f: any) => { f.loadouts.push(f.loadouts[0]); },
        (f: any) => { delete f.loadouts; },
    ]) {
        const frame = capture(); change(frame);
        assert.throws(() => validateDisplayFrame(frame), /Invalid state frame/);
        assert.throws(() => replica.apply({ ...page, state: frame }), /Invalid state frame/);
        assert.deepEqual(replica.state, before);
    }
});
