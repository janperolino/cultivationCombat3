import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { World, DT } from '../src/sim.ts';
import { BASELINE_ENCOUNTER, SKIRMISH_ENCOUNTER } from '../src/content.ts';
import { SessionAuthority } from '../src/session-authority.ts';
import { ReplicationStream, PROTOCOL_VERSION, TERRAIN_SCHEMA, MAX_PACKET_BYTES, captureDisplayFrame } from '../src/replication.ts';

export const BODY_LIMIT = 2048, FRAME_LIMIT = MAX_PACKET_BYTES, LEASE_MS = 5000;
export const RECOVERY_MS = 30_000;
const token = () => randomBytes(24).toString('hex');
const assets = new Map([
    ['/', ['spike.html', 'text/html']], ['/spike.html', ['spike.html', 'text/html']],
    ['/spike-client.js', ['spike-client.js', 'text/javascript']],
    ['/study.css', ['study.css', 'text/css']],
    ['/study-scene.js', ['study-scene.js', 'text/javascript']],
    ['/study-camera.js', ['study-camera.js', 'text/javascript']],
    ['/study-state.js', ['study-state.js', 'text/javascript']],
    ['/study-view.js', ['study-view.js', 'text/javascript']],
    ['/height-terrain.js', ['height-terrain.js', 'text/javascript']],
    ['/depth-scene.js', ['depth-scene.js', 'text/javascript']],
    ['/technique-visuals.js', ['technique-visuals.js', 'text/javascript']],
    ['/impact.js', ['impact.js', 'text/javascript']],
    ['/projection.js', ['projection.js', 'text/javascript']],
    ['/sim.js', ['sim.js', 'text/javascript']], ['/time-flow.js', ['time-flow.js', 'text/javascript']],
    ['/content.js', ['content.js', 'text/javascript']],
    ['/enemy-ai.js', ['enemy-ai.js', 'text/javascript']],
    ['/encounter.js', ['encounter.js', 'text/javascript']],
    ['/targeting.js', ['targeting.js', 'text/javascript']],
    ['/teams.js', ['teams.js', 'text/javascript']],
    ['/replication.js', ['replication.js', 'text/javascript']],
    ['/client-motion.js', ['client-motion.js', 'text/javascript']],
    ['/network-lab.js', ['network-lab.js', 'text/javascript']],
    ['/client-actions.js', ['client-actions.js', 'text/javascript']],
]);

// Exported for real HTTP integration tests. Only the local host owns this World.
export function createSpikeServer({ now = () => performance.now(), autoTick = true, scene = 'sparring' } = {}) {
    if (!['coop', 'sparring', 'skirmish'].includes(scene)) throw new Error('Unknown spike scene');
    const world = new World(undefined, scene === 'coop' ? BASELINE_ENCOUNTER : scene === 'skirmish' ? SKIRMISH_ENCOUNTER : undefined, scene === 'skirmish');
    const authority = new SessionAuthority(world, [0, 1]);
    const sessionId = token(), clients = new Map();
    let started = scene !== 'skirmish';
    let globalWindow = now(), globalCount = 0;
    let timer, previous = now(), accumulator = 0, droppedTime = 0;

    function expire() {
        for (const [recoveryToken, c] of clients) {
            if (c.active && now() - c.seen >= LEASE_MS) {
                authority.disconnect(c.id); c.active = false;
                c.stream = undefined;
            }
            if (!c.active && now() >= c.seen + LEASE_MS + RECOVERY_MS) clients.delete(recoveryToken);
        }
    }
    function activate(c) {
        if (c.active) authority.disconnect(c.id);
        c.id = token(); c.token = token(); c.active = true;
        c.generation = authority.connect(c.id, c.actorId);
        c.seen = now(); c.window = now(); c.count = 0;
        const id = c.id;
        c.stream = new ReplicationStream(world, sessionId, () => frame(id));
    }
    function assignment(c) {
        return { token: c.token, recoveryToken: c.recoveryToken, sessionId, generation: c.generation,
            actorId: c.actorId, scene, protocol: PROTOCOL_VERSION, schema: TERRAIN_SCHEMA };
    }
    function step() { expire(); if (started) authority.step(); }
    function frame(clientId) {
        return captureDisplayFrame(world, authority.tick, authority.receipt(clientId), droppedTime);
    }
    function send(res, status, data) {
        const text = typeof data === 'string' ? data : JSON.stringify(data);
        if (Buffer.byteLength(text) > FRAME_LIMIT) throw new Error('Response budget exceeded');
        res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff' });
        res.end(text);
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
                if (actorId === undefined) { send(res, 409, { error: 'Both seats occupied or reserved. Use recovery, Leave explicitly, or wait for the reservation to expire.' }); return; }
                const recoveryToken = token(), c = { recoveryToken, actorId, resumeSequence: 0 };
                activate(c); clients.set(recoveryToken, c);
                started = true;
                send(res, 200, assignment(c)); return;
            }
            const secret = req.headers.authorization?.replace(/^Bearer /, '');
            if (path === '/api/resume' && req.method === 'POST') {
                const body = await json(req);
                // Check after body read: a concurrent leave/expiry may remove the reservation.
                expire();
                const c = clients.get(secret);
                if (!c) { send(res, 401, { error: 'Recovery reservation expired. Join a fresh seat.' }); return; }
                if (!body || body.sessionId !== sessionId || !Number.isSafeInteger(body.sequence) ||
                    body.sequence < 1 || Object.keys(body).some(k => !['sessionId', 'sequence'].includes(k))) {
                    send(res, 409, { error: 'Wrong recovery session or request' }); return;
                }
                if (body.sequence < c.resumeSequence || body.sequence - c.resumeSequence > 1024 ||
                    (body.sequence === c.resumeSequence && !c.active)) {
                    send(res, 409, { error: 'Stale recovery attempt', retryRecovery: true }); return;
                }
                // Same attempt returns the same assignment, including after a lost response.
                if (body.sequence > c.resumeSequence) { activate(c); c.resumeSequence = body.sequence; }
                send(res, 200, assignment(c)); return;
            }
            const c = [...clients.values()].find(c => c.active && c.token === secret);
            if (!c) { send(res, 401, { error: 'Connection expired. Join again.' }); return; }
            if (now() - c.window >= 1000) { c.window = now(); c.count = 0; }
            if (++c.count > 100) { send(res, 429, { error: 'Connection ingress limit' }); return; }
            if (path === '/api/live' && req.method === 'GET') {
                c.seen = now(); send(res, 200, { protocol: PROTOCOL_VERSION, schema: TERRAIN_SCHEMA, sessionId, state: frame(c.id) }); return;
            }
            if (path === '/api/sync' && req.method === 'POST') {
                const body = await json(req);
                if (!c.active || c.token !== secret || now() - c.seen >= LEASE_MS) {
                    send(res, 401, { error: 'Connection expired' }); return;
                }
                try {
                    const page = c.stream.reply(body);
                    c.seen = now(); send(res, 200, page);
                } catch (error) { send(res, 409, { error: error.message, resync: true }); }
                return;
            }
            if (path === '/api/leave' && req.method === 'POST') {
                await json(req);
                if (!c.active || c.token !== secret || now() - c.seen >= LEASE_MS) { send(res, 401, { error: 'Connection replaced or expired' }); return; }
                authority.disconnect(c.id); clients.delete(c.recoveryToken); c.active = false;
                send(res, 200, { left: true }); return;
            }
            if ((path === '/api/command' || path === '/api/action' || path === '/api/retry') && req.method === 'POST') {
                const body = await json(req);
                // Recheck after asynchronous body reading: leave/expiry can race a request.
                if (!c.active || c.token !== secret || now() - c.seen >= LEASE_MS) {
                    send(res, 401, { error: 'Connection expired' }); return;
                }
                if (!body || body.sessionId !== sessionId || Object.keys(body).some(k => !['sessionId', 'command'].includes(k))) {
                    send(res, 409, { error: 'Wrong server session' }); return;
                }
                const result = path === '/api/retry' ? authority.retry(c.id, body.command) : path === '/api/action' ? authority.submitAction(c.id, body.command) : authority.submit(c.id, body.command);
                if (result.accepted) c.seen = now();
                send(res, result.accepted ? 200 : 422, { ...result, receipt: authority.receipt(c.id) }); return;
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
    const { server } = createSpikeServer({ scene: process.argv.includes('--encounter') ? 'skirmish' : 'coop' });
    server.listen(5174, '127.0.0.1', () => console.log('Two-client sparring: http://127.0.0.1:5174 (open in two tabs)'));
}
