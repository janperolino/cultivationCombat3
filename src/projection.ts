import type { Vec } from './sim.ts';
export const TILT = .58, YAW = .28;
export function project(p: Vec, tilted: boolean): Vec {
    if (!tilted)
        return { ...p };
    const c = Math.cos(YAW), s = Math.sin(YAW);
    return { x: c * p.x - s * p.y, y: (s * p.x + c * p.y) * TILT };
}
export function unproject(p: Vec, tilted: boolean): Vec {
    if (!tilted)
        return { ...p };
    const c = Math.cos(YAW), s = Math.sin(YAW), y = p.y / TILT;
    return { x: c * p.x + s * y, y: -s * p.x + c * y };
}
export function lift(height: number, tilted: boolean): Vec { return tilted ? { x: -Math.sin(YAW) * height / TILT, y: -Math.cos(YAW) * height / TILT } : { x: 0, y: 0 }; }
// Cast a screen ray through the height field; cursor picking must follow the visible slopes.
export function pickSurface(flat: Vec, height: (x: number, y: number) => number, tilted: boolean): Vec {
    if (!tilted)
        return { ...flat, z: height(flat.x, flat.y) };
    const at = (z: number) => { const h = lift(z, true); return { x: flat.x - h.x, y: flat.y - h.y }; };
    let above = 32;
    for (let z = 32; z >= -32; z -= .5) {
        const p = at(z);
        if (z <= height(p.x, p.y)) {
            let low = z, high = above;
            for (let i = 0; i < 12; i++) {
                const mid = (low + high) / 2, q = at(mid);
                if (mid > height(q.x, q.y))
                    high = mid;
                else
                    low = mid;
            }
            const altitude = (low + high) / 2, q = at(altitude);
            return { ...q, z: altitude };
        }
        above = z;
    }
    const q = at(-32);
    return { ...q, z: -32 };
}
