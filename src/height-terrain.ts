import { World, GRID, CELL } from './sim.ts';
import { lift, project } from './projection.ts';
const CHUNK = 16, MARGIN = 48, SPAN = CHUNK * CELL;
type Patch = {
    canvas: HTMLCanvasElement;
    x: number;
    y: number;
    revision: number;
};
export class HeightTerrain {
    private patches: Patch[] = [];
    private viewportCull: boolean;
    constructor(viewportCull = false) {
        this.viewportCull = viewportCull;
        for (let y = 0; y < GRID; y += CHUNK)
            for (let x = 0; x < GRID; x += CHUNK) {
                const canvas = document.createElement('canvas');
                canvas.width = (SPAN + MARGIN * 2) * 2;
                canvas.height = canvas.width;
                this.patches.push({ canvas, x, y, revision: -1 });
            }
        this.patches.sort((a, b) => project({ x: a.x, y: a.y }, true).y - project({ x: b.x, y: b.y }, true).y);
    }
    invalidate() {
        for (const p of this.patches)
            p.revision = -1;
    }
    draw(ctx: CanvasRenderingContext2D, w: Pick<World, 'cells' | 'cellVersions' | 'revision' | 'groundHeight'>) {
        const t = this.viewportCull ? ctx.getTransform() : undefined;
        for (const patch of this.patches) {
            if (t) {
                const left = patch.x * CELL - MARGIN, top = patch.y * CELL - MARGIN, span = SPAN + MARGIN * 2;
                const points = [[left, top], [left + span, top], [left, top + span], [left + span, top + span]].map(([x, y]) => ({ x: t.a * x + t.c * y + t.e, y: t.b * x + t.d * y + t.f }));
                if (Math.max(...points.map(p => p.x)) < 0 || Math.min(...points.map(p => p.x)) > ctx.canvas.width || Math.max(...points.map(p => p.y)) < 0 || Math.min(...points.map(p => p.y)) > ctx.canvas.height) continue;
            }
            let dirty = patch.revision < 0;
            if (!dirty && patch.revision !== w.revision)
            for (let y = Math.max(0, patch.y - 1); y <= Math.min(GRID - 1, patch.y + CHUNK); y++)
                for (let x = Math.max(0, patch.x - 1); x <= Math.min(GRID - 1, patch.x + CHUNK); x++)
                    if (w.cellVersions[y * GRID + x] > patch.revision)
                        dirty = true;
            if (dirty) {
                this.paint(patch, w);
            }
            patch.revision = w.revision;
            ctx.drawImage(patch.canvas, patch.x * CELL - MARGIN, patch.y * CELL - MARGIN, SPAN + MARGIN * 2, SPAN + MARGIN * 2);
        }
    }
    private paint(p: Patch, w: Pick<World, 'cells' | 'cellVersions' | 'revision' | 'groundHeight'>) {
        const g = p.canvas.getContext('2d')!;
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.clearRect(0, 0, p.canvas.width, p.canvas.height);
        g.scale(2, 2);
        g.translate(MARGIN - p.x * CELL, MARGIN - p.y * CELL);
        const point = (x: number, y: number) => { const h = lift(w.groundHeight(x, y), true); return { x: x + h.x, y: y + h.y }; };
        const triangle = (a: {
            x: number;
            y: number;
        }, b: {
            x: number;
            y: number;
        }, c: {
            x: number;
            y: number;
        }, color: string) => { g.fillStyle = color; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(c.x, c.y); g.closePath(); g.fill(); g.strokeStyle = color; g.lineWidth = .12; g.stroke(); };
        for (let y = p.y; y < p.y + CHUNK; y++)
            for (let x = p.x; x < p.x + CHUNK; x++) {
                const c = w.cells[y * GRID + x], wx = x * CELL, wy = y * CELL;
                const h = w.groundHeight(wx + 2, wy + 2), dx = w.groundHeight(wx + 4, wy + 2) - w.groundHeight(wx, wy + 2), dy = w.groundHeight(wx + 2, wy + 4) - w.groundHeight(wx + 2, wy);
                const light = Math.max(-10, Math.min(12, -dx * 2 - dy * 2)), noise = ((x * 13 + y * 7) % 7) * .4;
                const path = Math.abs(wy + 2 - (218 + Math.sin((wx - 130) / 90) * 12)) < 3;
                const shade = c.depth > .05 ? Math.max(9, 28 - c.depth * 1.2 + light) : 27 + h * .25 + light + noise;
                const hue = c.depth > .05 ? 32 : path ? 54 : 135, sat = c.depth > .05 ? 17 : path ? 13 : 21;
                const a = point(wx, wy), b = point(wx + CELL, wy), d = point(wx, wy + CELL), e = point(wx + CELL, wy + CELL);
                triangle(a, b, e, `hsl(${hue},${sat}%,${shade}%)`);
                triangle(a, e, d, `hsl(${hue},${sat}%,${shade - .12}%)`);
                // Sparse contour segments make metres of relief legible without a debug grid.
                const top = w.groundHeight(wx + 2, wy), bottom = w.groundHeight(wx + 2, wy + 4);
                if (Math.floor(top / 2) !== Math.floor(bottom / 2)) {
                    g.strokeStyle = c.depth > .1 ? '#c5ae8138' : '#bbcc9c24';
                    g.lineWidth = .09;
                    g.beginPath();
                    g.moveTo(a.x, a.y);
                    g.lineTo(b.x, b.y);
                    g.stroke();
                }
            }
    }
}
