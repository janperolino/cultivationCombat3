import type { Actor, Vec } from './sim.ts';
import { hostile } from './teams.ts';
export type Aim = Vec & {
    targetId?: number;
    locked?: boolean;
};
export type TargetCandidate = {
    actor: Actor;
    screen: Vec;
    ground: Vec;
};
export const ASSIST_RADIUS = 84, ASSIST_RANGE = 180, LOCK_RANGE = 220;
export function targetInRange(shooter: Actor, target: Actor, range: number) { return hostile(shooter, target) && target.hp > 0 &&
    Math.hypot(target.x - shooter.x, target.y - shooter.y, target.z - shooter.z) <= range; }
function segmentDistance(p: Vec, a: Vec, b: Vec) { const dx = b.x - a.x, dy = b.y - a.y, n = dx * dx + dy * dy, t = n ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / n)) : 0; return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t); }
export function cursorTarget(shooter: Actor, mouse: Vec, candidates: TargetCandidate[], radius = ASSIST_RADIUS) { let best: Actor | undefined, score = radius; for (const c of candidates) {
    if (!targetInRange(shooter, c.actor, ASSIST_RANGE))
        continue;
    const d = segmentDistance(mouse, c.screen, c.ground);
    if (d < score) {
        score = d;
        best = c.actor;
    }
} return best; }
export type Velocity3 = {
    x: number;
    y: number;
    z: number;
};
// Rotate a velocity toward its goal by at most turnRate * dt, without changing speed.
export function steerVelocity(current: Velocity3, goal: Velocity3, speed: number, turnRate: number, dt: number): Velocity3 {
    const n = Math.hypot(current.x, current.y, current.z) || 1, m = Math.hypot(goal.x, goal.y, goal.z);
    if (m < .001)
        return current;
    const a = { x: current.x / n, y: current.y / n, z: current.z / n }, b = { x: goal.x / m, y: goal.y / m, z: goal.z / m };
    const dot = Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y + a.z * b.z)), angle = Math.acos(dot), step = Math.min(angle, turnRate * dt);
    if (angle < 1e-6)
        return { x: b.x * speed, y: b.y * speed, z: b.z * speed };
    let px = b.x - a.x * dot, py = b.y - a.y * dot, pz = b.z - a.z * dot, pn = Math.hypot(px, py, pz);
    if (pn < 1e-6) {
        px = -a.y;
        py = a.x;
        pz = 0;
        pn = Math.hypot(px, py);
        if (pn < 1e-6) {
            px = 1;
            py = 0;
            pn = 1;
        }
    }
    const c = Math.cos(step), s = Math.sin(step);
    return { x: (a.x * c + px / pn * s) * speed, y: (a.y * c + py / pn * s) * speed, z: (a.z * c + pz / pn * s) * speed };
}
