import { actorPalette } from './study-scene.ts';
import { GRID, CELL, World } from './sim.ts';
import type { Actor, Vec } from './sim.ts';
import { project, lift, TILT, YAW } from './projection.ts';
type Prop = Vec & {
    kind: number;
    variant: number;
};
type Band = { key: number; props: Prop[]; canvas?: HTMLCanvasElement; x: number; y: number; width: number; height: number };
export class DepthScene {
    invalidate() { this.revision = -1; this.bands = []; }
    private revision = -1;
    private props: Prop[] = [];
    private trees: HTMLCanvasElement[] = [];
    private rocks: HTMLCanvasElement[] = [];
    private bands: Band[] = [];
    private cached: boolean;
    constructor(cached = false) {
        this.cached = cached;
        for (let i = 0; i < 3; i++) {
            this.trees.push(this.sprite(true, i));
            this.rocks.push(this.sprite(false, i));
        }
    }
    private sprite(tree: boolean, variant: number) {
        const c = document.createElement('canvas');
        c.width = 120;
        c.height = 200;
        const g = c.getContext('2d')!;
        g.translate(60, 180);
        g.scale(20, 20);
        if (tree) {
            g.strokeStyle = '#443c2a';
            g.lineWidth = .34;
            g.beginPath();
            g.moveTo(0, 0);
            g.lineTo(-.1, -5);
            g.moveTo(0, -3);
            g.lineTo(-1.4, -5.1);
            g.moveTo(0, -3.5);
            g.lineTo(1.1, -5.5);
            g.stroke();
            const grad = g.createLinearGradient(-2, -7, 1, 0);
            grad.addColorStop(0, ['#76946b', '#6c8b63', '#8b9569'][variant]);
            grad.addColorStop(.45, '#395a3e');
            grad.addColorStop(1, '#193b2e');
            for (let i = 0; i < 8; i++) {
                const a = i * 2.4;
                g.fillStyle = grad;
                g.beginPath();
                g.ellipse(Math.cos(a) * 1.05, -5.5 + Math.sin(a) * 1.1, 1.3 + variant * .12, 1.25, a * .15, 0, 7);
                g.fill();
            }
            g.fillStyle = '#a6b27644';
            for (let i = 0; i < 15; i++) {
                g.beginPath();
                g.ellipse(Math.sin(i * 3.17) * 1.8, -6.4 + Math.cos(i * 2.4) * 1.3, .25, .13, -.4, 0, 7);
                g.fill();
            }
        }
        else {
            g.fillStyle = '#38483f';
            g.beginPath();
            g.moveTo(-1.7, 0);
            g.lineTo(-1.8, -1.4);
            g.lineTo(-.4, -2.5);
            g.lineTo(1.2, -2.1);
            g.lineTo(1.8, -.3);
            g.lineTo(.5, .3);
            g.closePath();
            g.fill();
            g.fillStyle = ['#9a9f8c', '#879688', '#a3a18c'][variant];
            g.beginPath();
            g.moveTo(-1.8, -1.4);
            g.lineTo(-.4, -2.5);
            g.lineTo(1.2, -2.1);
            g.lineTo(.5, -.85);
            g.closePath();
            g.fill();
            g.strokeStyle = '#c9c7a477';
            g.lineWidth = .08;
            g.beginPath();
            g.moveTo(-1.8, -1.4);
            g.lineTo(.5, -.85);
            g.lineTo(1.8, -.3);
            g.stroke();
        }
        return c;
    }
    private billboard(ctx: CanvasRenderingContext2D, p: Vec) { const h = lift(p.z ?? 0, true); ctx.translate(p.x + h.x, p.y + h.y); ctx.rotate(-YAW); ctx.scale(1, 1 / TILT); }
    draw(ctx: CanvasRenderingContext2D, world: Pick<World, 'cells' | 'revision' | 'cellAt' | 'groundHeight' | 'time'>, actors: Actor[], cam: Vec, zoom: number, width: number, height: number) {
        const changed = this.revision !== world.revision;
        if (this.revision !== world.revision) {
            this.revision = world.revision;
            this.props = [];
            for (let i = 0; i < world.cells.length; i++) {
                const c = world.cells[i];
                if (c.hp > 0)
                    this.props.push({ x: (i % GRID) * CELL + 2, y: Math.floor(i / GRID) * CELL + 2, kind: c.kind, variant: i % 3 });
            }
        }
        const buildings: Prop[] = [];
        for (const [x, y] of [[208, 216], [272, 208], [312, 272], [204, 292]]) {
            let alive = 0;
            for (let dy = 0; dy < 3; dy++)
                for (let dx = 0; dx < 5; dx++)
                    if (world.cellAt(x + dx * 4, y + dy * 4)?.hp > 0)
                        alive++;
            if (alive > 9)
                buildings.push({ x: x + 10, y: y + 6, kind: 3, variant: 0 });
        }
        if (this.cached) {
            if (changed || !this.bands.length) {
                const groups = new Map<number, Prop[]>();
                for (const p of [...this.props.filter(p => !buildings.some(b => Math.abs(p.x - b.x) <= 10 && Math.abs(p.y - b.y) <= 6)), ...buildings]) {
                    const key = Math.floor(project(p, true).y / 8);
                    const props = groups.get(key) ?? []; props.push({ ...p, z: world.groundHeight(p.x, p.y) }); groups.set(key, props);
                }
                this.bands = [...groups].sort(([a], [b]) => a - b).map(([key, props]) => {
                    props.sort((a, b) => project({ x: a.x, y: a.y }, true).y - project({ x: b.x, y: b.y }, true).y);
                    const old = this.bands.find(b => b.key === key);
                    if (old && old.props.length === props.length && props.every((p, i) => { const q = old.props[i]; return p.x === q.x && p.y === q.y && p.z === q.z && p.kind === q.kind && p.variant === q.variant; })) return old;
                    const points = props.map(p => project(p, true));
                    const x = Math.floor(Math.min(...points.map(p => p.x)) - 32), y = Math.floor(Math.min(...points.map(p => p.y)) - 32);
                    return { key, props, x, y, width: Math.ceil(Math.max(...points.map(p => p.x)) + 32 - x), height: Math.ceil(Math.max(...points.map(p => p.y)) + 16 - y) };
                });
            }
            this.drawBands(ctx, actors, world.time, world.groundHeight);
            return;
        }
        const origin = project(cam, true), visible = this.props.filter(p => { const v = project(p, true); return Math.abs((v.x - origin.x) * zoom) < width * .65 + 80 && Math.abs((v.y - origin.y) * zoom) < height * .6 + 90; });
        const items: (Prop | Actor)[] = [...visible.filter(p => !buildings.some(b => Math.abs(p.x - b.x) <= 10 && Math.abs(p.y - b.y) <= 6)), ...buildings, ...actors];
        const depths = new Map(items.map(item => [item, project(item, true).y]));
        items.sort((a, b) => depths.get(a)! - depths.get(b)!);
        for (const item of items) {
            if ('kind' in item) {
                const p = item;
                if (p.kind === 3) {
                    this.building(ctx, { ...p, z: world.groundHeight(p.x, p.y) });
                    continue;
                }
                ctx.save();
                this.billboard(ctx, { ...p, z: world.groundHeight(p.x, p.y) });
                ctx.fillStyle = '#06150d66';
                ctx.beginPath();
                ctx.ellipse(1.8, .6, p.kind === 1 ? 2.6 : 1.8, .6, -.2, 0, 7);
                ctx.fill();
                const near = actors.some(a => a.hp > 0 && Math.abs(project(a, true).x - project(p, true).x) < 2.6 && project(a, true).y < project(p, true).y && project(a, true).y > project(p, true).y - 8);
                ctx.globalAlpha = near ? .5 : 1;
                ctx.drawImage(p.kind === 1 ? this.trees[p.variant] : this.rocks[p.variant], -3, -9, 6, 10);
                ctx.restore();
            }
            else
                this.actor(ctx, item, world.time, world.groundHeight(item.x, item.y));
        }
    }
    private drawProp(ctx: CanvasRenderingContext2D, p: Prop, near = false) {
        if (p.kind === 3) { this.building(ctx, p); return; }
        ctx.save(); this.billboard(ctx, p);
        ctx.fillStyle = '#06150d66'; ctx.beginPath(); ctx.ellipse(1.8, .6, p.kind === 1 ? 2.6 : 1.8, .6, -.2, 0, 7); ctx.fill();
        ctx.globalAlpha = near ? .5 : 1;
        ctx.drawImage(p.kind === 1 ? this.trees[p.variant] : this.rocks[p.variant], -3, -9, 6, 10); ctx.restore();
    }
    private drawBands(ctx: CanvasRenderingContext2D, actors: Actor[], time: number, ground: (x: number, y: number) => number) {
        const projectedActors = actors.map(a => ({ actor: a, p: project(a, true) })).sort((a, b) => a.p.y - b.p.y);
        let index = 0;
        const transform = ctx.getTransform(), co = Math.cos(YAW), si = Math.sin(YAW);
        // Map projected world metres directly to the existing canvas transform.
        const matrix = { a: transform.a * co - transform.c * si, b: transform.b * co - transform.d * si,
            c: (transform.a * si + transform.c * co) / TILT, d: (transform.b * si + transform.d * co) / TILT };
        for (const band of this.bands) {
            while (index < projectedActors.length && projectedActors[index].p.y < band.key * 8) {
                const a = projectedActors[index++].actor; this.actor(ctx, a, time, ground(a.x, a.y));
            }
            const corners = [[band.x, band.y], [band.x + band.width, band.y], [band.x, band.y + band.height], [band.x + band.width, band.y + band.height]].map(([x, y]) => ({ x: matrix.a * x + matrix.c * y + transform.e, y: matrix.b * x + matrix.d * y + transform.f }));
            if (Math.max(...corners.map(p => p.x)) < 0 || Math.min(...corners.map(p => p.x)) > ctx.canvas.width || Math.max(...corners.map(p => p.y)) < 0 || Math.min(...corners.map(p => p.y)) > ctx.canvas.height) { band.canvas = undefined; continue; }
            // Render the few bands around actors directly for exact depth ordering
            // and the original transparent foreground trees. All others are static.
            if (projectedActors.some(a => a.p.y >= band.key * 8 - 8 && a.p.y < (band.key + 1) * 8)) {
                for (const p of band.props) {
                    const flat = project({ x: p.x, y: p.y }, true);
                    while (index < projectedActors.length && projectedActors[index].p.y <= flat.y) { const a = projectedActors[index++].actor; this.actor(ctx, a, time, ground(a.x, a.y)); }
                    const raised = project(p, true), x = matrix.a * raised.x + matrix.c * raised.y + transform.e, y = matrix.b * raised.x + matrix.d * raised.y + transform.f;
                    const padding = 32 * Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
                    if (x < -padding || x > ctx.canvas.width + padding || y < -padding || y > ctx.canvas.height + padding) continue;
                    this.drawProp(ctx, p, projectedActors.some(a => a.actor.hp > 0 && Math.abs(a.p.x - flat.x) < 2.6 && a.p.y < flat.y && a.p.y > flat.y - 8));
                }
                continue;
            }
            if (!band.canvas) {
                const canvas = document.createElement('canvas'); canvas.width = band.width * 6; canvas.height = band.height * 6;
                const g = canvas.getContext('2d')!; g.scale(6, 6); g.translate(-band.x, -band.y); g.scale(1, TILT); g.rotate(YAW);
                for (const p of band.props) this.drawProp(g, p);
                band.canvas = canvas;
            }
            ctx.save(); ctx.transform(co, -si, si / TILT, co / TILT, 0, 0);
            ctx.drawImage(band.canvas, band.x, band.y, band.width, band.height); ctx.restore();
        }
        while (index < projectedActors.length) { const a = projectedActors[index++].actor; this.actor(ctx, a, time, ground(a.x, a.y)); }
    }
    private building(ctx: CanvasRenderingContext2D, b: Prop) {
        const point = (x: number, y: number, z: number) => { const h = lift(z + (b.z ?? 0), true); return { x: b.x + x + h.x, y: b.y + y + h.y }; };
        const face = (vertices: number[][], color: string) => { ctx.fillStyle = color; ctx.strokeStyle = '#b8af8655'; ctx.lineWidth = .1; ctx.beginPath(); vertices.forEach(([x, y, z], i) => { const p = point(x, y, z); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y); }); ctx.closePath(); ctx.fill(); ctx.stroke(); };
        face([[-10, 6, 0], [10, 6, 0], [10, 6, 4], [-10, 6, 4]], '#6e7059');
        face([[10, -6, 0], [10, 6, 0], [10, 6, 4], [10, -6, 4]], '#3b5146');
        face([[-11, -7, 4.3], [11, -7, 4.3], [11, 0, 7.5], [-11, 0, 7.5]], '#929078');
        face([[-11, 0, 7.5], [11, 0, 7.5], [11, 7, 4.3], [-11, 7, 4.3]], '#4a6656');
        face([[-1.4, 6.1, 0], [1.4, 6.1, 0], [1.4, 6.1, 3], [-1.4, 6.1, 3]], '#142c24');
        for (const x of [-6, 6])
            face([[x - 1, 6.1, 1.7], [x + 1, 6.1, 1.7], [x + 1, 6.1, 2.8], [x - 1, 6.1, 2.8]], '#dac48a');
        ctx.strokeStyle = '#c0b78c66';
        ctx.lineWidth = .12;
        for (let x = -10; x <= 10; x += 2) {
            const a = point(x, 0, 7.55), c = point(x, 7, 4.35);
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(c.x, c.y);
            ctx.stroke();
        }
    }
    private actor(ctx: CanvasRenderingContext2D, a: Actor, time: number, ground: number) {
        ctx.save();
        this.billboard(ctx, { ...a, z: ground });
        if (a.hp <= 0) {
            ctx.strokeStyle = '#d9ba88';
            ctx.lineWidth = .18;
            ctx.beginPath();
            ctx.moveTo(-.6, -.3);
            ctx.lineTo(.6, .3);
            ctx.moveTo(-.6, .3);
            ctx.lineTo(.6, -.3);
            ctx.stroke();
            ctx.restore();
            return;
        }
        const hover = a.z - ground, palette = actorPalette(a), color = palette.glow;
        ctx.fillStyle = '#020a08aa';
        ctx.beginPath();
        ctx.ellipse(.5, .4, 1.3, .4, 0, 0, 7);
        ctx.fill();
        ctx.strokeStyle = a.id ? '#d3a57944' : '#89d8c844';
        ctx.lineWidth = .07;
        ctx.beginPath();
        ctx.ellipse(0, 0, 1.7 + a.realm * .3, .55 + a.realm * .1, 0, 0, 7);
        ctx.stroke();
        ctx.strokeStyle = '#b5e8d42b';
        ctx.setLineDash([.15, .2]);
        ctx.beginPath();
        ctx.moveTo(0, -.25);
        ctx.lineTo(0, -hover);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.translate(0, -hover);
        const heading = project({ x: Math.cos(a.aim), y: Math.sin(a.aim) }, true), lean = Math.max(-.23, Math.min(.23, project({ x: a.vx, y: a.vy }, true).x * .008));
        ctx.rotate(lean);
        ctx.shadowColor = color;
        ctx.shadowBlur = 9;
        ctx.strokeStyle = color;
        ctx.lineWidth = .07;
        ctx.beginPath();
        ctx.ellipse(0, -.7, 1.2, 1.7, 0, 0, 7);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.fillStyle = palette.robe;
        ctx.beginPath();
        ctx.moveTo(-.3, -1.25);
        ctx.quadraticCurveTo(-.6, -.7, -.75, .3);
        ctx.quadraticCurveTo(0, .05, .65, .3);
        ctx.lineTo(.28, -1.25);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = palette.trim;
        ctx.beginPath();
        ctx.moveTo(-.05, -1.2);
        ctx.lineTo(-.3, .1);
        ctx.lineTo(.23, -.02);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = '#efdfbd';
        ctx.beginPath();
        ctx.arc(0, -1.6, .26, 0, 7);
        ctx.fill();
        ctx.fillStyle = '#1d2824';
        ctx.beginPath();
        ctx.arc(-.04, -1.76, .22, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#f4f4d1';
        ctx.lineWidth = .08;
        ctx.beginPath();
        ctx.moveTo(heading.x * .4, -.8 + heading.y * .3);
        ctx.lineTo(heading.x * 2.6, -.8 + heading.y * 2);
        ctx.stroke();
        ctx.restore();
    }
}
