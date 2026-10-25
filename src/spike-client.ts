import { World, GRID, CELL, SIZE, DT } from './sim.ts';
import type { ActorInput, Technique } from './sim.ts';
import { targetInRange, LOCK_RANGE } from './targeting.ts';
import { ReplicaClient, PROTOCOL_VERSION, TERRAIN_SCHEMA, validateDisplayFrame } from './replication.ts';
import type { DisplayFrame, StatePage } from './replication.ts';
import { MotionPredictor, RemoteInterpolator } from './client-motion.ts';
import { NetworkLab } from './network-lab.ts';
import type { ProfileName } from './network-lab.ts';

type Connection = { token: string; actorId: number; generation: number; sessionId: string; protocol: number; schema: string };
const canvas = document.getElementById('arena') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const join = document.getElementById('join') as HTMLButtonElement;
const leave = document.getElementById('leave') as HTMLButtonElement;
const status = document.getElementById('status')!;
const readout = document.getElementById('readout')!;
// Used only as the deterministic display baseline/height lookup. Never stepped here.
const terrain = new World();
const terrainLayer = document.createElement('canvas'); terrainLayer.width = canvas.width; terrainLayer.height = canvas.height;
const terrainCtx = terrainLayer.getContext('2d')!;
let drawnRevision = -999;
let connection: Connection | undefined, frame: DisplayFrame | undefined, replica: ReplicaClient | undefined, sequence = 0;
let joining = false, sending = 0, polling = false, livePolling = false, held = false, dash = false;
let fire: Technique | undefined, lastFrameAt = 0, rtt = 0;
let predictor: MotionPredictor | undefined, remote = new RemoteInterpolator(), lab = new NetworkLab();
let lastLiveAt = 0, lastSyncAt = 0, motionAt = performance.now(), motionAcc = 0, frameTickAt = 0;
let traffic = 0;
const network = document.getElementById('network') as HTMLSelectElement;
network.onchange = () => { lab = new NetworkLab(network.value as ProfileName); clearInput(); };
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const keys = new Set<string>(), mouse = { x: 256, y: 256 };
const colors = ['#a2e8c5', '#edb96d'];

function clearInput() { keys.clear(); held = false; dash = false; fire = undefined; }
async function request(path: string, c?: Connection, body?: unknown) {
    const fault = lab.next();
    await wait(fault.up);
    if (fault.dropRequest) throw new Error('Network test dropped request');
    const response = await fetch(`/api/${path}`, {
        method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
        headers: { ...(c ? { Authorization: `Bearer ${c.token}` } : {}),
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(1500),
    });
    const text = await response.text(); traffic += new TextEncoder().encode(text).length;
    await wait(fault.down);
    if (fault.dropResponse) throw new Error('Network test dropped response');
    const data = JSON.parse(text);
    if (response.status === 401 && connection === c) disconnectLocal('Connection expired · join again.');
    if (!response.ok) {
        if (data.resync && connection === c && replica) { replica.reset(); predictor = new MotionPredictor(c!.actorId); clearInput(); }
        throw new Error(data.error ?? data.reason ?? 'Request rejected');
    }
    return data;
}
function disconnectLocal(message: string) {
    connection = undefined; clearInput(); join.disabled = false; leave.disabled = true;
    status.textContent = message;
}
join.onclick = async () => {
    if (joining || connection) return;
    joining = true; join.disabled = true; status.textContent = 'Joining…';
    try {
        connection = await request('join', undefined, {});
        if (connection!.protocol !== PROTOCOL_VERSION || connection!.schema !== TERRAIN_SCHEMA) throw new Error('Client/host versions differ · reload this page.');
        replica = new ReplicaClient(connection!.sessionId);
        predictor = new MotionPredictor(connection!.actorId); remote = new RemoteInterpolator();
        lastLiveAt = 0; lastSyncAt = 0; motionAcc = 0; motionAt = performance.now();
        frame = undefined; sequence = 0; clearInput();
        terrain.cells = new World().cells;
        drawnRevision = -999;
        leave.disabled = false; canvas.focus();
        status.textContent = `Joined as player ${connection!.actorId + 1}`;
        await poll();
    } catch (error) { disconnectLocal((error as Error).message); }
    finally { joining = false; if (!connection) join.disabled = false; }
};
leave.onclick = async () => {
    const c = connection;
    disconnectLocal('Left sparring · join to take an available seat.');
    if (c) try { await request('leave', c, {}); } catch { /* Lease expiry also releases the seat. */ }
};
addEventListener('pagehide', () => {
    if (connection) void fetch('/api/leave', { method: 'POST', keepalive: true,
        headers: { Authorization: `Bearer ${connection.token}`, 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
});
canvas.addEventListener('pointermove', event => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = Math.max(0, Math.min(SIZE, (event.clientX - rect.left) / rect.width * SIZE));
    mouse.y = Math.max(0, Math.min(SIZE, (event.clientY - rect.top) / rect.height * SIZE));
});
canvas.addEventListener('pointerdown', event => { if (event.button === 0) { canvas.focus(); held = true; } });
addEventListener('pointerup', () => { held = false; });
canvas.addEventListener('contextmenu', event => event.preventDefault());
addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', clearInput);
canvas.addEventListener('keydown', event => {
    if (!connection) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'ShiftLeft', 'ShiftRight', 'Digit1', 'Digit2', 'Digit3', 'KeyQ', 'KeyE'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if (event.repeat) return;
    if (event.code.startsWith('Shift')) dash = true;
    if (event.code === 'KeyQ' || event.code === 'Digit2') fire = 'slash';
    if (event.code === 'KeyE' || event.code === 'Digit3') fire = 'nova';
});
addEventListener('keyup', event => keys.delete(event.code));

function currentInput(): ActorInput {
    const actor = frame!.actors.find(a => a.id === connection!.actorId)!;
    const target = frame!.actors.find(a => targetInRange(actor, a, LOCK_RANGE) && Math.hypot(a.x - mouse.x, a.y - a.z * .25 - mouse.y) < 10);
    return { move: { x: Number(keys.has('KeyD')) - Number(keys.has('KeyA')), y: Number(keys.has('KeyS')) - Number(keys.has('KeyW')) },
        climb: Number(keys.has('KeyF')) - Number(keys.has('KeyG')), autoAltitude: true,
        aim: target ? { x: target.x, y: target.y, z: target.z + .7, targetId: target.id } :
            { ...mouse, z: terrain.groundHeight(mouse.x, mouse.y) + .7 },
        fire: fire ?? (held || keys.has('Digit1') ? 'bolt' : undefined), dash };
}
async function sendInput() {
    const c = connection;
    if (!c || !frame || sending >= 6 || !replica?.ready) return;
    sending++;
    const input = currentInput(), sentSequence = ++sequence;
    predictor?.noteCommand(sentSequence);
    fire = undefined; dash = false;
    try {
        await request('command', c, { sessionId: c.sessionId,
            command: { generation: c.generation, sequence: sentSequence, actorId: c.actorId, input } });
    } catch (error) {
        if (connection === c) status.textContent = `Input: ${(error as Error).message}`;
    } finally { sending--; }
}
function acceptLive(next: DisplayFrame, started: number) {
    if (frame && next.tick <= frame.tick) return;
    validateDisplayFrame(next, frame);
    frame = next; lastLiveAt = performance.now(); rtt = lastLiveAt - started;
    frameTickAt = next.tick + rtt / 2 / 1000 / DT;
    lastFrameAt = lastLiveAt;
    predictor!.setTerrain(terrain.cells);
    predictor!.reconcile(next, predictor!.tick - Math.round(rtt / 2 / 1000 / DT));
    remote.push(next);
}
async function pollLive() {
    const c = connection;
    if (!c || !replica?.ready || livePolling) return;
    livePolling = true; const started = performance.now();
    try {
        const data = await request('live', c);
        if (connection !== c) return;
        if (data.sessionId !== c.sessionId || data.protocol !== PROTOCOL_VERSION || data.schema !== TERRAIN_SCHEMA) throw new Error('Live frame version/session mismatch');
        acceptLive(data.state, started);
    } catch (error) { if (connection === c) status.textContent = `Live state: ${(error as Error).message}`; }
    finally { livePolling = false; }
}
async function poll() {
    const c = connection;
    if (!c || polling) return;
    polling = true;
    const started = performance.now();
    try {
        const activeReplica = replica!;
        const next: StatePage = await request('sync', c, activeReplica.request());
        if (connection !== c) return;
        let result;
        try { result = activeReplica.apply(next); }
        catch { activeReplica.reset(); predictor = new MotionPredictor(c.actorId); clearInput(); status.textContent = 'Synchronizing arena again…'; return; }
        lastSyncAt = performance.now();
        if (result === 'ignored') return;
        if (result === 'partial') { status.textContent = `Synchronizing arena · ${activeReplica.progress} cells`; return; }
        terrain.cells = activeReplica.cells;
        predictor!.setTerrain(terrain.cells);
        if (!frame) acceptLive(activeReplica.state!, performance.now());
        status.textContent = `Player ${c.actorId + 1} connected · shared sparring arena`;
        draw();
    } catch (error) {
        if (connection === c) status.textContent = `Waiting for host · ${(error as Error).message}`;
    } finally { polling = false; }
}

function circle(x: number, y: number, radius: number, color: string, outline = false) {
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (outline) { ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.stroke(); }
    else { ctx.fillStyle = color; ctx.fill(); }
}
function draw() {
    ctx.setTransform(canvas.width / SIZE, 0, 0, canvas.height / SIZE, 0, 0);
    if (drawnRevision !== (replica?.revision ?? -1)) {
        terrainCtx.setTransform(canvas.width / SIZE, 0, 0, canvas.height / SIZE, 0, 0);
        for (let i = 0; i < terrain.cells.length; i++) {
            const c = terrain.cells[i], shade = Math.round(56 + c.elevation * 1.1 - c.depth * 2);
            terrainCtx.fillStyle = c.hp > 0 ? c.kind === 1 ? '#345541' : '#67746a' : `rgb(${shade},${shade + 15},${shade + 4})`;
            terrainCtx.fillRect(i % GRID * CELL, Math.floor(i / GRID) * CELL, CELL + .1, CELL + .1);
        }
        drawnRevision = replica?.revision ?? -1;
    }
    ctx.drawImage(terrainLayer, 0, 0, SIZE, SIZE);
    if (!frame) return;
    for (const c of frame.casts) circle(c.x, c.y, c.radius, colors[c.owner], true);
    for (const b of frame.bolts) if (b.launched) circle(b.x, b.y - b.z * .25, 1.4, colors[b.owner]);
    for (const wave of frame.waves) {
        ctx.beginPath(); ctx.arc(wave.x, wave.y - wave.z * .25, wave.span, wave.angle - .8, wave.angle + .8);
        ctx.strokeStyle = colors[wave.owner]; ctx.lineWidth = 2; ctx.stroke();
    }
    const interpolated = remote.sample(frameTickAt + Math.max(0, performance.now() - lastLiveAt) / 1000 / DT);
    const actors = interpolated.map(a => a.id === connection?.actorId && predictor?.actor ? predictor.actor : a);
    for (const a of actors) {
        const y = a.y - a.z * .25;
        circle(a.x, a.y, 4, '#1b2825');
        ctx.strokeStyle = '#aac3ac'; ctx.lineWidth = .5;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x, y); ctx.stroke();
        circle(a.x, y, 3.5, a.hp > 0 ? colors[a.id] : '#635f55');
        if (a.id === connection?.actorId) circle(a.x, y, 6, '#fff3d1', true);
        if (a.dashLeft > 0) circle(a.x, y, 8, colors[a.id], true);
        ctx.font = '7px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff0cc';
        ctx.fillText(`P${a.id + 1} · ${Math.round(a.hp)} hp`, a.x, y - 10);
    }
    readout.textContent = frame.actors.map(a => `P${a.id + 1}: ${Math.round(a.hp)} hp · ${Math.round(a.qi)} qi · ${a.z.toFixed(1)}m altitude${a.hp <= 0 ? ' · defeated' : ''}`).join('    ') +
        `\nShared tick ${frame.tick} · terrain ${replica?.revision}/${frame.revision} · ${frame.destroyed} cover destroyed · live round trip ${Math.round(rtt)} ms` +
        `\nInput received ${frame.receipt.received} · applied through ${frame.receipt.applied} · pending ${predictor?.pendingCount ?? 0}` +
        `\nCorrection ${(predictor?.correction ?? 0).toFixed(2)}m · state age ${Math.round(performance.now() - lastLiveAt)}ms · received ${(traffic / 1024).toFixed(0)} KiB · lab drops ${lab.dropped}`;
}
setInterval(() => { void sendInput(); }, 1000 / 30);
// Fill paged transfers promptly, then retain the original 10 Hz observation cadence.
setInterval(() => { if (replica?.syncing || performance.now() - lastSyncAt >= 100) void poll(); }, 25);
setInterval(() => { void pollLive(); }, 100);
setInterval(() => {
    if (connection && lastFrameAt && performance.now() - lastFrameAt > 2000) status.textContent = 'Host unavailable · showing last received state.';
}, 500);
function render(now: number) {
    motionAcc += Math.min(.1, Math.max(0, (now - motionAt) / 1000)); motionAt = now;
    while (motionAcc >= DT) {
        if (connection && frame && replica?.ready) predictor?.advance(currentInput(), now - lastLiveAt <= 250);
        motionAcc -= DT;
    }
    if (connection && frame && replica?.ready && lastLiveAt) status.textContent = performance.now() - lastLiveAt > 250 ?
        'Waiting for authoritative state · prediction paused' :
        `Player ${connection.actorId + 1} connected · ${replica.revision < frame.revision ? 'terrain catching up' : 'shared sparring arena'}`;
    draw(); requestAnimationFrame(render);
}
requestAnimationFrame(render);
