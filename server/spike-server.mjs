import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { World, DT } from '../src/sim.ts';
import { SessionAuthority } from '../src/session-authority.ts';

export const BODY_LIMIT = 2048, FRAME_LIMIT = 4 * 1024 * 1024, LEASE_MS = 5000;
const token = () => randomBytes(24).toString('hex');
const assets = new Map([
    ['/', ['spike.html', 'text/html']], ['/spike.html', ['spike.html', 'text/html']],
    ['/spike-client.js', ['spike-client.js', 'text/javascript']],
    ['/sim.js', ['sim.js', 'text/javascript']], ['/time-flow.js', ['time-flow.js', 'text/javascript']],
    ['/targeting.js', ['targeting.js', 'text/javascript']],
]);

// Exported for real HTTP integration tests. Only the local host owns this World.
export function createSpikeServer({ now = () => performance.now(), autoTick = true } = {}) {
    const world = new World();
    const authority = new SessionAuthority(world, [0, 1]);
    const sessionId = token(), clients = new Map();
    let globalWindow = now(), globalCount = 0, cachedTick = -1, cachedFrame;
    let timer, previous = now(), accumulator = 0, droppedTime = 0;

    function expire() {
        for (const [secret, c] of clients) if (now() - c.seen >= LEASE_MS) {
            authority.disconnect(c.id); clients.delete(secret);
        }
    }
    function step() { expire(); authority.step(); }
    function frame() {
        if (cachedTick !== authority.tick) {
            const changedCells = [];
            world.cells.forEach((c, i) => {
                if (world.cellVersions[i]) changedCells.push([i, c.kind, c.hp, c.depth, c.elevation]);
            });
            cachedFrame = JSON.stringify({ sessionId, tick: authority.tick, time: world.time,
                revision: world.revision, destroyed: world.destroyed, actors: world.actors,
                bolts: world.bolts.map(b => ({ x: b.x, y: b.y, z: b.z, owner: b.owner, launched: b.launched })),
                waves: world.waves.map(b => ({ x: b.x, y: b.y, z: b.z, owner: b.owner, span: b.span, angle: b.angle })),
                casts: world.casts.map(c => ({ x: c.x, y: c.y, z: c.z, owner: c.owner, radius: c.radius, left: c.left })),
                changedCells, droppedTime });
            if (Buffer.byteLength(cachedFrame) > FRAME_LIMIT) throw new Error('Observation budget exceeded');
            cachedTick = authority.tick;
        }
        return cachedFrame;
    }
    function send(res, status, data) {
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff' });
        res.end(typeof data === 'string' ? data : JSON.stringify(data));
    }
    async function json(req) {
        if (req.headers['content-type'] !== 'application/json') throw { status: 415, error: 'JSON required' };
        if (Number(req.headers['content-length']) > BODY_LIMIT) throw { status: 413, error: 'Message too large' };
        let size = 0; const parts = [];
        for await (const part of req) {
            size += part.length;
            if (size > BODY_LIMIT) throw { status: 413, error: 'Message too large' };
            parts.push(part);
        }
        try { return JSON.parse(Buffer.concat(parts).toString('utf8')); }
        catch { throw { status: 400, error: 'Malformed JSON' }; }
    }
    const server = createServer({ maxHeaderSize: 8192, requestTimeout: 3000, headersTimeout: 3000 }, async (req, res) => {
        try {
            const origin = `http://127.0.0.1:${server.address().port}`;
            if (req.headers.host !== origin.slice(7) ||
                (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site') {
                send(res, 403, { error: 'Local same-origin requests only' }); return;
            }
            const path = req.url;
            if (req.method === 'GET' && assets.has(path)) {
                const [file, type] = assets.get(path);
                const content = await readFile(new URL(`../dist/${file}`, import.meta.url));
                res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store',
                    'X-Content-Type-Options': 'nosniff',
                    'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'" });
                res.end(content); return;
            }
            if (!path?.startsWith('/api/')) { send(res, 404, { error: 'Not found' }); return; }
            expire();
            if (now() - globalWindow >= 1000) { globalWindow = now(); globalCount = 0; }
            if (++globalCount > 200) { send(res, 429, { error: 'Ingress limit' }); return; }
            if (path === '/api/join' && req.method === 'POST') {
                const body = await json(req);
                if (!body || Array.isArray(body) || typeof body !== 'object' || Object.keys(body).length) {
                    send(res, 400, { error: 'Join takes no client assignment' }); return;
                }
                const actorId = [0, 1].find(id => ![...clients.values()].some(c => c.actorId === id));
                if (actorId === undefined) { send(res, 409, { error: 'Both seats occupied. Leave a tab or wait five seconds after closing it.' }); return; }
                const secret = token(), id = token(), generation = authority.connect(id, actorId);
                clients.set(secret, { id, actorId, generation, seen: now(), window: now(), count: 0 });
                send(res, 200, { token: secret, sessionId, generation, actorId }); return;
            }
            const secret = req.headers.authorization?.replace(/^Bearer /, '');
            const c = clients.get(secret);
            if (!c) { send(res, 401, { error: 'Connection expired. Join again.' }); return; }
            if (now() - c.window >= 1000) { c.window = now(); c.count = 0; }
            if (++c.count > 100) { send(res, 429, { error: 'Connection ingress limit' }); return; }
            if (path === '/api/state' && req.method === 'GET') {
                c.seen = now(); send(res, 200, frame()); return;
            }
            if (path === '/api/leave' && req.method === 'POST') {
                await json(req); authority.disconnect(c.id); clients.delete(secret);
                send(res, 200, { left: true }); return;
            }
            if (path === '/api/command' && req.method === 'POST') {
                const body = await json(req);
                // Recheck after asynchronous body reading: leave/expiry can race a request.
                if (clients.get(secret) !== c || now() - c.seen >= LEASE_MS) {
                    send(res, 401, { error: 'Connection expired' }); return;
                }
                if (!body || body.sessionId !== sessionId || Object.keys(body).some(k => !['sessionId', 'command'].includes(k))) {
                    send(res, 409, { error: 'Wrong server session' }); return;
                }
                const result = authority.submit(c.id, body.command);
                if (result.accepted) c.seen = now();
                send(res, result.accepted ? 200 : 422, result); return;
            }
            send(res, 404, { error: 'Not found' });
        } catch (error) {
            if (!res.headersSent && !res.destroyed) send(res, error.status ?? 500, { error: error.error ?? 'Local host error' });
        } finally {
            // Drain early-rejected bodies without retaining them in application memory.
            if (!req.complete && !req.destroyed) req.resume();
        }
    });
    server.maxConnections = 16;
    server.setTimeout(3000, socket => socket.destroy());
    server.on('listening', () => {
        previous = now();
        if (autoTick) timer = setInterval(() => {
            const current = now(), elapsed = Math.max(0, (current - previous) / 1000);
            previous = current;
            // Cap catch-up after a suspended/overloaded process; never use packet dt.
            accumulator += Math.min(elapsed, 5 * DT);
            droppedTime += Math.max(0, elapsed - 5 * DT);
            while (accumulator >= DT) { step(); accumulator -= DT; }
        }, 8);
    });
    server.on('close', () => clearInterval(timer));
    return { server, world, authority, step, sessionId };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const { server } = createSpikeServer();
    server.listen(5174, '127.0.0.1', () => console.log('Two-client sparring: http://127.0.0.1:5174 (open in two tabs)'));
}
