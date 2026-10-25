import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim.ts';
import { targetInRange, LOCK_RANGE } from '../src/targeting.ts';

test('bolts, crescents and nova spare co-located allies while damaging the common enemy', () => {
    for (const fire of ['bolt', 'slash', 'nova'] as const) {
        const w = new World(); w.ai = false;
        w.cells.forEach(c => Object.assign(c, { hp: 0, max: 0, kind: 0, depth: 0, elevation: 0 }));
        const [a, ally] = w.actors;
        Object.assign(a, { x: 100, y: 100, z: 4, team: 1, ward: 0 });
        Object.assign(ally, { x: 112, y: 100, z: 4, team: 1, ward: 0 });
        const enemy = w.actor(2, 112, 100);
        Object.assign(enemy, { z: 4, team: 2, hp: 3000, maxHp: 3000, ward: 0 }); w.actors.push(enemy);
        assert.equal(targetInRange(a, ally, LOCK_RANGE), false);
        assert.equal(targetInRange(a, enemy, LOCK_RANGE), true);
        const idle = { move: { x: 0, y: 0 }, aim: { x: 112, y: 100, z: 4.7, targetId: 2 } };
        w.stepPlayers(new Map([[0, { ...idle, fire }], [1, idle]]));
        for (let i = 0; i < 180; i++) w.stepPlayers(new Map([[0, idle], [1, idle]]));
        assert.equal(ally.hp, 500, fire); assert.ok(enemy.hp < 3000, fire);
    }
});
