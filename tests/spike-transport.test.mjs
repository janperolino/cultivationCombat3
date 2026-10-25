import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { createSpikeServer, BODY_LIMIT, LEASE_MS } from '../server/spike-server.mjs';

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
    return { ...app, base, api, join, submit };
}
const idle = { move: { x: 0, y: 0 }, aim: { x: 280, y: 256 } };

test('HTTP assigns separate bearer identities to two seats and both observe identical ticks', async t => {
    const h = await host(t), a = await h.join(), b = await h.join();
    assert.equal(a.actorId, 0); assert.equal(b.actorId, 1);
    assert.notEqual(a.token, b.token); assert.notEqual(a.generation, b.generation);
    assert.equal((await h.api('join', undefined, {})).status, 409);
    assert.equal((await h.api('state')).status, 401);
    assert.equal((await h.api('state', { token: 'made-up' })).status, 401);
    h.step();
    const first = await h.api('state', a), second = await h.api('state', b);
    assert.equal(first.status, 200); assert.deepEqual(first.data, second.data);
    assert.equal(first.data.tick, 1);
    assert.equal((await h.api('join', undefined, { actorId: 0 })).status, 400);
});

test('HTTP authority moves two clients, casts, and exposes shared damage/terrain to a late observer', async t => {
    const h = await host(t), a = await h.join(), b = await h.join();
    const x = h.world.actors[0].x, y = h.world.actors[1].y;
    for (let seq = 1; seq <= 6; seq++) {
        assert.equal((await h.submit(a, seq, { ...idle, move: { x: -1, y: 0 }, climb: 1 })).status, 200);
        assert.equal((await h.submit(b, seq, { ...idle, move: { x: 0, y: 1 }, autoAltitude: true })).status, 200);
        for (let i = 0; i < 5; i++) h.step();
    }
    assert.ok(h.world.actors[0].x < x); assert.ok(h.world.actors[1].y > y);
    assert.equal((await h.submit(a, 7, { ...idle, fire: 'bolt' })).status, 200);
    h.step();
    assert.equal((await h.api('state', b)).data.bolts.length, 5);
    // Place the target near the aimed impact to isolate transport -> authority -> damage.
    const victim = h.world.actors[1];
    Object.assign(victim, { x: h.world.actors[0].x + 12, y: h.world.actors[0].y, z: 1, ward: 0, vx: 0, vy: 0 });
    const aim = { x: victim.x, y: victim.y };
    assert.equal((await h.submit(a, 8, { ...idle, fire: 'nova', aim })).status, 200);
    for (let i = 0; i < 120; i++) h.step();
    assert.ok(victim.hp < 500);
    assert.ok(h.world.revision > 0);
    const first = (await h.api('state', a)).data, second = (await h.api('state', b)).data;
    assert.deepEqual(first, second); assert.ok(first.changedCells.length > 0);
    await h.api('leave', b, {});
    const late = await h.join();
    const snapshot = (await h.api('state', late)).data;
    assert.equal(snapshot.revision, first.revision);
    assert.deepEqual(snapshot.changedCells, first.changedCells);
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
    assert.equal((await h.api('state', a)).status, 401);
    assert.equal((await h.api('state', replacement)).status, 401);
    const next = await h.join(); assert.equal(next.actorId, 0);
    for (let i = 0; i < 90; i++) h.step();
    assert.equal(h.world.bolts.length, 0);
});

test('per-connection and global HTTP intake limits bound even rejected request floods', async t => {
    const h = await host(t, { now: () => 0 }), a = await h.join();
    for (let i = 0; i < 100; i++) assert.equal((await h.api('state', a)).status, 200);
    assert.equal((await h.api('state', a)).status, 429);
    for (let i = 0; i < 100; i++) await h.api('state');
    assert.equal((await h.api('state')).status, 429);
});

test('automatic host clock advances without input packets and stops with the server', async t => {
    const h = await host(t, { autoTick: true });
    await delay(120);
    assert.ok(h.authority.tick >= 2);
    assert.equal(h.world.sceneTime, h.world.time);
    assert.equal(h.world.timeScale, 1);
});
