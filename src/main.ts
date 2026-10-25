import { dashProfile } from './time-flow.ts';
import { cursorTarget, targetInRange, LOCK_RANGE } from './targeting.ts';
import type { Aim } from './targeting.ts';
import { HeightTerrain } from './height-terrain.ts';
import { project, unproject, lift, pickSurface, TILT, YAW } from './projection.ts';
import { DepthScene } from './depth-scene.ts';
import { TechniqueVisuals } from './technique-visuals.ts';
import { ImpactPresentation } from './impact.ts';
import { World, SIZE, CELL, GRID, DT, REALMS, power } from './sim.ts';
import type { Vec, Technique, Actor } from './sim.ts';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('world'), ctx = canvas.getContext('2d')!;
let world = new World(), paused = true, cinema = false, zoom = 6, targetZoom = 6, w = innerWidth, h = innerHeight, cam = { x: 256, y: 256 }, mouse = { x: w * .58, y: h * .5 }, held = false, acc = 0, last = 0, lastSave = -1, saveAt = 0;
const keys = new Set<string>();
const impact = new ImpactPresentation();
const visuals = new TechniqueVisuals();
const depthScene = new DepthScene();
const heightTerrain = new HeightTerrain();
let tilted = true;
function toggleView() { tilted = !tilted; terrainRevision = -1; $("view").textContent = tilted ? "V · 2.5D VIEW" : "V · TOP-DOWN"; notice(tilted ? "Tilted battlefield · hovering flight" : "Top-down battlefield"); }
function movement(): Vec { return unproject({ x: Number(keys.has("KeyD")) - Number(keys.has("KeyA")), y: Number(keys.has("KeyS")) - Number(keys.has("KeyW")) }, tilted); }
let previous = world.actors.map(a => ({ x: a.x, y: a.y, z: a.z }));
let dashQueued = false;
let lockedId: number | null = null;
function renderedActors(): Actor[] { const alpha = paused || impact.hitStop > 0 ? 1 : Math.min(1, acc / DT); return world.actors.map((a, i) => ({ ...a, x: previous[i].x + (a.x - previous[i].x) * alpha, y: previous[i].y + (a.y - previous[i].y) * alpha, z: previous[i].z + (a.z - previous[i].z) * alpha })); }
function dash() {
    if (paused)
        return;
    dashQueued = true;
    impact.unlock();
}
function notice(message: string) { $('notice').textContent = message; }
try {
    const raw = localStorage.getItem('severed-terrain-v1');
    if (raw) {
        world.loadTerrain(raw);
        world.actors.forEach(a => a.z = world.groundHeight(a.x, a.y) + 3);
        notice('The ground remembers your last battle.');
    }
}
catch {
    notice('Terrain save unavailable. This session is still playable.');
}
function resize() { w = innerWidth; h = innerHeight; canvas.width = w * devicePixelRatio; canvas.height = h * devicePixelRatio; ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0); }
resize();
addEventListener('resize', resize);
function actorScreen(a: Actor, height: number): Vec { const p = project({ x: a.x - cam.x, y: a.y - cam.y }, tilted), shake = impact.offset(); return { x: w * .57 + p.x * zoom + shake.x, y: h * .5 + (p.y - (tilted ? height : 0)) * zoom + shake.y }; }
function hoveredTarget(): Actor | undefined {
    const candidates = world.actors.filter(a => a.id !== 0 && a.hp > 0).map(actor => ({ actor, screen: actorScreen(actor, actor.z + 1), ground: actorScreen(actor, world.groundHeight(actor.x, actor.y)) })).filter(c => Math.max(c.screen.x, c.ground.x) > 0 && Math.min(c.screen.x, c.ground.x) < w && Math.max(c.screen.y, c.ground.y) > 0 && Math.min(c.screen.y, c.ground.y) < h);
    return cursorTarget(world.actors[0], mouse, candidates);
}
function assistedTarget(): Actor | undefined {
    if (lockedId !== null) {
        const target = world.actors.find(a => a.id === lockedId);
        if (target && targetInRange(world.actors[0], target, LOCK_RANGE))
            return target;
        lockedId = null;
        notice('Soft lock released · target lost');
    }
    return hoveredTarget();
}
function toggleLock() {
    const hovered = hoveredTarget();
    if (lockedId !== null) {
        lockedId = null;
        notice('Soft lock released · cursor assistance active');
        return;
    }
    if (hovered) {
        lockedId = hovered.id;
        notice('Soft lock acquired · T / middle-click to release');
    }
    else
        notice('Aim near a rival, then press T or middle-click to lock.');
}
function screenWorld(): Aim {
    const target = assistedTarget();
    if (target)
        return { x: target.x, y: target.y, z: target.z + .7, targetId: target.id, locked: lockedId === target.id };
    const shake = impact.offset(), local = { x: (mouse.x - w * .57 - shake.x) / zoom, y: (mouse.y - h * .5 - shake.y) / zoom };
    const flat = unproject(local, tilted);
    flat.x += cam.x;
    flat.y += cam.y;
    const ground = pickSurface(flat, (x, y) => world.groundHeight(x, y), tilted);
    return { ...ground, z: (ground.z ?? 0) + .7 };
}
function drawTargeting() {
    const target = assistedTarget();
    if (!target)
        return;
    const p = actorScreen(target, target.z + 1), locked = lockedId === target.id;
    ctx.save();
    ctx.strokeStyle = locked ? '#f1d39c' : '#a2ecd9';
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = .9;
    const r = locked ? 21 : 18;
    for (const [sx, sy] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) {
        ctx.beginPath();
        ctx.moveTo(p.x + sx * (r - 7), p.y + sy * r);
        ctx.lineTo(p.x + sx * r, p.y + sy * r);
        ctx.lineTo(p.x + sx * r, p.y + sy * (r - 7));
        ctx.stroke();
    }
    if (locked) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 5, -Math.PI * .65, -Math.PI * .35);
        ctx.stroke();
    }
    ctx.restore();
}
function drawTimeFlow() {
    const intensity = (1 - world.timeScale) / .82;
    if (intensity < .01)
        return;
    ctx.save();
    ctx.fillStyle = 'rgba(74,125,155,' + (intensity * .1) + ')';
    ctx.fillRect(0, 0, w, h);
    const vignette = ctx.createRadialGradient(w * .57, h * .5, h * .14, w * .57, h * .5, h * .85);
    vignette.addColorStop(0, '#73e2e900');
    vignette.addColorStop(1, 'rgba(74,187,215,' + (intensity * .24) + ')');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, w, h);
    if (!impact.reduced) {
        const x = w * .57, y = h * .5;
        ctx.strokeStyle = 'rgba(182,238,245,' + (intensity * .13) + ')';
        ctx.lineWidth = 1;
        for (let i = 0; i < 18; i++) {
            const angle = i * Math.PI * 2 / 18 + .1, r = h * (.47 + (i % 3) * .06);
            ctx.beginPath();
            ctx.moveTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
            ctx.lineTo(x + Math.cos(angle) * (r + 45), y + Math.sin(angle) * (r + 45));
            ctx.stroke();
        }
    }
    ctx.restore();
}
function fire(t: Technique) {
    if (!paused) {
        impact.unlock();
        world.cast(world.actors[0], t, screenWorld());
        impact.capture(world);
    }
}
canvas.addEventListener('pointermove', e => mouse = { x: e.clientX, y: e.clientY });
canvas.addEventListener('pointerdown', e => {
    impact.unlock();
    canvas.focus();
    mouse = { x: e.clientX, y: e.clientY };
    if (e.button === 1) {
        e.preventDefault();
        toggleLock();
    }
    if (e.button === 0) {
        held = true;
        fire('bolt');
    }
});
canvas.addEventListener('auxclick', e => {
    if (e.button === 1)
        e.preventDefault();
});
addEventListener('pointerup', () => held = false);
addEventListener('blur', () => { keys.clear(); held = false; paused = true; updatePause(); });
canvas.addEventListener('wheel', e => { e.preventDefault(); cinema = false; targetZoom = Math.max(.8, Math.min(24, targetZoom * Math.exp(-e.deltaY * .0015))); }, { passive: false });
function updatePause() { $('pause').textContent = paused ? 'Resume · P' : 'Pause · P'; notice(paused ? 'Time is still. Press P to resume.' : tilted ? '2.5D flight · V compares top-down' : 'The duel continues.'); }
function revive() {
    lockedId = null;
    world.actors = [world.actor(0, 232, 256), world.actor(1, 280, 256)];
    world.actors[0].realm = Number(($('realm') as HTMLSelectElement).value);
    world.actors[1].realm = Number(($('enemyRealm') as HTMLSelectElement).value);
    for (const a of world.actors) { // Find an open spawn without repairing the landscape.
        if (world.blocked(a.x, a.y)) {
            for (let r = 2; r < 80; r += 2) {
                let found = false;
                for (let t = 0; t < Math.PI * 2; t += .3) {
                    const x = 232 + a.id * 48 + Math.cos(t) * r, y = 256 + Math.sin(t) * r;
                    if (!world.blocked(x, y)) {
                        a.x = x;
                        a.y = y;
                        found = true;
                        break;
                    }
                }
                if (found)
                    break;
            }
        }
    }
    impact.clear();
    visuals.clear();
    previous = world.actors.map(a => ({ x: a.x, y: a.y, z: a.z }));
    dashQueued = false;
    world.waves = [];
    world.bolts = [];
    world.casts = [];
    world.effects = [];
    world.aiClock = 1;
    world.timeScale = 1;
    notice('Cultivators revived. Scars remain.');
}
addEventListener('keydown', e => {
    if ((e.target as HTMLElement).matches('select,input'))
        return;
    if (['Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code))
        e.preventDefault();
    impact.unlock();
    keys.add(e.code);
    if (e.repeat)
        return;
    if (e.code === 'KeyP' || e.code === 'Space') {
        paused = !paused;
        updatePause();
    }
    if (e.code === 'KeyT')
        toggleLock();
    if (e.code === 'Escape') {
        lockedId = null;
        notice('Soft lock released');
    }
    if (e.code === 'KeyV')
        toggleView();
    if (e.code === 'KeyC') {
        cinema = !cinema;
        notice(cinema ? 'Cinematic frame · both cultivators in view' : 'Tactical frame · following you');
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight')
        dash();
    if (e.code === 'KeyR')
        revive();
    if (e.code === 'Digit1')
        fire('bolt');
    if (e.code === 'Digit2' || e.code === 'KeyQ')
        fire('slash');
    if (e.code === 'Digit3' || e.code === 'KeyE')
        fire('nova');
});
addEventListener('keyup', e => keys.delete(e.code));
$('lock').onclick = toggleLock;
$('view').onclick = toggleView;
$('dash').onclick = dash;
$('pause').onclick = () => { impact.unlock(); paused = !paused; updatePause(); };
$('duel').onclick = revive;
$('reset').onclick = () => { world.cells = new World().cells; world.destroyed = 0; world.revision++; world.cellVersions.fill(world.revision); heightTerrain.invalidate(); impact.clear(); notice('The landscape has been restored.'); save(); };
$('realm').onchange = () => world.actors[0].realm = Number(($('realm') as HTMLSelectElement).value);
$('enemyRealm').onchange = () => world.actors[1].realm = Number(($('enemyRealm') as HTMLSelectElement).value);
$('sound').onchange = () => {
    impact.sound = ($('sound') as HTMLInputElement).checked;
    if (impact.sound)
        impact.unlock();
};
$('motion').onchange = () => impact.reduced = !($('motion') as HTMLInputElement).checked;
($('motion') as HTMLInputElement).checked = !impact.reduced;
$('ai').onchange = () => world.ai = ($('ai') as HTMLInputElement).checked;
document.querySelectorAll<HTMLButtonElement>('[data-tech]').forEach(b => b.onclick = () => fire(b.dataset.tech as Technique));
function save() {
    try {
        localStorage.setItem('severed-terrain-v1', world.saveTerrain());
        lastSave = world.revision;
    }
    catch {
        notice('Storage is full or blocked; terrain persists for this session only.');
    }
}
addEventListener('pagehide', save);
const terrain = document.createElement('canvas');
terrain.width = SIZE * 3;
terrain.height = SIZE * 3;
const tc = terrain.getContext('2d')!;
tc.scale(3, 3);
let terrainRevision = -1;
let lastStats = "";
let nextHud = 0;
function drawTerrain() {
    if (terrainRevision === world.revision)
        return;
    let minX = GRID, minY = GRID, maxX = -1, maxY = -1;
    for (let i = 0; i < world.cellVersions.length; i++)
        if (world.cellVersions[i] > terrainRevision) {
            const x = i % GRID, y = Math.floor(i / GRID);
            minX = Math.min(minX, x);
            maxX = Math.max(maxX, x);
            minY = Math.min(minY, y);
            maxY = Math.max(maxY, y);
        }
    // Unknown external edits conservatively invalidate the full terrain cache.
    if (maxX < 0) {
        minX = 0;
        minY = 0;
        maxX = GRID - 1;
        maxY = GRID - 1;
    }
    const left = Math.max(0, (minX - 7) * CELL), top = Math.max(0, (minY - 7) * CELL), right = Math.min(SIZE, (maxX + 8) * CELL), bottom = Math.min(SIZE, (maxY + 8) * CELL);
    const fromX = Math.max(0, Math.floor(left / CELL) - 3), fromY = Math.max(0, Math.floor(top / CELL) - 3), toX = Math.min(GRID - 1, Math.ceil(right / CELL) + 3), toY = Math.min(GRID - 1, Math.ceil(bottom / CELL) + 3);
    terrainRevision = world.revision;
    tc.save();
    tc.beginPath();
    tc.rect(left, top, right - left, bottom - top);
    tc.clip();
    const base = tc.createLinearGradient(100, 100, 400, 450);
    base.addColorStop(0, '#293c30');
    base.addColorStop(1, '#1b3028');
    tc.fillStyle = base;
    tc.fillRect(0, 0, SIZE, SIZE);
    // An old processional path and courtyards give the eye familiar metre-scale references.
    tc.strokeStyle = '#6c705335';
    tc.lineWidth = 6;
    tc.beginPath();
    tc.moveTo(130, 209);
    tc.bezierCurveTo(220, 225, 300, 215, 390, 292);
    tc.stroke();
    for (const [x, y] of [[208, 216], [272, 208], [312, 272], [204, 292]]) {
        tc.fillStyle = '#8b897336';
        tc.fillRect(x - 2, y - 2, 24, 16);
        tc.strokeStyle = '#c6b89135';
        tc.lineWidth = .25;
        tc.strokeRect(x - 2, y - 2, 24, 16);
    }
    for (let y = fromY; y <= toY; y++)
        for (let x = fromX; x <= toX; x++) {
            const c = world.cells[y * GRID + x], px = x * CELL, py = y * CELL, n = (x * 13 + y * 7) % 9;
            if (c.depth > .05) {
                const shade = Math.max(8, 27 - c.depth * 1.7);
                tc.fillStyle = 'hsl(32,18%,' + shade + '%)';
                tc.beginPath();
                tc.roundRect(px - .4, py - .4, 4.8, 4.8, 1);
                tc.fill();
                if (c.depth > .5) {
                    tc.strokeStyle = '#080e0b55';
                    tc.lineWidth = .12;
                    tc.beginPath();
                    tc.moveTo(px, py + 3);
                    tc.lineTo(px + 2, py + 1);
                    tc.lineTo(px + 3.7, py + 2);
                    tc.stroke();
                }
                continue;
            }
            tc.fillStyle = n % 2 ? '#a1b37a12' : '#081b1722';
            for (let i = 0; i < 4; i++) {
                tc.beginPath();
                tc.ellipse(px + (i * 1.73 + n * .27) % 4, py + (i * .93 + n * .41) % 4, .2, .07, i, 0, 7);
                tc.fill();
            }
        }
    for (let y = 0; y < GRID; y++)
        for (let x = 0; x < GRID; x++) {
            if (tilted)
                continue;
            const c = world.cells[y * GRID + x], px = x * CELL + 2, py = y * CELL + 2, n = (x * 13 + y * 7) % 9;
            if (c.kind === 1) { // Long cast shadows and layered crowns distinguish trees from stones.
                tc.fillStyle = '#07130f66';
                tc.beginPath();
                tc.ellipse(px + 2.7, py + 3.3, 1.8, 4.4, -.6, 0, 7);
                tc.fill();
                tc.fillStyle = '#413f2b';
                tc.fillRect(px - .16, py - .1, .32, 1.7);
                for (let i = 0; i < 5; i++) {
                    const angle = i * 2.4;
                    tc.fillStyle = c.hp < c.max ? '#6a6844' : i % 2 ? '#3e5b3d' : '#4b6844';
                    tc.beginPath();
                    tc.arc(px + Math.cos(angle) * .85, py + Math.sin(angle) * .75 - 1, 1.1 + n * .05, 0, 7);
                    tc.fill();
                }
                tc.fillStyle = '#78905c77';
                tc.beginPath();
                tc.arc(px - .3, py - 1.8, .65, 0, 7);
                tc.fill();
            }
            else if (c.kind === 2) {
                tc.fillStyle = '#09140f77';
                tc.beginPath();
                tc.ellipse(px + 1.8, py + 1.9, 1.8, 2.5, -.6, 0, 7);
                tc.fill();
                tc.fillStyle = c.hp < c.max ? '#6b6655' : '#798278';
                tc.beginPath();
                tc.moveTo(px - 1.5, py - 1);
                tc.lineTo(px + .5, py - 1.8);
                tc.lineTo(px + 1.7, py + .5);
                tc.lineTo(px - 1, py + 1.3);
                tc.closePath();
                tc.fill();
                tc.strokeStyle = '#c2c2a666';
                tc.lineWidth = .2;
                tc.beginPath();
                tc.moveTo(px - 1.4, py - 1);
                tc.lineTo(px + .5, py - 1.8);
                tc.lineTo(px + 1.4, py - .3);
                tc.stroke();
                if (c.hp < c.max) {
                    tc.strokeStyle = '#252c23';
                    tc.lineWidth = .2;
                    tc.beginPath();
                    tc.moveTo(px + .5, py - 1.8);
                    tc.lineTo(px - .5, py);
                    tc.lineTo(px + .7, py + .7);
                    tc.stroke();
                }
            }
        }
    // Roofs disappear when their supporting destructible stone walls are broken.
    for (const [x, y] of [[208, 216], [272, 208], [312, 272], [204, 292]]) {
        if (tilted)
            continue;
        let alive = 0;
        for (let dy = 0; dy < 3; dy++)
            for (let dx = 0; dx < 5; dx++)
                if (world.cellAt(x + dx * 4, y + dy * 4)?.hp > 0)
                    alive++;
        if (alive > 9) {
            tc.fillStyle = '#111c18aa';
            tc.fillRect(x + 2, y + 3, 20, 12);
            tc.fillStyle = '#64604a';
            tc.fillRect(x - .5, y - .5, 21, 6.5);
            tc.fillStyle = '#3d4336';
            tc.fillRect(x - .5, y + 6, 21, 6.5);
            tc.strokeStyle = '#bbb08677';
            tc.lineWidth = .25;
            for (let line = 0; line < 10; line++) {
                tc.beginPath();
                tc.moveTo(x + line * 2, y);
                tc.lineTo(x + line * 2, y + 12);
                tc.stroke();
            }
            tc.strokeStyle = '#c7bda0';
            tc.lineWidth = .3;
            tc.beginPath();
            tc.moveTo(x - 1, y + 6);
            tc.lineTo(x + 21, y + 6);
            tc.stroke();
        }
    }
    tc.restore();
}
function ring(p: Vec, r: number, color: string, width = .15) { ctx.strokeStyle = color; ctx.lineWidth = width; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.stroke(); }
function render() {
    if (!tilted)
        drawTerrain();
    ctx.fillStyle = '#0d1918';
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    const shake = impact.offset();
    ctx.translate(w * .57 + shake.x, h * .5 + shake.y);
    ctx.scale(zoom, zoom * (tilted ? TILT : 1));
    if (tilted)
        ctx.rotate(YAW);
    ctx.translate(-cam.x, -cam.y);
    ctx.imageSmoothingEnabled = true;
    if (tilted)
        heightTerrain.draw(ctx, world);
    else
        ctx.drawImage(terrain, 0, 0, SIZE, SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.strokeStyle = '#afc0a70b';
    ctx.lineWidth = .12;
    for (let i = 0; !tilted && i <= SIZE; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, SIZE);
        ctx.moveTo(0, i);
        ctx.lineTo(SIZE, i);
        ctx.stroke();
    }
    for (const radius of [66, 67]) {
        ctx.strokeStyle = '#b1bfa51a';
        ctx.lineWidth = .15;
        ctx.beginPath();
        for (let i = 0; i <= 160; i++) {
            const angle = i / 160 * Math.PI * 2, x = 256 + Math.cos(angle) * radius, y = 256 + Math.sin(angle) * radius, h = lift(world.groundHeight(x, y), tilted);
            i ? ctx.lineTo(x + h.x, y + h.y) : ctx.moveTo(x + h.x, y + h.y);
        }
        ctx.stroke();
    }
    for (const c of world.casts) {
        const elevation = lift(c.groundZ, tilted);
        ctx.save();
        ctx.translate(elevation.x, elevation.y);
        ctx.fillStyle = '#e7a04c16';
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.radius, 0, 7);
        ctx.fill();
        ring(c, c.radius, '#eab56a', .2);
        const charge = 1 - c.left / .65;
        ctx.save();
        ctx.globalAlpha = charge * .55;
        ctx.strokeStyle = '#fce8b9';
        ctx.lineWidth = .2 + charge * .6;
        for (let i = 0; i < 12; i++) {
            const a = i * Math.PI / 6 + world.sceneTime * .4;
            ctx.beginPath();
            ctx.moveTo(c.x + Math.cos(a) * c.radius, c.y + Math.sin(a) * c.radius);
            ctx.lineTo(c.x + Math.cos(a + .3) * c.radius * .4, c.y + Math.sin(a + .3) * c.radius * .4);
            ctx.stroke();
        }
        ctx.restore();
        ring(c, c.radius * (1 - c.left / .65), '#ffe5a8', .35);
        ctx.restore();
    }
    const actors = renderedActors();
    const elevation = lift(0, tilted);
    ctx.save();
    ctx.translate(elevation.x, elevation.y);
    visuals.flight(ctx, world, actors, zoom, tilted);
    for (const b of world.bolts)
        if (b.launched) {
            const z = lift(b.z, tilted);
            visuals.bolt(ctx, { ...b, x: b.x + z.x, y: b.y + z.y }, world.sceneTime);
        }
    for (const wave of world.waves) {
        const z = lift(wave.z, tilted);
        visuals.crescent(ctx, { ...wave, x: wave.x + z.x, y: wave.y + z.y });
    }
    ctx.restore();
    if (tilted)
        depthScene.draw(ctx, world, actors, cam, zoom, w, h);
    for (const a of tilted ? [] : actors) {
        if (a.hp <= 0) {
            ctx.strokeStyle = '#a89579';
            ctx.lineWidth = .4;
            ctx.beginPath();
            ctx.moveTo(a.x - 1, a.y - 1);
            ctx.lineTo(a.x + 1, a.y + 1);
            ctx.moveTo(a.x + 1, a.y - 1);
            ctx.lineTo(a.x - 1, a.y + 1);
            ctx.stroke();
            continue;
        }
        const color = a.id ? '#f1bc88' : '#bce6d4';
        ring(a, 1.5 + a.realm * .6, a.id ? '#d8a57755' : '#a2dac355', .12);
        ctx.fillStyle = '#06110dcc';
        ctx.beginPath();
        ctx.ellipse(a.x, a.y + .6, 1.2, .7, 0, 0, 7);
        ctx.fill();
        ctx.save();
        ctx.translate(a.x, a.y);
        ctx.rotate(a.aim);
        ctx.fillStyle = a.id ? '#8d6450' : '#d2dfc8';
        ctx.beginPath();
        ctx.moveTo(1, 0);
        ctx.lineTo(-.9, -.7);
        ctx.lineTo(-.55, 0);
        ctx.lineTo(-.9, .7);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = .13;
        ctx.beginPath();
        ctx.moveTo(.1, .65);
        ctx.lineTo(2, .65);
        ctx.stroke();
        ctx.fillStyle = '#eee6cf';
        ctx.beginPath();
        ctx.arc(0, 0, .33, 0, 7);
        ctx.fill();
        ctx.restore();
    }
    for (const e of world.effects) {
        const t = e.life / e.maxLife;
        ctx.globalAlpha = t;
        if (e.kind === 'text') {
            ctx.fillStyle = '#ffe3aa';
            ctx.font = `${12 / zoom}px Inter`;
            ctx.textAlign = 'center';
            ctx.save();
            const height = lift(e.z ?? 0, tilted);
            ctx.translate(e.x + height.x, e.y + height.y);
            if (tilted) {
                ctx.rotate(-YAW);
                ctx.scale(1, 1 / TILT);
            }
            ctx.fillText(e.text || '', 0, -(1 - t) * 4 - 4);
            ctx.restore();
        }
        else if (e.kind === 'slash' || e.kind === 'dash') {
            ctx.globalAlpha = 0;
        }
        else {
            const h = lift(e.z ?? 0, tilted), p = { x: e.x + h.x, y: e.y + h.y };
            ring(p, e.radius * (1 - t * .6), e.kind === 'nova' ? '#f7d59a' : '#c2e8cc', .5 + 2 * t);
            ring(p, e.radius * (1 - t), '#fef4ce', .2);
        }
        ctx.globalAlpha = 1;
    }
    impact.draw(ctx, world, zoom, tilted ? lift(1, true) : { x: 0, y: 0 });
    visuals.palms(ctx, world, tilted);
    const aim = screenWorld();
    const groundLift = lift(world.groundHeight(aim.x, aim.y), tilted);
    ring({ x: aim.x + groundLift.x, y: aim.y + groundLift.y }, .65, '#dee8c888', .1);
    ctx.restore();
    impact.overlay(ctx, w, h);
    drawTimeFlow();
    drawTargeting();
    const hudTime = performance.now();
    if (hudTime < nextHud)
        return;
    nextHud = hudTime + 80;
    const p = world.actors[0], e = world.actors[1];
    const target = assistedTarget(), locked = target && lockedId === target.id;
    $("lock").textContent = locked ? "T · UNLOCK" : "T · LOCK";
    $("targeting").textContent = target ? `${locked ? "SOFT LOCK" : "CURSOR ASSIST"} · ASHEN DISCIPLE\n${Math.round(Math.hypot(target.x - p.x, target.y - p.y))}m range · altitude aligned` : "CURSOR ASSIST READY · aim near a rival";
    ($('hp') as HTMLMeterElement).value = p.hp;
    ($('qi') as HTMLMeterElement).value = p.qi;
    ($('enemyHp') as HTMLMeterElement).value = e.hp;
    const flow = dashProfile(p.realm);
    $('dash').textContent = p.dashLeft > .01 ? ('FLOW · ' + p.dashLeft.toFixed(1) + 's') : p.dashCool > .01 ? ('SHIFT · ' + p.dashCool.toFixed(1) + 's') : 'SHIFT · DASH';
    $('timeflow').textContent = p.dashLeft > .01 ? ('HEAVENLY STEP · ' + p.dashLeft.toFixed(1) + 's\nWORLD ' + Math.round(world.timeScale * 100) + '% · YOU 100%') : world.timeScale < .98 ? 'TIME RETURNING' : ('SHIFT · ' + flow.duration.toFixed(2) + 's steerable dodge');
    $("altitude").textContent = `${(p.z - world.groundHeight(p.x, p.y)).toFixed(1)}m above ground · ${p.z.toFixed(1)}m altitude`;
    $('vitalText').textContent = `${Math.ceil(p.hp)} VITALITY   /   ${Math.floor(p.qi)} QI   /   ${Math.ceil(p.ward)} WARD`;
    $('playerLabel').textContent = REALMS[p.realm];
    $('rivalLabel').textContent = REALMS[e.realm];
    const stats = `POWER RATIO <span style="float:right;color:#d8c69d">${(power(p.realm) / power(e.realm)).toFixed(2)}×</span><br>COVER DESTROYED <span style="float:right">${world.destroyed}</span><br>TERRAIN <span style="float:right">${lastSave === world.revision ? 'SAVED' : 'CHANGED'}</span>`;
    if (stats !== lastStats) {
        $('stats').innerHTML = stats;
        lastStats = stats;
    }
    for (let i = 0; i < 3; i++)
        $('cd' + i).textContent = p.cool[i] > .01 ? `${p.cool[i].toFixed(1)}s cooldown` : [`9 qi · irregular burst · 0.95s`, `16 qi · ${Math.round(36 * Math.pow(1.65, p.realm))}m crescent`, `38 qi · ${20 * Math.pow(2, p.realm)}m diameter`][i];
    const metres = Math.round(80 / zoom);
    $('scale').textContent = `${metres} m`;
    $('zoomLabel').textContent = cinema ? 'CINEMATIC FRAME' : `${zoom.toFixed(1)} PX / METRE`;
    if (!p.hp)
        notice('You have fallen. Press R to revive; the scars remain.');
    else if (!e.hp)
        notice('Rival defeated. Press R for another duel on this scarred ground.');
}
updatePause();
function frame(ms: number) {
    const elapsed = Math.min((ms - last) / 1000, .1);
    last = ms;
    if (!paused) {
        impact.update(elapsed, false, world.timeScale);
        acc += impact.hitStop > 0 ? 0 : elapsed;
        while (acc >= DT) {
            previous = world.actors.map(a => ({ x: a.x, y: a.y, z: a.z }));
            world.step({ autoAltitude: ($('autoAltitude') as HTMLInputElement).checked, climb: Number(keys.has("KeyF")) - Number(keys.has("KeyG")), dash: dashQueued, move: movement(), aim: screenWorld(), fire: held ? 'bolt' : undefined });
            dashQueued = false;
            visuals.sample(world);
            impact.capture(world);
            acc -= DT;
            if (impact.hitStop > 0) {
                acc = 0;
                break;
            }
        }
    }
    else
        acc = 0;
    const [p, e] = renderedActors();
    let tx = p.x, ty = p.y, framedZoom = targetZoom;
    if (cinema) {
        tx = (p.x + e.x) / 2;
        ty = (p.y + e.y) / 2;
        framedZoom = Math.max(.8, Math.min(10, Math.min((w - 400) / (Math.abs(p.x - e.x) + 70), (h - 230) / (Math.abs(p.y - e.y) + 50))));
    }
    if (impact.focus && !impact.reduced) {
        const f = impact.focus, blend = Math.min(1, f.left / .65);
        tx = p.x + (f.x - p.x) * .7 * blend;
        ty = p.y + (f.y - p.y) * .7 * blend;
        const fit = Math.max(.8, Math.min((w - 320) / (f.radius * 2.3), (h - 210) / (f.radius * 2.3)));
        framedZoom = framedZoom + (Math.min(framedZoom, fit) - framedZoom) * blend;
    }
    const followHeight = lift(p.z * .6, tilted);
    tx += followHeight.x;
    ty += followHeight.y;
    cam.x += (tx - cam.x) * (1 - Math.exp(-elapsed * 10));
    cam.y += (ty - cam.y) * Math.min(1, elapsed * 12);
    zoom += (framedZoom - zoom) * Math.min(1, elapsed * (impact.focus ? 9 : 2.5));
    if (ms - saveAt > 1500 && lastSave !== world.revision && world.waves.length === 0 && world.bolts.length === 0 && impact.particles.length === 0) {
        save();
        saveAt = ms;
    }
    render();
    requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
