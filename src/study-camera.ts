import { project, unproject, lift, pickSurface } from './projection.ts';
import type { Actor, Vec } from './sim.ts';

// Shared projection for drawing, cursor picking and screen-relative input.
export class StudyCamera {
    x = 256; y = 256; zoom = 6; targetZoom = 6; width = 1280; height = 800;
    shake = { x: 0, y: 0 };
    get origin() { return { x: this.width * .54 + this.shake.x, y: this.height * .54 + this.shake.y }; }
    follow(actor: Actor, dt: number, snap = false, target?: Actor) {
        const blend = snap ? 1 : 1 - Math.exp(-Math.min(.1, dt) * 10), raised = lift(actor.z * .6, true);
        const focus = target && Math.hypot(target.x - actor.x, target.y - actor.y) < 160 ? .2 : 0;
        this.x += (actor.x + ((target?.x ?? actor.x) - actor.x) * focus + raised.x - this.x) * blend;
        this.y += (actor.y + ((target?.y ?? actor.y) - actor.y) * focus + raised.y - this.y) * blend;
        this.zoom += (this.targetZoom - this.zoom) * (snap ? 1 : 1 - Math.exp(-dt * 5));
    }
    screen(point: Vec, z = point.z ?? 0) {
        const p = project({ x: point.x - this.x, y: point.y - this.y }, true), o = this.origin;
        return { x: o.x + p.x * this.zoom, y: o.y + (p.y - z) * this.zoom };
    }
    ground(pointer: Vec, height: (x: number, y: number) => number) {
        const o = this.origin, flat = unproject({ x: (pointer.x - o.x) / this.zoom, y: (pointer.y - o.y) / this.zoom }, true);
        return pickSurface({ x: flat.x + this.x, y: flat.y + this.y }, height, true);
    }
    movement(x: number, y: number) {
        const p = unproject({ x, y }, true), n = Math.max(1, Math.hypot(p.x, p.y));
        return { x: p.x / n, y: p.y / n };
    }
}
