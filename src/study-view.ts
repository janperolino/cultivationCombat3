import { HeightTerrain } from './height-terrain.ts';
import { DepthScene } from './depth-scene.ts';
import { TechniqueVisuals } from './technique-visuals.ts';
import { ImpactPresentation } from './impact.ts';
import { StudyCamera } from './study-camera.ts';
import { StudyState } from './study-state.ts';
import { actorPalette } from './study-scene.ts';
import { TILT, YAW, lift } from './projection.ts';
import { cursorTarget, targetInRange, LOCK_RANGE } from './targeting.ts';
import type { Aim } from './targeting.ts';
import type { World, Actor, Cell, Vec } from './sim.ts';
import type { DisplayFrame } from './replication.ts';

export class StudyView {
    readonly timings = { terrain: 0, scenery: 0, total: 0 };
    readonly camera = new StudyCamera();
    readonly state: StudyState;
    readonly impact = new ImpactPresentation();
    private terrain = new HeightTerrain(true);
    private depth = new DepthScene(true);
    private visuals = new TechniqueVisuals();
    private snap = true;
    private epoch?: number;
    private locked?: number;
    constructor(terrain: World) { this.state = new StudyState(terrain); this.impact.sound = false; }
    clear() { this.state.clear(); this.terrain.invalidate(); this.depth.invalidate(); this.visuals.clear(); this.impact.clear(); this.snap = true; this.locked = undefined; }
    target(pointer: Vec, actors: Actor[], local: Actor) {
        const locked = actors.find(a => a.id === this.locked);
        if (locked && targetInRange(local, locked, LOCK_RANGE)) return locked;
        this.locked = undefined;
        return cursorTarget(local, pointer, actors.map(actor => ({ actor, screen: this.camera.screen(actor, actor.z + 1), ground: this.camera.screen(actor, this.state.scene.groundHeight(actor.x, actor.y)) })));
    }
    toggleLock(pointer: Vec, actors: Actor[], local: Actor) { if (this.locked !== undefined) this.locked = undefined; else this.locked = this.target(pointer, actors, local)?.id; }
    aim(pointer: Vec, actors: Actor[], local: Actor): Aim {
        const target = this.target(pointer, actors, local);
        if (target) return { x: target.x, y: target.y, z: target.z + .7, targetId: target.id, locked: this.locked === target.id };
        const p = this.camera.ground(pointer, this.state.scene.groundHeight);
        return { x: p.x, y: p.y, z: (p.z ?? 0) + .7 };
    }
    draw(ctx: CanvasRenderingContext2D, frame: DisplayFrame, actors: Actor[], localId: number, cells: Cell[], revision: number, width: number, height: number, dt: number, pointer: Vec) {
        const started = performance.now();
        if (this.epoch !== frame.encounter?.epoch) { this.clear(); this.epoch = frame.encounter?.epoch; }
        const fresh = this.state.receive(frame, actors, cells, revision), scene = this.state.scene;
        if (this.state.terrainReset) { this.terrain.invalidate(); this.depth.invalidate(); }
        if (fresh) {
            this.impact.prime({ effects: scene.effects.filter(e => !fresh.includes(e)), casts: scene.casts });
            this.impact.capture(scene); this.visuals.sample(scene);
        }
        this.impact.update(Math.min(.05, dt), false, 1);
        const local = actors.find(a => a.id === localId) ?? actors[0];
        const nearest = actors.filter(a => a.hp > 0 && targetInRange(local, a, LOCK_RANGE)).sort((a, b) => Math.hypot(a.x - local.x, a.y - local.y) - Math.hypot(b.x - local.x, b.y - local.y))[0];
        this.camera.width = width; this.camera.height = height; this.camera.shake = this.impact.offset();
        this.camera.follow(local, dt, this.snap, nearest); this.snap = false;
        const camera = this.camera, o = camera.origin;
        ctx.fillStyle = '#0d1918'; ctx.fillRect(0, 0, width, height);
        ctx.save(); ctx.translate(o.x, o.y); ctx.scale(camera.zoom, camera.zoom * TILT); ctx.rotate(YAW); ctx.translate(-camera.x, -camera.y);
        const terrainStart = performance.now();
        this.terrain.draw(ctx, scene);
        this.timings.terrain = performance.now() - terrainStart;
        this.visuals.flight(ctx, scene, actors, camera.zoom, true);
        for (const c of scene.casts) {
            const p = lift(scene.groundHeight(c.x, c.y), true); ctx.strokeStyle = '#eab56a'; ctx.lineWidth = .2;
            ctx.beginPath(); ctx.arc(c.x + p.x, c.y + p.y, c.radius, 0, 7); ctx.stroke();
        }
        for (const b of scene.bolts) if (b.launched) {
            const p = lift(b.z, true), owner = actors.find(a => a.id === b.owner)!;
            this.visuals.bolt(ctx, { ...b, x: b.x + p.x, y: b.y + p.y }, scene.time, actorPalette(owner ?? { id: b.owner }).glow);
        }
        for (const wave of scene.waves) {
            const p = lift(wave.z, true), owner = actors.find(a => a.id === wave.owner)!;
            this.visuals.crescent(ctx, { ...wave, x: wave.x + p.x, y: wave.y + p.y }, actorPalette(owner ?? { id: wave.owner }).glow);
        }
        const sceneryStart = performance.now();
        this.depth.draw(ctx, scene, actors, camera, camera.zoom, width, height);
        this.timings.scenery = performance.now() - sceneryStart;
        this.visuals.palms(ctx, scene, true); this.impact.draw(ctx, scene, camera.zoom, lift(1, true));
        ctx.restore(); this.impact.overlay(ctx, width, height);
        this.warnings(ctx, frame);
        for (const a of actors) {
            const p = camera.screen(a, a.z + 2.5), ground = camera.screen(a, scene.groundHeight(a.x, a.y));
            if (p.x < 0 || p.x > width || p.y < 90 || p.y > height - 100) continue;
            ctx.textAlign = 'center'; ctx.font = '11px Segoe UI'; ctx.fillStyle = actorPalette(a).glow;
            const name = a.id < 2 ? a.id === localId ? 'YOU' : `ALLY P${a.id + 1}` : a.enemyId === 'sentinel' ? 'SENTINEL' : `SKIRMISHER ${a.id - 1}`;
            ctx.fillText(`${name}${a.hp <= 0 ? ' · FALLEN' : ''} · ${a.z.toFixed(0)}m`, p.x, p.y - 8);
            ctx.fillStyle = '#091714dd'; ctx.fillRect(p.x - 22, p.y - 2, 44, 3);
            ctx.fillStyle = actorPalette(a).glow; ctx.fillRect(p.x - 22, p.y - 2, 44 * Math.max(0, Math.min(1, a.hp / a.maxHp)), 3);
            if (a.id === localId) { ctx.strokeStyle = '#fff1c8'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.ellipse(ground.x, ground.y, 12, 5, 0, 0, 7); ctx.stroke(); }
        }
        const target = this.target(pointer, actors, local);
        if (target) {
            const p = camera.screen(target, target.z + 1); ctx.strokeStyle = this.locked === target.id ? '#ffde92' : '#b6edd8'; ctx.lineWidth = 1.5;
            ctx.strokeRect(p.x - 16, p.y - 20, 32, 40);
        }
        this.timings.total = performance.now() - started;
    }
    private warnings(ctx: CanvasRenderingContext2D, frame: DisplayFrame) {
        for (const t of frame.telegraphs) {
            const owner = frame.actors.find(a => a.id === t.owner)!, angle = Math.atan2(t.aim.y - owner.y, t.aim.x - owner.x);
            const span = 4 + 3 * owner.realm, range = 36 * Math.pow(1.65, owner.realm);
            const slope = (t.aim.z - owner.z - .7) / Math.max(1, Math.hypot(t.aim.x - owner.x, t.aim.y - owner.y) - span * .2);
            const reach = range / Math.sqrt(1 + slope * slope), co = Math.cos(angle), si = Math.sin(angle);
            ctx.save(); ctx.strokeStyle = '#ffe2a0'; ctx.fillStyle = '#f3b35925'; ctx.lineWidth = 1.5; ctx.setLineDash([8, 5]); ctx.beginPath();
            for (const [i, [d, side]] of [[-span, -span], [reach + span, -span], [reach + span, span], [-span, span]].entries()) {
                const p = this.camera.screen({ x: owner.x + co * d - si * side, y: owner.y + si * d + co * side }, owner.z + .7 + slope * d);
                if (!i) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
            }
            ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
            const p = this.camera.screen(owner, owner.z + 5); ctx.fillStyle = '#ffe2a0'; ctx.font = '12px Segoe UI'; ctx.textAlign = 'center';
            ctx.fillText(`CRESCENT · ${t.remaining.toFixed(1)}s · ${t.aim.z.toFixed(0)}m`, p.x, p.y - 12); ctx.restore();
        }
    }
}
