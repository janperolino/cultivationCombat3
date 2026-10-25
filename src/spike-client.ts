import { World, GRID, CELL, SIZE } from './sim.ts';
import type { Actor, ActorInput, Technique } from './sim.ts';
import { targetInRange, LOCK_RANGE } from './targeting.ts';

type Connection = { token: string; actorId: number; generation: number; sessionId: string };
type Frame = {
    sessionId: string; tick: number; time: number; revision: number; destroyed: number;
    actors: Actor[]; changedCells: number[][]; droppedTime: number;
    bolts: { x: number; y: number; z: number; owner: number; launched: boolean }[];
    waves: { x: number; y: number; z: number; owner: number; span: number; angle: number }[];
    casts: { x: number; y: number; z: number; owner: number; radius: number; left: number }[];
};
const canvas = document.getElementById('arena') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const join = document.getElementById('join') as HTMLButtonElement;
const leave = document.getElementById('leave') as HTMLButtonElement;
const status = document.getElementById('status')!;
const readout = document.getElementById('readout')!;
// Used only as the deterministic display baseline/height lookup. Never stepped here.
const terrain = new World();
let connection: Connection | undefined, frame: Frame | undefined, sequence = 0;
let joining = false, sending = false, polling = false, held = false, dash = false;
let fire: Technique | undefined, lastFrameAt = 0, rtt = 0;
const keys = new Set<string>(), mouse = { x: 256, y: 256 };
const colors = ['#a2e8c5', '#edb96d'];

function clearInput() { keys.clear(); held = false; dash = false; fire = undefined; }
async function request(path: string, c?: Connection, body?: unknown) {
    const response = await fetch(`/api/${path}`, {
        method: body === undefined ? 'GET' : 'POST', cache: 'no-store',
        headers: { ...(c ? { Authorization: `Bearer ${c.token}` } : {}),
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(1500),
    });
    const data = await response.json();
    if (response.status === 401 && connection === c) disconnectLocal('Connection expired · join again.');
    if (!response.ok) throw new Error(data.error ?? data.reason ?? 'Request rejected');
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
        frame = undefined; sequence = 0; clearInput();
        terrain.cells = new World().cells;
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

async function sendInput() {
    const c = connection;
    if (!c || !frame || sending) return;
    sending = true;
    const actor = frame.actors.find(a => a.id === c.actorId)!;
    const target = frame.actors.find(a => targetInRange(actor, a, LOCK_RANGE) && Math.hypot(a.x - mouse.x, a.y - a.z * .25 - mouse.y) < 10);
    const input: ActorInput = {
        move: { x: Number(keys.has('KeyD')) - Number(keys.has('KeyA')), y: Number(keys.has('KeyS')) - Number(keys.has('KeyW')) },
        climb: Number(keys.has('KeyF')) - Number(keys.has('KeyG')), autoAltitude: true,
        aim: target ? { x: target.x, y: target.y, z: target.z + .7, targetId: target.id } :
            { ...mouse, z: terrain.groundHeight(mouse.x, mouse.y) + .7 },
        fire: fire ?? (held || keys.has('Digit1') ? 'bolt' : undefined), dash,
    };
    fire = undefined; dash = false;
    try {
        await request('command', c, { sessionId: c.sessionId,
            command: { generation: c.generation, sequence: ++sequence, actorId: c.actorId, input } });
    } catch (error) {
        if (connection === c) status.textContent = `Input: ${(error as Error).message}`;
    } finally { sending = false; }
}
async function poll() {
    const c = connection;
    if (!c || polling) return;
    polling = true;
    const started = performance.now();
    try {
        const next: Frame = await request('state', c);
        if (connection !== c) return;
        if (next.sessionId !== c.sessionId) { disconnectLocal('Host restarted · join again.'); return; }
        if (frame && next.tick < frame.tick) return;
        frame = next; lastFrameAt = performance.now(); rtt = lastFrameAt - started;
        for (const [i, kind, hp, depth, elevation] of frame.changedCells) Object.assign(terrain.cells[i], { kind, hp, depth, elevation });
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
    for (let i = 0; i < terrain.cells.length; i++) {
        const c = terrain.cells[i], shade = Math.round(56 + c.elevation * 1.1 - c.depth * 2);
        ctx.fillStyle = c.hp > 0 ? c.kind === 1 ? '#345541' : '#67746a' : `rgb(${shade},${shade + 15},${shade + 4})`;
        ctx.fillRect(i % GRID * CELL, Math.floor(i / GRID) * CELL, CELL + .1, CELL + .1);
    }
    if (!frame) return;
    for (const c of frame.casts) circle(c.x, c.y, c.radius, colors[c.owner], true);
    for (const b of frame.bolts) if (b.launched) circle(b.x, b.y - b.z * .25, 1.4, colors[b.owner]);
    for (const wave of frame.waves) {
        ctx.beginPath(); ctx.arc(wave.x, wave.y - wave.z * .25, wave.span, wave.angle - .8, wave.angle + .8);
        ctx.strokeStyle = colors[wave.owner]; ctx.lineWidth = 2; ctx.stroke();
    }
    for (const a of frame.actors) {
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
        `\nShared tick ${frame.tick} · terrain ${frame.revision} · ${frame.destroyed} cover destroyed · state round trip ${Math.round(rtt)} ms`;
}
setInterval(() => { void sendInput(); }, 1000 / 30);
setInterval(() => { void poll(); }, 100);
setInterval(() => {
    if (connection && lastFrameAt && performance.now() - lastFrameAt > 2000) status.textContent = 'Host unavailable · showing last received state.';
}, 500);
draw();
