import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { ReplicaClient } from '../src/replication.ts';
import { createSpikeServer, BODY_LIMIT, LEASE_MS, RECOVERY_MS } from '../server/spike-server.mjs';

async function host(t, options = {}) {
    const app = createSpikeServer({ autoTick: false, ...options });
    app.server.listen(0, '127.0.0.1');
    await once(app.server, 'listening');
    t.after(async () => {
        const closed = once(app.server, 'close');
        app.server.close(); app.server.closeAllConnections(); await closed;
    });
    const base = `http://127.0.0.1:${app.server.address().port}`;
    async function api(path, connection, body, headers = {}) {
        const response = await fetch(`${base}/api/${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { ...(connection ? { Authorization: `Bearer ${connection.token}` } : {}),
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
            body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
        });
        return { status: response.status, data: await response.json() };
    }
    async function join() {
        const result = await api('join', undefined, {});
        assert.equal(result.status, 200); return result.data;
    }
    const submit = (c, sequence, input, overrides = {}) => api('command', c, {
        sessionId: c.sessionId,
        command: { generation: c.generation, sequence, actorId: c.actorId, input, ...overrides },
    });
    const replicas = new Map();
    async function observe(c) {
        const key = c?.token ?? '';
        if (!replicas.has(key)) replicas.set(key, new ReplicaClient(c?.sessionId ?? 'missing'));
        const replica = replicas.get(key);
        for (let page = 0; page < 66; page++) {
            const result = await api('sync', c, replica.request());
            if (result.status !== 200) return result;
            if (replica.apply(result.data) === 'committed') return { status: 200, data: { ...replica.state, cells: replica.cells } };
        }
        throw new Error('Transfer did not finish within bounded page count');
    }
    return { ...app, base, api, join, submit, observe };
}
const idle = { move: { x: 0, y: 0 }, aim: { x: 280, y: 256 } };

test('HTTP reliable action retries survive newer motion and recovery rejects old action generations', async t => {
    const h = await host(t), c = await h.join();
    const body = { sessionId: c.sessionId, command: { generation: c.generation, sequence: 1, actorId: c.actorId, input: { ...idle, fire: 'bolt', dash: true } } };
    assert.equal((await h.api('action', c, body)).status, 200); // Pretend reply was lost.
    await h.submit(c, 1, idle);
    assert.equal((await h.api('action', c, body)).status, 200);
    h.step(); assert.equal(h.world.bolts.length, 5);
    const qi = h.world.actors[0].qi;
    h.world.actors[0].cool.fill(0); h.world.actors[0].dashCool = 0; h.world.actors[0].dashLeft = 0;
    assert.equal((await h.api('action', c, body)).data.receipt.actionApplied, 1);
    h.step(); assert.equal(h.world.bolts.length, 5); assert.ok(h.world.actors[0].qi > qi);
    const next = (await resume(h, c)).data;
    assert.equal((await h.api('action', c, body)).status, 401);
    assert.equal((await h.api('action', next, body)).status, 422);
});

test('HTTP assigns separate bearer identities to two seats and both observe identical ticks', async t => {
    const h = await host(t), a = await h.join(), b = await h.join();
    assert.equal(a.actorId, 0); assert.equal(b.actorId, 1);
    assert.notEqual(a.token, b.token); assert.notEqual(a.generation, b.generation);
    assert.equal((await h.api('join', undefined, {})).status, 409);
    assert.equal((await h.observe()).status, 401);
    assert.equal((await h.observe({ token: 'made-up' })).status, 401);
    h.step();
    const first = await h.observe(a), second = await h.observe(b);
    assert.equal(first.status, 200); assert.deepEqual(first.data, second.data);
    assert.equal(first.data.tick, 1);
    assert.equal((await h.api('join', undefined, { actorId: 0 })).status, 400);
});

test('HTTP authority moves two clients, casts, and exposes shared damage/terrain to a late observer', async t => {
    let clock = 0;
    const h = await host(t, { now: () => clock }), a = await h.join(), b = await h.join();
    const x = h.world.actors[0].x, y = h.world.actors[1].y;
    for (let seq = 1; seq <= 6; seq++) {
        assert.equal((await h.submit(a, seq, { ...idle, move: { x: -1, y: 0 }, climb: 1 })).status, 200);
        assert.equal((await h.submit(b, seq, { ...idle, move: { x: 0, y: 1 }, autoAltitude: true })).status, 200);
        for (let i = 0; i < 5; i++) h.step();
    }
    assert.ok(h.world.actors[0].x < x); assert.ok(h.world.actors[1].y > y);
    assert.equal((await h.submit(a, 7, { ...idle, fire: 'bolt' })).status, 200);
    h.step();
    assert.equal((await h.observe(b)).data.bolts.length, 5);
    // Place the target near the aimed impact to isolate transport -> authority -> damage.
    const victim = h.world.actors[1];
    Object.assign(victim, { x: h.world.actors[0].x + 12, y: h.world.actors[0].y, z: 1, ward: 0, vx: 0, vy: 0 });
    const aim = { x: victim.x, y: victim.y };
    assert.equal((await h.submit(a, 8, { ...idle, fire: 'nova', aim })).status, 200);
    for (let i = 0; i < 120; i++) h.step();
    assert.ok(victim.hp < 500);
    assert.ok(h.world.revision > 0);
    const first = (await h.observe(a)).data, second = (await h.observe(b)).data;
    assert.deepEqual({ ...first, receipt: undefined }, { ...second, receipt: undefined }); assert.ok(first.cells.some(c => c.depth > 0));
    await h.api('leave', b, {});
    clock = 1001; // Separate the late-join transfer from the previous ingress window.
    const late = await h.join();
    const snapshot = (await h.observe(late)).data;
    assert.equal(snapshot.revision, first.revision);
    assert.deepEqual(snapshot.cells, first.cells);
    assert.equal(snapshot.actors[1].hp, victim.hp);
});

test('HTTP rejects ownership spoofing, replay, stale server IDs, malformed and oversized requests', async t => {
    const h = await host(t), a = await h.join();
    assert.equal((await h.submit(a, 1, idle, { actorId: 1 })).status, 422);
    assert.equal((await h.submit(a, 1, idle)).status, 200);
    assert.equal((await h.submit(a, 1, idle)).status, 422);
    assert.equal((await h.submit(a, 2, { ...idle, hp: 9000 })).status, 422);
    assert.equal((await h.api('command', a, { sessionId: 'old-host', command: {} })).status, 409);
    assert.equal((await h.api('command', a, '{broken')).status, 400);
    assert.equal((await h.api('command', a, 'x'.repeat(BODY_LIMIT + 1))).status, 413);
    assert.equal((await h.api('command', a, {}, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal(h.authority.tick, 0); // Packet receipt never advances simulation.
    assert.equal(h.world.actors[0].hp, 500);
});

test('loopback host validates Origin and Host and exposes no arbitrary workspace files', async t => {
    const h = await host(t);
    assert.equal((await h.api('join', undefined, {}, { Origin: 'https://example.com' })).status, 403);
    for (const headers of [{ Host: 'evil.example' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
        const status = await new Promise((resolve, reject) => {
            const req = request(`${h.base}/api/join`, { method: 'POST', headers }, res => {
                res.resume(); res.on('end', () => resolve(res.statusCode));
            });
            req.on('error', reject); req.end();
        });
        assert.equal(status, 403);
    }
    const response = await fetch(`${h.base}/package.json`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
});

test('leave and lease expiry invalidate tokens and free seats without AI takeover', async t => {
    let clock = 0;
    const h = await host(t, { now: () => clock }), a = await h.join(), b = await h.join();
    assert.equal((await h.submit(b, 1, { ...idle, fire: 'bolt', dash: true })).status, 200);
    assert.equal((await h.api('leave', b, {})).status, 200);
    h.step(); assert.equal(h.world.bolts.length, 0);
    assert.equal((await h.submit(b, 2, idle)).status, 401);
    const replacement = await h.join();
    assert.equal(replacement.actorId, 1); assert.ok(replacement.generation > b.generation);
    assert.equal((await h.submit(replacement, 1, idle, { generation: b.generation })).status, 422);
    clock = LEASE_MS;
    h.step();
    assert.equal((await h.observe(a)).status, 401);
    assert.equal((await h.observe(replacement)).status, 401);
    assert.equal((await h.api('join', undefined, {})).status, 409);
    clock += RECOVERY_MS; h.step();
    const next = await h.join(); assert.equal(next.actorId, 0);
    for (let i = 0; i < 90; i++) h.step();
    assert.equal(h.world.bolts.length, 0);
});

const resume = (h, c, sequence = 1) => h.api('resume', { token: c.recoveryToken }, { sessionId: c.sessionId, sequence });

test('two allied HTTP clients damage the common sentinel, share scars, and recover without healing or replay', async t => {
    let clock = 0;
    const h = await host(t, { scene: 'coop', now: () => clock }), a = await h.join(), b = await h.join();
    const sentinel = h.world.actors[2];
    assert.equal(a.scene, 'coop'); assert.equal(h.world.actors.length, 3);
    async function nova(c) {
        const body = { sessionId: c.sessionId, command: { generation: c.generation, sequence: 1, actorId: c.actorId,
            input: { ...idle, fire: 'nova', aim: { x: sentinel.x, y: sentinel.y, z: sentinel.z + .7, targetId: 2 } } } };
        assert.equal((await h.api('action', c, body)).status, 200);
        for (let i = 0; i < 120; i++) h.step();
        assert.equal((await h.api('action', c, body)).status, 200); // Duplicate after effects ended.
    }
    const initial = sentinel.hp; await nova(a); const afterA = sentinel.hp;
    assert.ok(afterA < initial); await nova(b); assert.ok(sentinel.hp < afterA);
    assert.equal(h.world.actors[0].hp, 500); assert.equal(h.world.actors[1].hp, 500);
    const left = (await h.observe(a)).data, right = (await h.observe(b)).data;
    assert.deepEqual(left.cells, right.cells); assert.equal(left.actors[2].hp, right.actors[2].hp);
    clock = 1001;
    const recovered = (await resume(h, a)).data, hp = sentinel.hp;
    const restored = (await h.observe(recovered)).data;
    assert.equal(restored.actors[2].hp, hp); assert.deepEqual(restored.cells, right.cells);
    for (let i = 0; i < 120; i++) h.step(); assert.equal(sentinel.hp, hp);
});

test('recovery rotates credentials, retries lost replies, clears queued actions and preserves state', async t => {
    const h = await host(t), a = await h.join(), b = await h.join();
    const actor = h.world.actors[0]; actor.hp = 123; actor.qi = 77;
    h.world.terrain({ x: 232, y: 256 }, 10, 300);
    const before = structuredClone({ actors: h.world.actors, cells: h.world.cells });
    await h.submit(a, 1, { ...idle, fire: 'bolt', dash: true });
    const resumed = await resume(h, a);
    assert.equal(resumed.status, 200); const c = resumed.data;
    assert.equal(c.actorId, a.actorId); assert.notEqual(c.token, a.token); assert.ok(c.generation > a.generation);
    assert.deepEqual((await resume(h, a)).data, c); // Lost successful reply.
    assert.deepEqual({ actors: h.world.actors, cells: h.world.cells }, before);
    assert.equal((await h.submit(a, 2, { ...idle, fire: 'bolt' })).status, 401);
    assert.equal((await h.submit(c, 1, idle, { generation: a.generation })).status, 422);
    assert.equal((await h.api('leave', a, {})).status, 401);
    h.step(); assert.equal(h.world.bolts.length, 0); assert.equal(actor.dashLeft, 0);
    const snapshot = await h.observe(c), other = await h.observe(b);
    assert.deepEqual(snapshot.data.cells, other.data.cells);
    assert.equal(snapshot.data.actors[0].hp, 123);
    assert.equal(snapshot.data.receipt.received, 0);
    assert.equal((await h.submit(c, 1, idle)).status, 200);
    const newer = (await resume(h, c, 2)).data;
    assert.equal((await resume(h, c, 1)).status, 409);
    assert.equal((await h.submit(c, 2, idle)).status, 401);
    assert.equal((await h.submit(newer, 1, idle)).status, 200);
});

test('expired lease reserves exact actor until the recovery deadline without revival or attack replay', async t => {
    let clock = 0;
    const h = await host(t, { now: () => clock }), a = await h.join(), b = await h.join();
    await h.submit(a, 1, { ...idle, fire: 'bolt' }); h.step();
    assert.equal(h.world.bolts.length, 5);
    h.world.actors[0].hp = 0;
    clock = LEASE_MS; h.step();
    assert.equal((await h.api('live', a)).status, 401);
    assert.equal((await h.api('join', undefined, {})).status, 409);
    clock += RECOVERY_MS - 1;
    const before = structuredClone(h.world.bolts);
    const c = (await resume(h, a)).data;
    assert.equal(c.actorId, 0); assert.equal(h.world.actors[0].hp, 0);
    assert.deepEqual(h.world.bolts, before);
    assert.equal((await resume(h, b)).status, 200); // Independent reservation.
    await h.api('leave', c, {});
    assert.equal((await resume(h, c, 2)).status, 401);
    assert.equal((await h.join()).actorId, 0);
});

test('recovery deadline is exclusive and abandoned successful recovery can use a newer attempt', async t => {
    let clock = 0;
    const h = await host(t, { now: () => clock }), a = await h.join();
    const c = (await resume(h, a)).data;
    clock = LEASE_MS;
    assert.equal((await resume(h, a)).status, 409);
    assert.equal((await resume(h, a, 2)).status, 200);
    clock += LEASE_MS + RECOVERY_MS;
    assert.equal((await resume(h, c, 3)).status, 401);
    assert.equal((await h.join()).actorId, 0);
});

test('replacement host rejects old recovery and command identities; no implicit world import', async t => {
    const old = await host(t), a = await old.join();
    old.world.actors[0].hp = 0; old.world.terrain({ x: 232, y: 256 }, 10, 300);
    const fresh = await host(t);
    assert.notEqual(fresh.sessionId, old.sessionId);
    assert.equal((await resume(fresh, a)).status, 401);
    assert.equal((await fresh.submit(a, 1, idle)).status, 401);
    const c = await fresh.join(); assert.equal(fresh.world.actors[0].hp, 500); assert.equal(fresh.world.revision, 0);
    assert.equal((await fresh.api('resume', { token: c.recoveryToken }, { sessionId: a.sessionId, sequence: 1 })).status, 409);
    assert.equal((await fresh.api('resume', { token: c.token }, { sessionId: c.sessionId, sequence: 1 })).status, 401);
    assert.equal((await resume(fresh, c, 1025)).status, 409);
});

test('requests whose bodies finish after recovery cannot submit, sync or leave the replacement connection', async t => {
    const h = await host(t, { now: () => 0 });
    let c = await h.join();
    for (const path of ['leave', 'command', 'sync']) {
        const body = JSON.stringify(path === 'command' ? { sessionId: c.sessionId,
            command: { generation: c.generation, actorId: c.actorId, sequence: 1, input: { ...idle, fire: 'bolt' } } } :
            path === 'sync' ? new ReplicaClient(c.sessionId).request() : {});
        let pending;
        const result = new Promise((resolve, reject) => {
            pending = request(`${h.base}/api/${path}`, { method: 'POST', headers: {
                Authorization: `Bearer ${c.token}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body),
            } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
            pending.on('error', reject); pending.write(body.slice(0, 1));
        });
        // Flush the old authenticated request into the asynchronous body reader first.
        await delay(20);
        c = (await resume(h, c, c.generation)).data;
        pending.end(body.slice(1));
        assert.equal(await result, 401);
        assert.equal((await h.api('live', c)).status, 200);
        h.step(); assert.equal(h.world.bolts.length, 0);
    }
});

test('per-connection and global HTTP intake limits bound even rejected request floods', async t => {
    const h = await host(t, { now: () => 0 }), a = await h.join();
    for (let i = 0; i < 100; i++) assert.equal((await h.api('sync', a, new ReplicaClient(a.sessionId).request())).status, 200);
    assert.equal((await h.observe(a)).status, 429);
    for (let i = 0; i < 100; i++) await h.observe();
    assert.equal((await h.observe()).status, 429);
});

test('automatic host clock advances without input packets and stops with the server', async t => {
    const h = await host(t, { autoTick: true });
    await delay(120);
    assert.ok(h.authority.tick >= 2);
    assert.equal(h.world.sceneTime, h.world.time);
    assert.equal(h.world.timeScale, 1);
});

test('HTTP sync retries identical pages, rejects gaps/versions, and recovers a new generation', async t => {
    const h = await host(t), a = await h.join(), client = new ReplicaClient(a.sessionId);
    const initial = client.request();
    const first = await h.api('sync', a, initial);
    assert.equal(first.status, 200);
    h.world.terrain({ x: 232, y: 256 }, 10, 300); h.step();
    assert.deepEqual((await h.api('sync', a, initial)).data, first.data);
    assert.equal((await h.api('sync', a, { ...initial, ack: 100 })).status, 409);
    assert.equal((await h.api('sync', a, { ...initial, protocol: 999 })).status, 409);
    assert.equal((await h.api('sync', a, { ...initial, schema: 'wrong' })).status, 409);
    assert.equal((await h.api('sync', a, { ...initial, sessionId: 'previous-host' })).status, 409);
    client.reset();
    for (let page = 0; page < 64; page++) {
        const result = await h.api('sync', a, client.request());
        assert.equal(result.status, 200); client.apply(result.data);
    }
    assert.deepEqual(client.cells, h.world.cells);
    assert.equal(client.revision, h.world.revision);
    assert.equal((await h.api('sync', a, initial)).status, 409);
});

test('authenticated live frames progress during a pinned terrain transfer without advancing its acknowledgment', async t => {
    const h = await host(t), a = await h.join(), client = new ReplicaClient(a.sessionId);
    const initial = client.request(), first = await h.api('sync', a, initial);
    h.step(); h.world.terrain({ x: 232, y: 256 }, 10, 300);
    assert.equal((await h.api('live')).status, 401);
    const live = await h.api('live', a);
    assert.equal(live.status, 200); assert.equal(live.data.sessionId, a.sessionId);
    assert.equal(live.data.state.tick, 1); assert.equal(live.data.state.revision, 1);
    assert.deepEqual((await h.api('sync', a, initial)).data, first.data);
    assert.ok(Buffer.byteLength(JSON.stringify(live.data)) < 64 * 1024);
});
