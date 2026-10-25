import { World, GRID, CELL, SIZE, DT } from './sim.ts';
import type { ActorInput, Technique } from './sim.ts';
import { targetInRange, LOCK_RANGE } from './targeting.ts';
import { ReplicaClient, PROTOCOL_VERSION, TERRAIN_SCHEMA, validateDisplayFrame } from './replication.ts';
import type { DisplayFrame, StatePage } from './replication.ts';
import { MotionPredictor, RemoteInterpolator } from './client-motion.ts';
import { NetworkLab } from './network-lab.ts';
import type { ProfileName } from './network-lab.ts';
import { ActionOutbox } from './client-actions.ts';

type Connection = { token: string; recoveryToken: string; actorId: number; generation: number; sessionId: string; protocol: number; schema: string; scene?: string };
type Recovery = { token: string; sessionId: string; sequence: number };
const recoveryKey = 'sh-spike-recovery-v1';
let recovery: Recovery | undefined, recovering = false, recoveryAttempt = 0;
try {
    const saved = JSON.parse(sessionStorage.getItem(recoveryKey) ?? 'null');
    if (saved && typeof saved.token === 'string' && typeof saved.sessionId === 'string' && Number.isSafeInteger(saved.sequence)) recovery = saved;
} catch { /* Recovery remains available in page memory when storage is unavailable. */ }
function saveRecovery() {
    try { if (recovery) sessionStorage.setItem(recoveryKey, JSON.stringify(recovery)); else sessionStorage.removeItem(recoveryKey); } catch { /* Optional reload support. */ }
}
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
let joining = false, sending = 0, polling = false, livePolling = 0, held = false, dash = false;
let fire: Technique | undefined, lastFrameAt = 0, rtt = 0;
let predictor: MotionPredictor | undefined, remote = new RemoteInterpolator(), lab = new NetworkLab();
let lastLiveAt = 0, lastSyncAt = 0, motionAt = performance.now(), motionAcc = 0, frameTickAt = 0;
let traffic = 0;
let actions = new ActionOutbox(), actionSending = false, lastHeldFire = 0;
const network = document.getElementById('network') as HTMLSelectElement;
network.onchange = () => { lab = new NetworkLab(network.value as ProfileName); clearInput(); };
const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const keys = new Set<string>(), mouse = { x: 256, y: 256 };
const colors = ['#a2e8c5', '#edb96d', '#e2776f'];

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
    if (response.status === 401 && connection === c && c && path !== 'resume') {
        disconnectLocal('Connection lost · recovering reserved actor…');
        void recover();
    }
    if (!response.ok) {
        if (data.resync && connection === c && replica) { replica.reset(); predictor = new MotionPredictor(c!.actorId); clearInput(); }
        throw new Error(data.error ?? data.reason ?? 'Request rejected');
    }
    return data;
}
function disconnectLocal(message: string) {
    connection = undefined; clearInput(); join.disabled = false; leave.disabled = true;
    predictor = undefined; remote = new RemoteInterpolator();
    actions = new ActionOutbox();
    status.textContent = message;
}
function install(c: Connection) {
    if (c.protocol !== PROTOCOL_VERSION || c.schema !== TERRAIN_SCHEMA) throw new Error('Client/host versions differ · reload.');
    connection = c;
    document.getElementById('mode')!.textContent = c.scene === 'coop' ? 'Co-op test: two allies, no friendly fire. Aim at the red training sentinel or press E with the pointer centered. The sentinel is stationary; encounter AI comes later.' : 'Sparring test: player attacks can hurt each other.';
    replica = new ReplicaClient(c.sessionId);
    predictor = new MotionPredictor(c.actorId); remote = new RemoteInterpolator();
    lastLiveAt = 0; lastSyncAt = 0; lastFrameAt = performance.now(); motionAcc = 0; motionAt = performance.now();
    frame = undefined; sequence = 0; clearInput();
    actions = new ActionOutbox();
    terrain.cells = new World().cells; drawnRevision = -999;
    leave.disabled = false; join.disabled = true; canvas.focus();
    status.textContent = `Synchronizing player ${c.actorId + 1} · input paused`;
    readout.textContent = 'Rebuilding authoritative arena · controls unlock after the snapshot completes.';
}
async function recover() {
    if (!recovery || recovering || connection) return;
    recovering = true; join.disabled = true;
    const saved = recovery;
    if (!recoveryAttempt) { recoveryAttempt = ++saved.sequence; saveRecovery(); }
    try {
        // An identical sequence is retried after response loss; never replay inputs.
        const fault = lab.next(); await wait(fault.up);
        if (fault.dropRequest) throw new Error('Network test dropped recovery request');
        const response = await fetch('/api/resume', { method: 'POST', cache: 'no-store',
            headers: { Authorization: `Bearer ${saved.token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: saved.sessionId, sequence: recoveryAttempt }), signal: AbortSignal.timeout(1500) });
        const data = await response.json(); await wait(fault.down);
        if (fault.dropResponse) throw new Error('Network test dropped recovery response');
        if (recovery !== saved) return;
        if (response.status === 409 && data.retryRecovery) {
            recoveryAttempt = 0; status.textContent = 'Recovery lease lapsed · retrying with a fresh generation'; return;
        }
        if (response.status === 401 || response.status === 409) {
            recovery = undefined; recoveryAttempt = 0; saveRecovery();
            disconnectLocal('Session ended or reservation expired · Join arena for a fresh seat.'); return;
        }
        if (!response.ok) throw new Error(data.error ?? 'Recovery unavailable');
        install(data); recoveryAttempt = 0;
        await poll();
    } catch (error) {
        if (recovery === saved) status.textContent = `Host unavailable · recovery pending · ${(error as Error).message}`;
    } finally { recovering = false; if (!connection) join.disabled = false; }
}
join.onclick = async () => {
    if (joining || recovering || connection) return;
    if (recovery) { void recover(); return; }
    joining = true; join.disabled = true; status.textContent = 'Joining…';
    try {
        const c: Connection = await request('join', undefined, {});
        install(c);
        recovery = { token: c.recoveryToken, sessionId: c.sessionId, sequence: 0 }; saveRecovery();
        await poll();
    } catch (error) { disconnectLocal((error as Error).message); }
    finally { joining = false; if (!connection) join.disabled = false; }
};
leave.onclick = async () => {
    const c = connection;
    recovery = undefined; recoveryAttempt = 0; saveRecovery();
    disconnectLocal('Left arena · join to take an available seat.');
    if (c) try { await request('leave', c, {}); } catch { /* Lease expiry also releases the seat. */ }
};
// Closing/reloading suspends the lease; explicit Leave alone releases the reservation.
addEventListener('pagehide', clearInput);
canvas.addEventListener('pointermove', event => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = Math.max(0, Math.min(SIZE, (event.clientX - rect.left) / rect.width * SIZE));
    mouse.y = Math.max(0, Math.min(SIZE, (event.clientY - rect.top) / rect.height * SIZE));
});
canvas.addEventListener('pointerdown', event => { if (event.button === 0 && connection && replica?.ready) { canvas.focus(); held = true; } });
addEventListener('pointerup', () => { held = false; });
canvas.addEventListener('contextmenu', event => event.preventDefault());
addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', clearInput);
canvas.addEventListener('keydown', event => {
    if (!connection || !replica?.ready) return;
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
    if (performance.now() - lastLiveAt > 400) { clearInput(); return; }
    sending++;
    const input = currentInput(), sentSequence = ++sequence;
    if (fire || dash || ((held || keys.has('Digit1')) && performance.now() - lastHeldFire >= 250)) {
        if (!actions.enqueue(input, frame.tick + 120)) status.textContent = 'Action queue full · release controls';
        lastHeldFire = performance.now();
    }
    delete input.fire; delete input.dash;
    predictor?.noteCommand(sentSequence);
    fire = undefined; dash = false;
    try {
        await request('command', c, { sessionId: c.sessionId,
            command: { generation: c.generation, sequence: sentSequence, actorId: c.actorId, input } });
    } catch (error) {
        if (connection === c) status.textContent = `Input: ${(error as Error).message}`;
    } finally { sending--; }
}
async function sendAction() {
    const c = connection, outbox = actions, action = outbox.next;
    if (!c || !replica?.ready || !action || actionSending) return;
    actionSending = true;
    try {
        const result = await request('action', c, { sessionId: c.sessionId,
            command: { generation: c.generation, actorId: c.actorId, ...action } });
        if (connection === c && actions === outbox) outbox.acknowledge(result.receipt);
    } catch (error) { if (connection === c) status.textContent = `Action retry: ${(error as Error).message}`; }
    finally { actionSending = false; }
}
function acceptLive(next: DisplayFrame, started: number) {
    if (frame && next.tick <= frame.tick) return;
    validateDisplayFrame(next, frame);
    frame = next; lastLiveAt = performance.now(); rtt = lastLiveAt - started;
    actions.acknowledge(next.receipt);
    frameTickAt = next.tick + rtt / 2 / 1000 / DT;
    lastFrameAt = lastLiveAt;
    predictor!.setTerrain(terrain.cells);
    predictor!.reconcile(next, predictor!.tick - Math.round(rtt / 2 / 1000 / DT), rtt / 2 / 1000 / DT);
    remote.push(next);
}
async function pollLive() {
    const c = connection;
    if (!c || !replica?.ready || livePolling >= 3) return;
    livePolling++; const started = performance.now();
    try {
        const data = await request('live', c);
        if (connection !== c) return;
        if (data.sessionId !== c.sessionId || data.protocol !== PROTOCOL_VERSION || data.schema !== TERRAIN_SCHEMA) throw new Error('Live frame version/session mismatch');
        lastFrameAt = performance.now();
        acceptLive(data.state, started);
    } catch (error) { if (connection === c) status.textContent = `Live state: ${(error as Error).message}`; }
    finally { livePolling--; }
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
        lastFrameAt = performance.now();
        let result;
        try { result = activeReplica.apply(next); }
        catch { activeReplica.reset(); predictor = new MotionPredictor(c.actorId); clearInput(); status.textContent = 'Synchronizing arena again…'; return; }
        lastSyncAt = performance.now();
        if (result === 'ignored') return;
        if (result === 'partial') { status.textContent = `Synchronizing arena · ${activeReplica.progress} cells`; return; }
        terrain.cells = activeReplica.cells;
        predictor!.setTerrain(terrain.cells);
        if (!frame) acceptLive(activeReplica.state!, performance.now());
        status.textContent = `Player ${c.actorId + 1} connected · shared training arena`;
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
    const interpolated = connection ? remote.sample(frameTickAt + Math.max(0, performance.now() - lastLiveAt) / 1000 / DT) : frame.actors;
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
        ctx.fillText(`${a.id === 2 ? 'Sentinel' : `P${a.id + 1}`} · ${Math.round(a.hp)} hp`, a.x, y - 10);
    }
    readout.textContent = frame.actors.map(a => `${a.id === 2 ? 'Sentinel' : `P${a.id + 1}`}: ${Math.round(a.hp)} hp · ${Math.round(a.qi)} qi · ${a.z.toFixed(1)}m altitude${a.hp <= 0 ? ' · defeated' : ''}`).join('    ') +
        `\nShared tick ${frame.tick} · terrain ${replica?.revision}/${frame.revision} · ${frame.destroyed} cover destroyed · live round trip ${Math.round(rtt)} ms` +
        `\nInput received ${frame.receipt.received} · applied through ${frame.receipt.applied} · pending ${predictor?.pendingCount ?? 0}` +
        `\nActions consumed ${frame.receipt.actionApplied ?? 0}/${frame.receipt.actionReceived ?? 0} · pending ${actions.size}` +
        `\nCorrection ${(predictor?.correction ?? 0).toFixed(2)}m · motion buffer ${Math.round((predictor?.bufferTicks ?? 0) * DT * 1000)}ms · state age ${Math.round(performance.now() - lastLiveAt)}ms · received ${(traffic / 1024).toFixed(0)} KiB · lab drops ${lab.dropped}`;
}
setInterval(() => { void sendInput(); }, 1000 / 30);
setInterval(() => { void sendAction(); }, 75);
// Fill paged transfers promptly, then retain the original 10 Hz observation cadence.
setInterval(() => { if (replica?.syncing || performance.now() - lastSyncAt >= 100) void poll(); }, 25);
setInterval(() => { void pollLive(); }, 50);
setInterval(() => {
    if (!connection && recovery) void recover();
    if (connection && lastFrameAt && performance.now() - lastFrameAt > 2000) {
        disconnectLocal('Host unavailable · recovering reserved actor…'); void recover();
    }
}, 500);
function render(now: number) {
    motionAcc += Math.min(.1, Math.max(0, (now - motionAt) / 1000)); motionAt = now;
    while (motionAcc >= DT) {
        if (connection && frame && replica?.ready) predictor?.advance(currentInput(), now - lastLiveAt <= 400);
        motionAcc -= DT;
    }
    if (connection && frame && replica?.ready && lastLiveAt) status.textContent = performance.now() - lastLiveAt > 400 ?
        'Waiting for authoritative state · prediction paused' :
        `Player ${connection.actorId + 1} connected · ${replica.revision < frame.revision ? 'terrain catching up' : 'shared training arena'}`;
    draw(); requestAnimationFrame(render);
}
requestAnimationFrame(render);
if (recovery) void recover();
