import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, GRID } from '../src/sim.ts';
import { SessionAuthority } from '../src/session-authority.ts';
import { ReplicaClient, ReplicationStream, CELLS_PER_PAGE, MAX_PACKET_BYTES, serializePage } from '../src/replication.ts';
import type { DisplayFrame, StatePage } from '../src/replication.ts';

function setup() {
    const world = new World(), authority = new SessionAuthority(world, [0, 1]);
    const generation = authority.connect('alice', 0);
    const capture = (): DisplayFrame => ({ tick: authority.tick, time: world.time, revision: world.revision,
        destroyed: world.destroyed, actors: world.actors, bolts: [], waves: [], casts: [], droppedTime: 0,
        receipt: authority.receipt('alice') });
    const stream = new ReplicationStream(world, 'session', capture), client = new ReplicaClient('session');
    return { world, authority, generation, stream, client };
}
function transfer(stream: ReplicationStream, client: ReplicaClient) {
    const pages: StatePage[] = [];
    for (let i = 0; i < 65; i++) {
        const page = stream.reply(client.request());
        const json = serializePage(page);
        assert.ok(Buffer.byteLength(json) <= MAX_PACKET_BYTES);
        assert.ok(page.cells.length <= CELLS_PER_PAGE);
        pages.push(page);
        if (client.apply(JSON.parse(json)) === 'committed') return pages;
    }
    throw new Error('Transfer exceeded whole-world page bound');
}

test('late join reconstructs every field of every damaged terrain cell in bounded pages', () => {
    const { world, stream, client } = setup();
    world.terrain({ x: 256, y: 256 }, 600, 5000);
    const pages = transfer(stream, client);
    assert.equal(pages.length, GRID * GRID / CELLS_PER_PAGE);
    assert.ok(pages.every(p => p.kind === 'snapshot'));
    assert.deepEqual(client.cells, world.cells);
    assert.equal(client.revision, world.revision);
    assert.equal(client.state?.destroyed, world.destroyed);
    assert.equal(client.syncing, false);
});

test('snapshot is atomic and mutations while paging arrive in the next delta', () => {
    const { world, stream, client } = setup();
    const first = stream.reply(client.request()); client.apply(first);
    assert.equal(client.cells.length, 0); assert.equal(client.state, undefined);
    world.terrain({ x: 232, y: 256 }, 8, 300);
    transfer(stream, client);
    assert.equal(client.revision, 0);
    assert.ok(client.cells.some((c, i) => c.depth !== world.cells[i].depth));
    const delta = transfer(stream, client);
    assert.equal(delta[0].kind, 'delta'); assert.equal(delta[0].baseRevision, 0);
    assert.deepEqual(client.cells, world.cells);
});

test('sparse/repeated mutations coalesce to absolute cell values without duplicate excavation', () => {
    const { world, stream, client } = setup(); transfer(stream, client);
    world.terrain({ x: 232, y: 256 }, 8, 300);
    world.terrain({ x: 232, y: 256 }, 8, 300);
    const pages = transfer(stream, client);
    assert.equal(pages.length, 1);
    assert.ok(pages[0].cells.length < CELLS_PER_PAGE);
    const before = structuredClone(client.cells);
    assert.equal(client.apply(pages[0]), 'ignored');
    assert.deepEqual(client.cells, before);
    assert.deepEqual(client.cells, world.cells);
    const idle = transfer(stream, client);
    assert.equal(idle[0].cells.length, 0);
    assert.equal(idle[0].revision, world.revision);
});

test('lost page and lost acknowledgment retry identical pinned data, never a mutable reference', () => {
    const { stream, client, world } = setup();
    const first = stream.reply(client.request());
    world.terrain({ x: 4, y: 4 }, 10, 200);
    assert.deepEqual(stream.reply(client.request()), first);
    client.apply(first);
    const second = stream.reply(client.request());
    assert.deepEqual(stream.reply(client.request()), second);
    first.cells[0][4] = 999; // Caller cannot corrupt the server's retained response.
    client.apply(second);
    transfer(stream, client); transfer(stream, client);
    assert.deepEqual(client.cells, world.cells);
});

test('page/ack gaps and reordering recover with a new sync generation; old packets cannot roll back', () => {
    const { stream, client, world } = setup();
    const old = stream.reply(client.request());
    assert.throws(() => client.apply({ ...old, sequence: 2 }));
    assert.throws(() => stream.reply({ ...client.request(), ack: 5 }));
    client.reset();
    assert.equal(client.ready, false);
    assert.equal(client.apply(old), 'ignored');
    assert.throws(() => stream.reply({ ...client.request(), ack: 1 }));
    world.terrain({ x: 30, y: 30 }, 7, 400);
    transfer(stream, client);
    assert.deepEqual(client.cells, world.cells);
    const request = client.request();
    assert.throws(() => stream.reply({ ...request, syncId: request.syncId - 1 }));
});

test('protocol/session/schema failures and malformed cells leave committed terrain untouched', () => {
    const { stream, client } = setup(); transfer(stream, client);
    const before = client.cells, revision = client.revision, request = client.request();
    for (const change of [{ protocol: 999 }, { sessionId: 'old' }, { schema: 'wrong' }, { syncId: -1 }, { ack: NaN }]) {
        assert.throws(() => stream.reply({ ...request, ...change }));
    }
    const page = stream.reply(request);
    assert.throws(() => client.apply({ ...page, padding: 'x'.repeat(MAX_PACKET_BYTES) } as StatePage));
    for (const change of [{ protocol: 999 }, { sessionId: 'old' }, { schema: 'wrong' },
        { baseRevision: 999 }, { revision: -1 }, { cells: [[0, 0, 0, 0, NaN, 0]], total: 1 },
        { cells: new Array(CELLS_PER_PAGE + 1).fill([0, 0, 0, 0, 0, 0]), total: CELLS_PER_PAGE + 1 }]) {
        assert.throws(() => client.apply({ ...page, ...change } as StatePage));
        assert.equal(client.cells, before); assert.equal(client.revision, revision);
    }
    assert.equal(client.apply(page), 'committed');
});

test('incomplete/duplicated snapshot indices and mismatched continuation are rejected atomically', () => {
    const { stream, client } = setup();
    const first = stream.reply(client.request());
    const bad = structuredClone(first); bad.cells[1][0] = 0;
    assert.throws(() => client.apply(bad));
    client.apply(first);
    const next = stream.reply(client.request());
    for (const change of [{ offset: 0 }, { total: 3 }, { revision: 10 }, { final: true }]) {
        assert.throws(() => client.apply({ ...next, ...change }));
    }
    assert.equal(client.cells.length, 0);
    client.apply(next); transfer(stream, client);
    assert.equal(client.cells.length, GRID * GRID);
});

test('large delta remains atomic across many pages while newer damage waits for following transfer', () => {
    const { world, stream, client } = setup(); transfer(stream, client);
    const pristine = structuredClone(client.cells);
    world.terrain({ x: 256, y: 256 }, 600, 300);
    const damaged = structuredClone(world.cells), revision = world.revision;
    client.apply(stream.reply(client.request()));
    assert.deepEqual(client.cells, pristine);
    assert.equal(client.ready, true); // Terrain paging must not pause an established command stream.
    world.terrain({ x: 232, y: 256 }, 20, 300);
    transfer(stream, client);
    assert.deepEqual(client.cells, damaged); assert.equal(client.revision, revision);
    transfer(stream, client);
    assert.deepEqual(client.cells, world.cells);
});

test('command receipts distinguish intake from consumption and survive a superseded input slot', () => {
    const { authority, generation, stream, client } = setup();
    const command = (sequence: number) => ({ generation, sequence, actorId: 0,
        input: { move: { x: 0, y: 0 }, aim: { x: 300, y: 256 } } });
    authority.submit('alice', command(1)); authority.submit('alice', command(2));
    assert.deepEqual(authority.receipt('alice'), { received: 2, applied: 0 });
    transfer(stream, client);
    assert.deepEqual(client.state?.receipt, { received: 2, applied: 0 });
    authority.step(); transfer(stream, client);
    assert.deepEqual(client.state?.receipt, { received: 2, applied: 2 });
    assert.equal(authority.submit('alice', command(1)).accepted, false);
    assert.deepEqual(authority.receipt('alice'), { received: 2, applied: 2 });
    const page = stream.reply(client.request());
    assert.throws(() => client.apply({ ...page, state: { ...page.state!, tick: 0 } }));
    assert.throws(() => client.apply({ ...page, state: { ...page.state!, receipt: { received: 1, applied: 1 } } }));
});
