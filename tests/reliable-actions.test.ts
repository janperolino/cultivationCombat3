import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/sim.ts';
import type { ActorInput } from '../src/sim.ts';
import { SessionAuthority, MAX_PENDING_ACTIONS } from '../src/session-authority.ts';
import { ActionOutbox } from '../src/client-actions.ts';

const input = { move: { x: 0, y: 0 }, aim: { x: 256, y: 256 }, fire: 'bolt' as const, dash: true };
function setup() {
    const w = new World(), a = new SessionAuthority(w, [0, 1]), generation = a.connect('a', 0);
    const action = (sequence: number, body: ActorInput = input) => ({ generation, sequence, actorId: 0, input: body });
    return { w, a, generation, action };
}
test('lost action reply and newer neutral motion cannot erase or duplicate a consumed cast/dodge', () => {
    const { w, a, generation, action } = setup();
    assert.equal(a.submitAction('a', action(1)).accepted, true);
    assert.equal(a.submit('a', { generation, sequence: 1, actorId: 0, input: { move: input.move, aim: input.aim } }).accepted, true);
    assert.equal(a.submitAction('a', action(1)).accepted, true);
    a.step(); assert.equal(w.bolts.length, 5); assert.ok(w.actors[0].dashLeft > 0);
    w.actors[0].cool.fill(0); w.actors[0].dashLeft = 0; w.actors[0].dashCool = 0;
    const qi = w.actors[0].qi;
    assert.equal(a.submitAction('a', action(1)).accepted, true); a.step();
    assert.equal(w.bolts.length, 5); assert.equal(w.actors[0].dashLeft, 0); assert.ok(w.actors[0].qi > qi);
    assert.deepEqual(a.receipt('a').outcomes, [{ sequence: 1, status: 'consumed' }]);
});
test('action stream validates gaps, identity, payload conflicts and bounded queue without poisoning retries', () => {
    const { a, action } = setup();
    assert.equal(a.submitAction('a', action(2)).accepted, false);
    assert.equal(a.submitAction('missing', action(1)).accepted, false);
    assert.equal(a.submitAction('a', { ...action(1), actorId: 1 }).accepted, false);
    assert.equal(a.submitAction('a', { ...action(1), input: { ...input, hp: 9000 } }).accepted, false);
    assert.equal(a.submitAction('a', action(1)).accepted, true);
    assert.deepEqual(a.submitAction('a', action(1, { ...input, fire: 'nova' })), { accepted: false, reason: 'action-conflict' });
    for (let seq = 2; seq <= 4; seq++) assert.equal(a.submitAction('a', action(seq)).accepted, true);
    assert.equal(a.submitAction('a', action(5)).accepted, false);
    assert.ok(MAX_PENDING_ACTIONS <= 16);
});
test('cooldown and death block effects while actions are explicitly consumed; reconnect discards queued intent', () => {
    const { w, a, action } = setup();
    w.actors[0].hp = 0;
    a.submitAction('a', action(1)); a.step();
    assert.equal(w.bolts.length, 0); assert.equal(a.receipt('a').actionApplied, 1);
    w.actors[0].hp = 500; a.submitAction('a', action(2)); a.disconnect('a');
    const generation = a.connect('a', 0); a.step();
    assert.equal(w.bolts.length, 0); assert.equal(a.receipt('a').actionReceived, undefined);
    assert.equal(a.submitAction('a', action(1)).accepted, false);
    assert.equal(a.submitAction('a', { ...action(1), generation }).accepted, true);
});
test('outbox retains immutable retry head until consumed, bounds backlog and resets per generation', () => {
    const box = new ActionOutbox(), original = structuredClone(input);
    box.enqueue(original); original.aim.x = 0;
    assert.equal(box.next!.input.aim.x, 256);
    box.acknowledge({ received: 3, applied: 3, actionReceived: 1, actionApplied: 0 });
    assert.equal(box.size, 1);
    for (let i = 1; i < 16; i++) assert.equal(box.enqueue(input), true);
    assert.equal(box.enqueue(input), false);
    box.acknowledge({ received: 3, applied: 3, actionReceived: 1, actionApplied: 1 });
    assert.equal(box.next!.sequence, 2);
    assert.equal(new ActionOutbox().next, undefined);
});

test('absolute action deadline expires delayed intent without skipping the ordered receipt', () => {
    const { w, a, action } = setup();
    assert.equal(a.submitAction('a', { ...action(1), expiresTick: 0 }).accepted, true);
    a.step(); assert.equal(w.bolts.length, 0);
    assert.deepEqual(a.receipt('a').outcomes, [{ sequence: 1, status: 'expired' }]);
    assert.equal(a.submitAction('a', { ...action(1), expiresTick: 100 }).accepted, false);
    assert.equal(a.submitAction('a', action(2)).accepted, true); a.step();
    assert.equal(w.bolts.length, 5); assert.equal(a.receipt('a').actionApplied, 2);
});

test('flooded action backlog stays bounded and old deduplication IDs cannot execute after history rolls over', () => {
    const { w, a, action } = setup(); w.actors[0].hp = 0;
    let sequence = 1, sawFull = false;
    for (let tick = 0; tick < 25; tick++) {
        for (let i = 0; i < 4; i++) {
            const result = a.submitAction('a', action(sequence));
            if (result.accepted) sequence++;
            else if (result.reason === 'action-full') sawFull = true;
        }
        assert.ok((a.receipt('a').actionReceived ?? 0) - (a.receipt('a').actionApplied ?? 0) <= MAX_PENDING_ACTIONS);
        a.step();
    }
    assert.equal(sawFull, true);
    for (let i = 0; i < MAX_PENDING_ACTIONS; i++) a.step();
    assert.equal(a.receipt('a').actionApplied, sequence - 1);
    assert.ok(a.receipt('a').outcomes!.length <= 32);
    w.actors[0].hp = 500;
    assert.equal(a.submitAction('a', action(1)).accepted, true); a.step();
    assert.equal(w.bolts.length, 0);
});
