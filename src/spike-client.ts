import { World, GRID, CELL, SIZE, DT, REALMS } from './sim.ts';
import type { ActorInput, Technique, Actor } from './sim.ts';
import { StudyView } from './study-view.ts';
import { targetInRange, LOCK_RANGE } from './targeting.ts';
import { ReplicaClient, PROTOCOL_VERSION, TERRAIN_SCHEMA, validateDisplayFrame, captureDisplayFrame } from './replication.ts';
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
const ctx = canvas.getContext('2d', { alpha: false })!;
const join = document.getElementById('join') as HTMLButtonElement;
const leave = document.getElementById('leave') as HTMLButtonElement;
const status = document.getElementById('status')!;
const readout = document.getElementById('readout')!;
const retry = document.getElementById('retry') as HTMLButtonElement;
const encounterStatus = document.getElementById('encounter-status')!;
const loadoutStatus = document.getElementById('loadout-status')!;
// Used only as the deterministic display baseline/height lookup. Never stepped here.
const terrain = new World();
const study = new StudyView(terrain), preview = captureDisplayFrame(terrain, 0, { received: 0, applied: 0 });
let studyMode = true, lastDrawAt = performance.now(), lastHudAt = 0;
let performanceAt = performance.now(), performanceFrames = 0, performanceTotal = 0, performanceTerrain = 0, performanceScenery = 0;
const performanceReadout = document.createElement('p'); performanceReadout.id = 'render-performance'; document.querySelector('#diagnostics summary')!.after(performanceReadout);
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
let pointerMoved = false;
function resize() {
    canvas.width = Math.round(innerWidth * devicePixelRatio); canvas.height = Math.round(innerHeight * devicePixelRatio);
    if (!pointerMoved) { mouse.x = innerWidth * .6; mouse.y = innerHeight * .52; }
}
addEventListener('resize', resize); resize();
const viewButton = document.getElementById('view')!;
viewButton.onclick = () => { studyMode = !studyMode; clearInput(); viewButton.textContent = studyMode ? 'Study · 2.5D' : 'Diagnostic · overhead'; study.clear(); };
const sound = document.getElementById('sound') as HTMLInputElement;
sound.onchange = () => { study.impact.sound = sound.checked; if (sound.checked) study.impact.unlock(); };
const motion = document.getElementById('motion') as HTMLInputElement;
motion.checked = !study.impact.reduced; motion.onchange = () => { study.impact.reduced = !motion.checked; };
document.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach(b => b.onclick = () => { if (connection && replica?.ready) { fire = equippedSlot(Number(b.dataset.slot)); canvas.focus(); } });
function displayActors(): Actor[] {
    if (!frame) return preview.actors;
    const sampled = connection ? remote.sample(frameTickAt + Math.max(0, performance.now() - lastLiveAt) / 1000 / DT) : frame.actors;
    return (sampled.length ? sampled : frame.actors).map(a => a.id === connection?.actorId && predictor?.actor ? predictor.actor : a);
}
function overheadPointer() {
    const scale = Math.min(innerWidth, innerHeight) / SIZE;
    return { x: (mouse.x - (innerWidth - SIZE * scale) / 2) / scale, y: (mouse.y - (innerHeight - SIZE * scale) / 2) / scale };
}
const colors = ['#a2e8c5', '#edb96d', '#e2776f'];
const actorColor = (id: number) => colors[Math.min(id, 2)];
const actorLabel = (a: { id: number; enemyId?: string }) => a.id < 2 ? `P${a.id + 1}` : a.enemyId === 'sentinel' ? 'Sentinel' : `Skirmisher ${a.id - 1}`;
const techniqueName = (kind: Technique | null) => kind === 'bolt' ? 'Seeking bolts' : kind === 'slash' ? 'Crescent' : kind === 'nova' ? 'Falling Heaven' : 'empty';
function equippedSlot(slot: number): Technique | undefined {
    const actor = frame?.actors.find(a => a.id === connection?.actorId);
    if (!actor?.loadoutId) return (['bolt', 'slash', 'nova'] as const)[slot];
    return frame?.loadouts.find(l => l.id === actor.loadoutId)?.slots[slot] ?? undefined;
}

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
    study.clear();
    status.textContent = message;
}
function install(c: Connection) {
    if (c.protocol !== PROTOCOL_VERSION || c.schema !== TERRAIN_SCHEMA) throw new Error('Client/host versions differ · reload.');
    connection = c;
    document.getElementById('mode')!.textContent = c.scene === 'skirmish' ? 'Encounter test: three flying skirmishers. Amber corridors warn of crescent direction and altitude. Hold R while still within 4m of a fallen ally for 2s to revive at half health/qi. Damage interrupts. Retry after victory or a party wipe restores everyone; terrain scars remain.' : c.scene === 'coop' ? 'Co-op test: two allies, no friendly fire. Aim at the red training sentinel or press E with the pointer centered. The sentinel is stationary.' : 'Sparring test: player attacks can hurt each other.';
    replica = new ReplicaClient(c.sessionId);
    predictor = new MotionPredictor(c.actorId); remote = new RemoteInterpolator();
    lastLiveAt = 0; lastSyncAt = 0; lastFrameAt = performance.now(); motionAcc = 0; motionAt = performance.now();
    frame = undefined; sequence = 0; clearInput();
    study.clear();
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
retry.onclick = async () => {
    const c = connection, e = frame?.encounter;
    if (!c || !e || !replica?.ready) return;
    retry.disabled = true;
    try { await request('retry', c, { sessionId: c.sessionId, command: { generation: c.generation, round: e.epoch } }); }
    catch (error) { if (connection === c) status.textContent = `Retry: ${(error as Error).message}`; }
};
// Closing/reloading suspends the lease; explicit Leave alone releases the reservation.
addEventListener('pagehide', clearInput);
canvas.addEventListener('pointermove', event => {
    const rect = canvas.getBoundingClientRect();
    mouse.x = event.clientX - rect.left; mouse.y = event.clientY - rect.top; pointerMoved = true;
});
canvas.addEventListener('pointerdown', event => {
    const rect = canvas.getBoundingClientRect(); mouse.x = event.clientX - rect.left; mouse.y = event.clientY - rect.top; pointerMoved = true;
    if (connection && replica?.ready) {
        canvas.focus(); if (sound.checked) study.impact.unlock();
        if (event.button === 0) held = true;
        if (event.button === 1 && studyMode) { event.preventDefault(); const a = displayActors(); study.toggleLock(mouse, a, a.find(a => a.id === connection!.actorId)!); }
    }
});
canvas.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
canvas.addEventListener('wheel', e => { if (studyMode) { e.preventDefault(); study.camera.targetZoom = Math.max(2.5, Math.min(14, study.camera.targetZoom * Math.exp(-e.deltaY * .0015))); } }, { passive: false });
addEventListener('pointerup', () => { held = false; });
canvas.addEventListener('contextmenu', event => event.preventDefault());
addEventListener('blur', clearInput);
document.addEventListener('visibilitychange', clearInput);
canvas.addEventListener('keydown', event => {
    if (!connection || !replica?.ready) return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyR', 'ShiftLeft', 'ShiftRight', 'Digit1', 'Digit2', 'Digit3', 'KeyQ', 'KeyE'].includes(event.code)) event.preventDefault();
    keys.add(event.code);
    if (event.repeat) return;
    if (event.code === 'KeyT' && studyMode) { const a = displayActors(); study.toggleLock(mouse, a, a.find(a => a.id === connection!.actorId)!); }
    if (event.code.startsWith('Shift')) dash = true;
    if (event.code === 'KeyQ' || event.code === 'Digit2') fire = equippedSlot(1);
    if (event.code === 'KeyE' || event.code === 'Digit3') fire = equippedSlot(2);
});
addEventListener('keyup', event => keys.delete(event.code));

function currentInput(): ActorInput {
    const actor = frame!.actors.find(a => a.id === connection!.actorId)!;
    const point = overheadPointer();
    const target = frame!.actors.find(a => targetInRange(actor, a, LOCK_RANGE) && Math.hypot(a.x - point.x, a.y - a.z * .25 - point.y) < 10);
    const direction = { x: Number(keys.has('KeyD')) - Number(keys.has('KeyA')), y: Number(keys.has('KeyS')) - Number(keys.has('KeyW')) };
    const aim = studyMode ? study.aim(mouse, displayActors(), actor) : target ? { x: target.x, y: target.y, z: target.z + .7, targetId: target.id } :
        { x: point.x, y: point.y, z: terrain.groundHeight(point.x, point.y) + .7 };
    aim.x = Math.max(-SIZE, Math.min(SIZE * 2, aim.x)); aim.y = Math.max(-SIZE, Math.min(SIZE * 2, aim.y));
    return { move: studyMode ? study.camera.movement(direction.x, direction.y) : direction,
        climb: Number(keys.has('KeyF')) - Number(keys.has('KeyG')), autoAltitude: true,
        aim,
        fire: fire ?? (held || keys.has('Digit1') ? equippedSlot(0) : undefined), dash, revive: keys.has('KeyR') };
}
async function sendInput() {
    const c = connection;
    if (!c || !frame || sending >= 6 || !replica?.ready) return;
    if (performance.now() - lastLiveAt > 400) { clearInput(); return; }
    sending++;
    const input = currentInput(), sentSequence = ++sequence;
    if (fire || dash || ((held || keys.has('Digit1')) && performance.now() - lastHeldFire >= 250)) {
        if (!actions.enqueue(input, frame.tick + 120, frame.encounter?.epoch)) status.textContent = 'Action queue full · release controls';
        lastHeldFire = performance.now();
    }
    delete input.fire; delete input.dash;
    predictor?.noteCommand(sentSequence);
    fire = undefined; dash = false;
    try {
        await request('command', c, { sessionId: c.sessionId,
            command: { generation: c.generation, sequence: sentSequence, actorId: c.actorId, input, round: frame?.encounter?.epoch } });
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
    if (frame?.encounter?.epoch !== next.encounter?.epoch) {
        clearInput(); actions.reset(next.receipt);
        predictor = new MotionPredictor(connection!.actorId); remote = new RemoteInterpolator();
    }
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
    const now = performance.now(), dt = Math.min(.1, (now - lastDrawAt) / 1000); lastDrawAt = now;
    const actors = displayActors();
    if (studyMode) {
        ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
        study.draw(ctx, frame ?? preview, actors, connection?.actorId ?? 0, terrain.cells, frame ? (replica?.revision ?? 0) : 0, innerWidth, innerHeight, dt, mouse);
    } else {
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); ctx.fillStyle = '#0d1918'; ctx.fillRect(0, 0, innerWidth, innerHeight);
    const scale = Math.min(innerWidth, innerHeight) / SIZE;
    ctx.translate((innerWidth - SIZE * scale) / 2, (innerHeight - SIZE * scale) / 2); ctx.scale(scale, scale);
    if (drawnRevision !== (replica?.revision ?? -1)) {
        terrainCtx.setTransform(terrainLayer.width / SIZE, 0, 0, terrainLayer.height / SIZE, 0, 0);
        for (let i = 0; i < terrain.cells.length; i++) {
            const c = terrain.cells[i], shade = Math.round(56 + c.elevation * 1.1 - c.depth * 2);
            terrainCtx.fillStyle = c.hp > 0 ? c.kind === 1 ? '#345541' : '#67746a' : `rgb(${shade},${shade + 15},${shade + 4})`;
            terrainCtx.fillRect(i % GRID * CELL, Math.floor(i / GRID) * CELL, CELL + .1, CELL + .1);
        }
        drawnRevision = replica?.revision ?? -1;
    }
    ctx.drawImage(terrainLayer, 0, 0, SIZE, SIZE);
    }
    const updateHud = now - lastHudAt >= 100;
    if (updateHud) {
    lastHudAt = now;
    retry.hidden = !frame?.encounter;
    retry.disabled = !connection || !replica?.ready || !['completed', 'defeated'].includes(frame?.encounter?.phase ?? '');
    const e = frame?.encounter;
    const ownActor = frame?.actors.find(a => a.id === connection?.actorId);
    const ownLoadout = frame?.loadouts.find(l => l.id === ownActor?.loadoutId);
    loadoutStatus.textContent = ownLoadout ? `${ownLoadout.name} · click / 1: ${techniqueName(ownLoadout.slots[0])} · Q / 2: ${techniqueName(ownLoadout.slots[1])} · E / 3: ${techniqueName(ownLoadout.slots[2])} · assigned by host` : connection && frame ? 'Combat study slots · click / 1: Seeking bolts · Q / 2: Crescent · E / 3: Falling Heaven' : '';
    encounterStatus.textContent = e ? `Attempt ${e.attempt} · ${e.phase === 'completed' ? 'Victory — retry available' : e.phase === 'defeated' ? 'Party defeated — retry available' : e.phase === 'returning' ? 'Enemies returning — controls paused; enemy health resets; player health and terrain remain' : e.phase}${e.revives.map(r => ` · P${r.actorId + 1} reviving P${r.targetId + 1}: ${Math.floor(r.progress / r.duration * 100)}%`).join('')}` : '';
    if (!frame) return;
    const local = frame.actors.find(a => a.id === connection?.actorId);
    document.getElementById('vital')!.textContent = local ? `${Math.ceil(local.hp)} / ${local.maxHp} VITALITY · ${Math.floor(local.qi)} QI · ${Math.round(local.ward)} WARD` : 'Join to enter';
    document.getElementById('altitude')!.textContent = local ? `${(local.z - terrain.groundHeight(local.x, local.y)).toFixed(1)}m above ground · ${REALMS[local.realm]}` : '';
    document.getElementById('party')!.textContent = frame.actors.filter(a => a.id < 2).map(a => `P${a.id + 1} · ${Math.ceil(a.hp)} / ${a.maxHp} hp${frame!.encounter && !frame!.encounter.participants.includes(a.id) ? ' · unjoined' : a.hp <= 0 ? ' · fallen' : ''}`).join('\n');
    document.getElementById('enemies')!.textContent = frame.actors.filter(a => a.id >= 2).map(a => `${actorLabel(a)} · ${Math.ceil(a.hp)} hp · ${a.z.toFixed(0)}m`).join('\n');
    document.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach(b => {
        const slot = Number(b.dataset.slot), kind = equippedSlot(slot), index = ['bolt', 'slash', 'nova'].indexOf(kind ?? '');
        b.disabled = !connection || !replica?.ready || !local?.hp || !kind || (!!e && e.phase !== 'active');
        b.querySelector('strong')!.textContent = techniqueName(kind ?? null);
        b.querySelector('small')!.textContent = !kind ? 'Not equipped' : local && local.cool[index] > .01 ? `${local.cool[index].toFixed(1)}s cooldown` : 'Ready';
    });
    }
    if (!frame) return;
    if (!studyMode) {
    for (const t of frame.telegraphs) {
        const owner = frame.actors.find(a => a.id === t.owner)!;
        const angle = Math.atan2(t.aim.y - owner.y, t.aim.x - owner.x), span = 4 + 3 * owner.realm;
        const range = 36 * Math.pow(1.65, owner.realm), co = Math.cos(angle), si = Math.sin(angle);
        const slope = (t.aim.z - owner.z - .7) / Math.max(1, Math.hypot(t.aim.x - owner.x, t.aim.y - owner.y) - span * .2);
        const reach = range / Math.sqrt(1 + slope * slope);
        ctx.save(); ctx.setLineDash([3, 2]); ctx.strokeStyle = '#ffdb82'; ctx.fillStyle = '#ffcf6726'; ctx.lineWidth = 1;
        if (t.kind === 'slash') {
            ctx.beginPath();
            for (const [d, side] of [[-span, -span], [reach + span, -span], [reach + span, span], [-span, span]]) {
                const x = owner.x + co * d - si * side, y = owner.y + si * d + co * side - (owner.z + .7 + slope * d) * .25;
                if (d === -span && side === -span) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.closePath(); ctx.fill(); ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(owner.x, owner.y - (owner.z + .7) * .25); ctx.lineTo(t.aim.x, t.aim.y - t.aim.z * .25); ctx.stroke();
        circle(t.aim.x, t.aim.y - t.aim.z * .25, 4, '#ffdb82', true);
        ctx.setLineDash([]); ctx.font = '7px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#ffedbb';
        ctx.fillText(`${t.kind} ${t.remaining.toFixed(1)}s · ${t.aim.z.toFixed(0)}m`, owner.x, owner.y - owner.z * .25 - 20);
        ctx.restore();
    }
    for (const c of frame.casts) circle(c.x, c.y, c.radius, actorColor(c.owner), true);
    for (const b of frame.bolts) if (b.launched) circle(b.x, b.y - b.z * .25, 1.4, actorColor(b.owner));
    for (const wave of frame.waves) {
        ctx.beginPath(); ctx.arc(wave.x, wave.y - wave.z * .25, wave.span, wave.angle - .8, wave.angle + .8);
        ctx.strokeStyle = actorColor(wave.owner); ctx.lineWidth = 2; ctx.stroke();
    }
    for (const a of actors) {
        const y = a.y - a.z * .25;
        circle(a.x, a.y, 4, '#1b2825');
        ctx.strokeStyle = '#aac3ac'; ctx.lineWidth = .5;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(a.x, y); ctx.stroke();
        circle(a.x, y, 3.5, a.hp > 0 ? actorColor(a.id) : '#635f55');
        if (a.id === connection?.actorId) circle(a.x, y, 6, '#fff3d1', true);
        if (a.dashLeft > 0) circle(a.x, y, 8, actorColor(a.id), true);
        ctx.font = '7px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff0cc';
        ctx.fillText(`${actorLabel(a)} · ${Math.round(a.hp)} hp`, a.x, y - 10);
    }
    }
    if (updateHud && document.getElementById('diagnostics')!.hasAttribute('open')) readout.textContent = frame.actors.map(a => `${actorLabel(a)}${a.loadoutId ? ` (${frame!.loadouts.find(l => l.id === a.loadoutId)!.name})` : ''}: ${Math.round(a.hp)} hp · ${Math.round(a.qi)} qi · ${a.z.toFixed(1)}m altitude${a.hp <= 0 ? ' · defeated' : ''}`).join('    ') +
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
    draw();
    performanceFrames++; performanceTotal += study.timings.total; performanceTerrain += study.timings.terrain; performanceScenery += study.timings.scenery;
    if (now - performanceAt >= 1000) {
        performanceReadout.textContent = `${Math.round(performanceFrames * 1000 / (now - performanceAt))} fps · render ${(performanceTotal / performanceFrames).toFixed(1)}ms · terrain ${(performanceTerrain / performanceFrames).toFixed(1)}ms · scenery ${(performanceScenery / performanceFrames).toFixed(1)}ms`;
        performanceAt = now; performanceFrames = performanceTotal = performanceTerrain = performanceScenery = 0;
    }
    requestAnimationFrame(render);
}
requestAnimationFrame(render);
if (recovery) void recover();
