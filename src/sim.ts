import { dashProfile } from './time-flow.ts';
import { steerVelocity, targetInRange, LOCK_RANGE } from './targeting.ts';
import type { Aim } from './targeting.ts';
// Pure deterministic simulation. Metres, seconds and a fixed 1/60 s step; no DOM.
export type Vec = {
    x: number;
    y: number;
    z?: number;
};
export type Technique = 'bolt' | 'slash' | 'nova';
export type ActorInput = {
    move: Vec;
    aim: Aim;
    fire?: Technique;
    dash?: boolean;
    climb?: number;
    autoAltitude?: boolean;
};
export type Cell = {
    kind: number;
    hp: number;
    max: number;
    depth: number;
    elevation: number;
};
export type Actor = Vec & {
    team?: number;
    z: number;
    vz: number;
    id: number;
    hp: number;
    maxHp: number;
    qi: number;
    realm: number;
    cool: number[];
    aim: number;
    ward: number;
    vx: number;
    vy: number;
    dashLeft: number;
    dashCool: number;
    dashX: number;
    dashY: number;
};
export type Effect = Vec & {
    kind: string;
    radius: number;
    life: number;
    maxLife: number;
    angle: number;
    text?: string;
};
export type Bolt = Vec & {
    targetId?: number;
    locked: boolean;
    guided: boolean;
    vz: number;
    errorX: number;
    errorY: number;
    z: number;
    startZ: number;
    targetZ: number;
    startX: number;
    startY: number;
    controlX: number;
    controlY: number;
    approachX: number;
    approachY: number;
    targetX: number;
    targetY: number;
    age: number;
    flight: number;
    damageScale: number;
    delay: number;
    launched: boolean;
    vx: number;
    vy: number;
    owner: number;
    power: number;
    life: number;
};
export type SwordWave = Vec & {
    vz: number;
    z: number;
    angle: number;
    span: number;
    speed: number;
    remaining: number;
    owner: number;
    power: number;
    hit: Set<number>;
    cut: Set<number>;
};
export type Cast = Vec & {
    z: number;
    startZ: number;
    groundZ: number;
    hit: Set<number>;
    sourceX: number;
    sourceY: number;
    angle: number;
    owner: number;
    power: number;
    radius: number;
    left: number;
};
export const SIZE = 512, CELL = 4, GRID = 128, DT = 1 / 60;
export const REALMS = ['Qi Gathering', 'Foundation', 'Golden Core', 'Nascent Soul'];
export function landscapeHeight(x: number, y: number) {
    const ridge = 13 * Math.exp(-Math.pow((x - 278 - (y - 256) * .25) / 19, 2)) * Math.exp(-Math.pow((y - 250) / 115, 2));
    const valley = -6 * Math.exp(-Math.pow((x - 218) / 35, 2) - Math.pow((y - 294) / 66, 2));
    return ridge + valley + 1.5 * Math.sin(x / 51) * Math.cos(y / 63);
}
export const power = (realm: number) => Math.pow(3, realm);
export const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);
export class World {
    cells: Cell[] = [];
    actors: Actor[] = [];
    bolts: Bolt[] = [];
    effects: Effect[] = [];
    casts: Cast[] = [];
    waves: SwordWave[] = [];
    time = 0;
    sceneTime = 0;
    timeScale = 1;
    destroyed = 0;
    ai = true;
    aiClock = 1;
    revision = 0;
    // Per-cell mutation stamps let independent renderers update only changed regions.
    cellVersions = new Uint32Array(GRID * GRID);
    private randomState = 0x53455645;
    random() { let x = this.randomState; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.randomState = x >>> 0; return this.randomState / 4294967296; }
    constructor() {
        for (let y = 0; y < GRID; y++)
            for (let x = 0; x < GRID; x++) {
                const h = ((x * 374761393 ^ y * 668265263) >>> 0) % 100;
                const clear = Math.hypot(x * CELL - 232, y * CELL - 256) < 17 || Math.hypot(x * CELL - 280, y * CELL - 256) < 17;
                const kind = clear ? 0 : h < 9 ? 2 : h < 25 ? 1 : 0;
                const max = kind === 2 ? 200 : kind === 1 ? 55 : 0;
                this.cells.push({ kind, hp: max, max, depth: 0, elevation: landscapeHeight(x * CELL + 2, y * CELL + 2) });
            }
        for (const [ox, oy] of [[208, 216], [272, 208], [312, 272], [204, 292]]) {
            for (let y = 0; y < 3; y++)
                for (let x = 0; x < 5; x++) {
                    if (y === 1 && x > 0 && x < 4)
                        continue;
                    if (y === 2 && x === 2)
                        continue;
                    this.cells[(oy / CELL + y) * GRID + ox / CELL + x] = { ...this.cells[(oy / CELL + y) * GRID + ox / CELL + x], kind: 2, hp: 200, max: 200, depth: 0 };
                }
        }
        this.actors = [this.actor(0, 232, 256), this.actor(1, 280, 256)];
    }
    actor(id: number, x: number, y: number): Actor { return { id, x, y, z: this.groundHeight(x, y) + 3, vz: 0, hp: 500, maxHp: 500, qi: 100, realm: 1, cool: [0, 0, 0], aim: id ? Math.PI : 0, ward: 100, vx: 0, vy: 0, dashLeft: 0, dashCool: 0, dashX: 1, dashY: 0 }; }
    canDamage(ownerId: number, target: Actor) {
        const owner = this.actors.find(a => a.id === ownerId);
        return !!owner && ownerId !== target.id && (owner.team === undefined || target.team === undefined || owner.team !== target.team);
    }
    cellAt(x: number, y: number) { return this.cells[Math.floor(y / CELL) * GRID + Math.floor(x / CELL)]; }
    groundHeight(x: number, y: number): number {
        const fx = Math.max(0, Math.min(GRID - 1, x / CELL - .5)), fy = Math.max(0, Math.min(GRID - 1, y / CELL - .5)), ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
        const at = (cx: number, cy: number) => { const c = this.cells[Math.min(GRID - 1, cy) * GRID + Math.min(GRID - 1, cx)]; return c ? c.elevation - c.depth : 0; };
        return (at(ix, iy) * (1 - tx) + at(ix + 1, iy) * tx) * (1 - ty) + (at(ix, iy + 1) * (1 - tx) + at(ix + 1, iy + 1) * tx) * ty;
    }
    roofHeight(x: number, y: number) {
        for (const [ox, oy] of [[208, 216], [272, 208], [312, 272], [204, 292]]) {
            if (x < ox || y < oy || x > ox + 20 || y > oy + 12)
                continue;
            let alive = 0;
            for (let dy = 0; dy < 3; dy++)
                for (let dx = 0; dx < 5; dx++)
                    if (this.cellAt(ox + dx * 4 + 2, oy + dy * 4 + 2)?.hp > 0)
                        alive++;
            if (alive > 9)
                return 7.5;
        }
        return 0;
    }
    coverTop(x: number, y: number) { const c = this.cellAt(x, y); return this.groundHeight(x, y) + Math.max(this.roofHeight(x, y), c?.hp > 0 ? (c.kind === 1 ? 7 : 3) : 0); }
    climb(a: Actor, axis: number, dt: number) {
        if (a.hp <= 0)
            return;
        a.vz += (axis * 14 - a.vz) * (1 - Math.exp(-12 * dt));
        a.z = Math.max(this.groundHeight(a.x, a.y) + .65, Math.min(65, a.z + a.vz * dt));
    }
    // Rise-only lookahead keeps manual altitude and combat targeting independent.
    autoClearance(a: Actor, direction: Vec, dt: number) {
        if (a.hp <= 0) return;
        const moving = Math.hypot(direction.x, direction.y) > .01;
        const dx = moving ? direction.x : a.vx, dy = moving ? direction.y : a.vy;
        const n = Math.hypot(dx, dy);
        if (n < .05) return;
        const ux = dx / n, uy = dy / n;
        const speed = a.dashLeft > 0 ? dashProfile(a.realm).speed : Math.max(30, Math.hypot(a.vx, a.vy));
        const reach = Math.min(44, speed * .6 + 3);
        let floor = a.z;
        for (let d = 0; d <= reach; d += 2) {
            for (const side of [-.9, 0, .9]) {
                const x = a.x + ux * d - uy * side, y = a.y + uy * d + ux * side;
                if (x < .75 || y < .75 || x > SIZE - .75 || y > SIZE - .75) continue;
                floor = Math.max(floor, this.coverTop(x, y) + 2);
            }
        }
        a.z = Math.min(65, a.z + Math.min(Math.max(0, floor - a.z), 24 * dt));
        if (floor > a.z) a.vz = Math.max(0, a.vz);
    }
    effect(kind: string, p: Vec, radius: number, life: number, angle = 0, text?: string) { this.effects.push({ ...p, z: p.z ?? this.groundHeight(p.x, p.y), kind, radius, life, maxLife: life, angle, text }); }
    damage(a: Actor, raw: number) {
        if (a.hp <= 0)
            return;
        const amount = raw / power(a.realm);
        const absorb = Math.min(a.ward, amount * .65);
        a.ward -= absorb;
        a.hp = Math.max(0, a.hp - (amount - absorb));
        this.effect('text', a, 0, .9, 0, `${Math.round(amount - absorb)}`);
        if (!a.hp)
            this.effect('death', a, 16, 1.5);
    }
    terrain(p: Vec, radius: number, raw: number) {
        let changed = false;
        for (let y = Math.max(0, Math.floor((p.y - radius) / CELL)); y <= Math.min(GRID - 1, Math.floor((p.y + radius) / CELL)); y++)
            for (let x = Math.max(0, Math.floor((p.x - radius) / CELL)); x <= Math.min(GRID - 1, Math.floor((p.x + radius) / CELL)); x++) {
                const d = Math.hypot(x * CELL + 2 - p.x, y * CELL + 2 - p.y);
                if (d > radius)
                    continue;
                this.cellVersions[y * GRID + x] = this.revision + 1;
                const c = this.cells[y * GRID + x], fall = 1 - d / radius;
                c.depth = Math.min(12, c.depth + raw * fall / 300);
                if (c.hp > 0) {
                    c.hp = Math.max(0, c.hp - raw * fall);
                    if (c.hp === 0) {
                        c.kind = 0;
                        this.destroyed++;
                    }
                }
                changed = true;
            }
        if (changed)
            this.revision++;
    }
    blocked(x: number, y: number, r = .75, altitude?: number) {
        if (x < r || y < r || x > SIZE - r || y > SIZE - r)
            return true;
        if (altitude !== undefined && this.groundHeight(x, y) + .65 > altitude)
            return true;
        if (altitude !== undefined && this.roofHeight(x, y) > 0 && altitude < this.coverTop(x, y))
            return true;
        for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++)
            for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) {
                const c = this.cells[cy * GRID + cx];
                if (c?.hp > 0 && (altitude === undefined || altitude < this.coverTop(cx * CELL + 2, cy * CELL + 2))) {
                    const nx = Math.max(cx * CELL, Math.min(x, cx * CELL + CELL)), ny = Math.max(cy * CELL, Math.min(y, cy * CELL + CELL));
                    if (Math.hypot(x - nx, y - ny) < r)
                        return true;
                }
            }
        return this.actors.some(a => a.hp > 0 && (altitude === undefined || Math.abs(a.z - altitude) < 1.8) && Math.hypot(a.x - x, a.y - y) < 1.5 && Math.hypot(a.x - x, a.y - y) > .001);
    }
    // Collision-safe displacement shared by normal movement and high-speed dashes.
    move(a: Actor, dx: number, dy: number, dt: number, speed = 30) {
        if (a.hp <= 0)
            return;
        const n = Math.hypot(dx, dy);
        if (!n)
            return;
        const mx = dx / Math.max(1, n) * speed * dt, my = dy / Math.max(1, n) * speed * dt;
        const steps = Math.max(1, Math.ceil(Math.hypot(mx, my) / .3));
        let x = a.x, y = a.y;
        a.x = -1000;
        a.y = -1000;
        for (let i = 0; i < steps; i++) {
            if (!this.blocked(x + mx / steps, y, .75, a.z))
                x += mx / steps;
            if (!this.blocked(x, y + my / steps, .75, a.z))
                y += my / steps;
        }
        a.x = x;
        a.y = y;
    }
    dash(a: Actor, direction: Vec) {
        if (a.hp <= 0 || a.dashLeft > 0 || a.dashCool > 0 || a.qi < 10)
            return false;
        const n = Math.hypot(direction.x, direction.y);
        a.dashX = n ? direction.x / n : Math.cos(a.aim);
        a.dashY = n ? direction.y / n : Math.sin(a.aim);
        const profile = dashProfile(a.realm);
        a.dashLeft = profile.duration;
        a.dashCool = profile.duration + profile.recovery;
        a.vx = a.dashX * profile.speed;
        a.vy = a.dashY * profile.speed;
        a.qi -= 10;
        this.effect('dash', a, 4, .3, Math.atan2(a.dashY, a.dashX));
        return true;
    }
    locomotion(a: Actor, direction: Vec, dt: number) {
        if (a.hp <= 0) {
            a.vx = 0;
            a.vy = 0;
            a.dashLeft = 0;
            return;
        }
        if (a.dashLeft > 0) {
            const duration = Math.min(dt, a.dashLeft), n = Math.hypot(direction.x, direction.y);
            if (n) {
                const current = Math.atan2(a.dashY, a.dashX), desired = Math.atan2(direction.y, direction.x), delta = Math.atan2(Math.sin(desired - current), Math.cos(desired - current));
                const heading = current + Math.max(-18 * dt, Math.min(18 * dt, delta));
                a.dashX = Math.cos(heading);
                a.dashY = Math.sin(heading);
            }
            const speed = dashProfile(a.realm).speed;
            a.vx = a.dashX * speed;
            a.vy = a.dashY * speed;
            this.move(a, a.dashX, a.dashY, duration, speed);
            a.dashLeft = a.dashLeft - dt < 1e-9 ? 0 : a.dashLeft - dt;
            return;
        }
        const n = Math.hypot(direction.x, direction.y);
        if (n) {
            const blend = 1 - Math.exp(-9 * dt);
            a.vx += (direction.x / n * 30 - a.vx) * blend;
            a.vy += (direction.y / n * 30 - a.vy) * blend;
        }
        else {
            const drag = Math.exp(-2.7 * dt);
            a.vx *= drag;
            a.vy *= drag;
            if (Math.hypot(a.vx, a.vy) < .05) {
                a.vx = 0;
                a.vy = 0;
            }
        }
        const speed = Math.hypot(a.vx, a.vy);
        if (speed)
            this.move(a, a.vx / speed, a.vy / speed, dt, speed);
    }
    cast(a: Actor, kind: Technique, target: Aim) {
        const i = ['bolt', 'slash', 'nova'].indexOf(kind), cost = [9, 16, 38][i];
        if (a.hp <= 0 || a.cool[i] > 0 || a.qi < cost)
            return false;
        const angle = Math.atan2(target.y - a.y, target.x - a.x), p = power(a.realm);
        a.aim = angle;
        a.qi -= cost;
        a.cool[i] = [.95, .65, 3.2][i];
        if (kind === 'bolt') {
            const reach = Math.max(target.targetId !== undefined ? 4 : 16, Math.min(180, distance(a, target))), co = Math.cos(angle), si = Math.sin(angle);
            const tx = a.x + co * reach, ty = a.y + si * reach, flight = reach / 95 * 1.15;
            const slots = [-2, -1, 0, 1, 2];
            for (let j = 4; j > 0; j--) {
                const k = Math.floor(this.random() * (j + 1));
                [slots[j], slots[k]] = [slots[k], slots[j]];
            }
            let delay = 0;
            for (let j = 0; j < 5; j++) {
                const i = slots[j], fan = i * .32 + (this.random() - .5) * .22, spread = i / 2 + (this.random() - .5) * .2;
                const errorAngle = this.random() * Math.PI * 2, errorRadius = Math.sqrt(this.random()) * (1 + reach * .035);
                const errorX = Math.cos(errorAngle) * errorRadius, errorY = Math.sin(errorAngle) * errorRadius;
                if (j)
                    delay += .045 + this.random() * .065;
                this.bolts.push({ targetId: target.targetId, locked: target.locked ?? false, guided: false, vz: 0, errorX: errorX * .22, errorY: errorY * .22, x: a.x, y: a.y, vx: Math.cos(angle + fan) * 95, vy: Math.sin(angle + fan) * 95, z: a.z + .7, startZ: a.z + .7, targetZ: target.z ?? a.z + .7, owner: a.id, power: p, life: 2.4,
                    startX: a.x, startY: a.y, controlX: a.x + Math.cos(angle + fan) * reach * .55, controlY: a.y + Math.sin(angle + fan) * reach * .55,
                    approachX: tx - co * reach * .24 - si * spread * reach * .18, approachY: ty - si * reach * .24 + co * spread * reach * .18,
                    targetX: tx + errorX, targetY: ty + errorY, age: 0, flight: flight * (.92 + this.random() * .16), damageScale: .2, delay, launched: false });
            }
        }
        else if (kind === 'slash') {
            const span = 4 + 3 * a.realm, range = 36 * Math.pow(1.65, a.realm);
            this.effect('slash', a, range, .2, angle);
            const slope = target.targetId !== undefined ? ((target.z ?? a.z + .7) - (a.z + .7)) / Math.max(1, distance(a, target) - span * .2) : 0;
            const planar = 1 / Math.sqrt(1 + slope * slope);
            this.waves.push({ vz: slope * (105 + 15 * a.realm) * planar, z: a.z + .7, x: a.x - Math.cos(angle) * span * .8, y: a.y - Math.sin(angle) * span * .8, angle, span, speed: (105 + 15 * a.realm) * planar, remaining: range * planar, owner: a.id, power: p, hit: new Set(), cut: new Set() });
        }
        else {
            const d = distance(a, target), reach = 60 + 20 * a.realm;
            const groundZ = this.groundHeight(a.x + (target.x - a.x) * Math.min(1, reach / (d || 1)), a.y + (target.y - a.y) * Math.min(1, reach / (d || 1))), startZ = Math.max(a.z, groundZ, target.targetId !== undefined ? (target.z ?? a.z) : a.z) + 25 + (10 * Math.pow(2, a.realm)) * .75;
            this.casts.push({ z: startZ, startZ, groundZ, hit: new Set(), sourceX: a.x, sourceY: a.y, angle, x: a.x + (target.x - a.x) * Math.min(1, reach / (d || 1)), y: a.y + (target.y - a.y) * Math.min(1, reach / (d || 1)), owner: a.id, power: p, radius: 10 * Math.pow(2, a.realm), left: .65 });
        }
        return true;
    }
    step(input: ActorInput, dt = DT) {
        this.advance(input, dt);
    }
    // Trusted simulation inputs, not a network boundary. Presence marks player control;
    // callers must supply idle inputs too. Shared mode deliberately has no global slow.
    stepPlayers(inputs: ReadonlyMap<number, ActorInput>, dt = DT) {
        this.advance({ move: { x: 0, y: 0 }, aim: this.actors[0] }, dt, inputs);
    }
    private advance(input: ActorInput, dt: number, players?: ReadonlyMap<number, ActorInput>) {
        if (dt <= 0 || dt > .05)
            throw Error('Use fixed small steps');
        this.time += dt;
        const player = this.actors[0], enemy = this.actors[1];
        const controlled = players
            ? this.actors.filter(a => players.has(a.id)).map(actor => ({ actor, input: players.get(actor.id)! }))
            : [{ actor: player, input }];
        for (const c of controlled) {
            this.climb(c.actor, c.input.climb ?? 0, dt);
            if (c.input.dash) this.dash(c.actor, c.input.move);
        }
        const desiredScale = player.hp > 0 && player.dashLeft > 0 ? dashProfile(player.realm).worldScale : 1;
        if (players) this.timeScale = 1;
        else this.timeScale += (desiredScale - this.timeScale) * (1 - Math.exp(-dt * (desiredScale < this.timeScale ? 18 : 9)));
        if (Math.abs(this.timeScale - 1) < .001)
            this.timeScale = 1;
        const sceneDt = dt * this.timeScale;
        this.sceneTime += sceneDt;
        for (const c of controlled) {
            const a = c.actor, command = c.input;
            if (command.autoAltitude && !command.climb) this.autoClearance(a, command.move, dt);
            this.locomotion(a, command.move, dt);
            a.aim = Math.atan2(command.aim.y - a.y, command.aim.x - a.x);
            if (command.fire) this.cast(a, command.fire, command.aim);
        }
        if (this.ai && !players?.has(enemy.id) && enemy.hp > 0 && player.hp > 0) {
            this.climb(enemy, Math.abs(player.z - enemy.z) > 1.5 ? Math.sign(player.z - enemy.z) : 0, sceneDt);
            enemy.aim = Math.atan2(player.y - enemy.y, player.x - enemy.x);
            const d = distance(player, enemy);
            if (d > 25)
                this.locomotion(enemy, { x: player.x - enemy.x, y: player.y - enemy.y }, sceneDt);
            else if (d < 14)
                this.locomotion(enemy, { x: enemy.x - player.x, y: enemy.y - player.y }, sceneDt);
            else
                this.locomotion(enemy, { x: 0, y: 0 }, sceneDt);
            this.aiClock -= sceneDt;
            if (this.aiClock <= 0) {
                this.cast(enemy, d < 12 ? 'slash' : Math.floor(this.sceneTime) % 4 === 0 ? 'nova' : 'bolt', { ...player, z: player.z + .7, targetId: player.id });
                this.aiClock = .85;
            }
        }
        for (const a of this.actors) {
            const actorDt = a.id === 0 ? dt : sceneDt;
            a.dashCool = Math.max(0, a.dashCool - actorDt);
            a.cool = a.cool.map(c => Math.max(0, c - actorDt));
            a.qi = Math.min(100, a.qi + 10 * actorDt);
        }
        for (const b of this.bolts) {
            if (!b.launched) {
                b.delay -= sceneDt;
                if (b.delay > 0)
                    continue;
                const owner = this.actors.find(a => a.id === b.owner);
                if (!owner || owner.hp <= 0) {
                    b.life = 0;
                    continue;
                }
                const dx = owner.x - b.startX, dy = owner.y - b.startY;
                b.z = owner.z + .7;
                b.startZ = b.z;
                b.startX = owner.x;
                b.startY = owner.y;
                b.x = owner.x;
                b.y = owner.y;
                b.controlX += dx;
                b.controlY += dy;
                b.launched = true;
            }
            let hit = false;
            const oldX = b.x, oldY = b.y, oldZ = b.z;
            b.age += sceneDt;
            const t = Math.min(1, b.age / b.flight), u = 1 - t;
            let nextX = u * u * u * b.startX + 3 * u * u * t * b.controlX + 3 * u * t * t * b.approachX + t * t * t * b.targetX;
            let nextY = u * u * u * b.startY + 3 * u * u * t * b.controlY + 3 * u * t * t * b.approachY + t * t * t * b.targetY;
            if (b.age > b.flight) {
                const dx = b.targetX - b.startX, dy = b.targetY - b.startY, n = Math.hypot(dx, dy) || 1;
                nextX = b.targetX + dx / n * (b.age - b.flight) * 95;
                nextY = b.targetY + dy / n * (b.age - b.flight) * 95;
            }
            let nextZ = b.startZ + (b.targetZ - b.startZ) * t * t * (3 - 2 * t);
            const tracked = b.targetId === undefined ? undefined : this.actors.find(a => a.id === b.targetId);
            const owner = this.actors.find(a => a.id === b.owner);
            const valid = tracked && owner && targetInRange(owner, tracked, LOCK_RANGE);
            if (b.targetId !== undefined && !valid)
                b.targetId = undefined;
            if (valid && b.age >= Math.min(.2, b.flight * .35)) {
                b.guided = true;
                const lead = Math.min(.18, Math.hypot(tracked.x - b.x, tracked.y - b.y, tracked.z - b.z) / 95 * .35);
                const velocity = steerVelocity({ x: b.vx, y: b.vy, z: b.vz }, { x: tracked.x + tracked.vx * lead + b.errorX - b.x, y: tracked.y + tracked.vy * lead + b.errorY - b.y, z: tracked.z + .7 + tracked.vz * lead - b.z }, 95, b.locked ? 3.3 : 2.8, sceneDt);
                b.vx = velocity.x;
                b.vy = velocity.y;
                b.vz = velocity.z;
            }
            if (b.guided) {
                nextX = oldX + b.vx * sceneDt;
                nextY = oldY + b.vy * sceneDt;
                nextZ = oldZ + b.vz * sceneDt;
            }
            b.vx = (nextX - oldX) / sceneDt;
            b.vy = (nextY - oldY) / sceneDt;
            b.vz = (nextZ - oldZ) / sceneDt;
            const steps = Math.max(1, Math.ceil(Math.hypot(nextX - oldX, nextY - oldY, nextZ - oldZ) / .4));
            for (let i = 0; i < steps && !hit; i++) {
                b.x = oldX + (nextX - oldX) * (i + 1) / steps;
                b.y = oldY + (nextY - oldY) * (i + 1) / steps;
                b.z = oldZ + (nextZ - oldZ) * (i + 1) / steps;
                const actor = this.actors.find(a => this.canDamage(b.owner, a) && a.hp > 0 && Math.hypot(a.x - b.x, a.y - b.y, a.z + .7 - b.z) < 1.25);
                const cell = this.cellAt(b.x, b.y);
                if (actor) {
                    this.damage(actor, 48 * b.power * b.damageScale);
                    hit = true;
                }
                else if (b.x < 0 || b.y < 0 || b.x >= SIZE || b.y >= SIZE)
                    hit = true;
                else if (b.z <= this.coverTop(b.x, b.y) + .15)
                    hit = true;
                if (hit) {
                    const radius = 3 + Math.sqrt(b.power) * 1.5;
                    if (b.z - this.groundHeight(b.x, b.y) < radius)
                        this.terrain(b, radius, 60 * b.power * b.damageScale);
                    this.effect('impact', b, 3 + Math.sqrt(b.power) * 1.5, .55);
                    b.life = 0;
                }
            }
            b.life -= sceneDt;
        }
        this.bolts = this.bolts.filter(b => b.life > 0);
        for (const wave of this.waves) {
            const travel = Math.min(wave.remaining, wave.speed * sceneDt), steps = Math.ceil(Math.hypot(travel, wave.vz * travel / wave.speed) / .4), co = Math.cos(wave.angle), si = Math.sin(wave.angle);
            let changed = false;
            for (let step = 0; step < steps; step++) {
                if (wave.remaining <= 0)
                    break;
                wave.x += co * travel / steps;
                wave.y += si * travel / steps;
                wave.z += wave.vz * (travel / steps) / wave.speed;
                const samples = Math.ceil(wave.span * 2.3 / .65);
                for (let i = 0; i <= samples; i++) {
                    const theta = -1.15 + i / samples * 2.3, localX = Math.cos(theta) * wave.span, localY = Math.sin(theta) * wave.span;
                    const point = { x: wave.x + localX * co - localY * si, y: wave.y + localX * si + localY * co };
                    for (const a of this.actors)
                        if (this.canDamage(wave.owner, a) && a.hp > 0 && !wave.hit.has(a.id) && Math.abs(a.z + .7 - wave.z) < 1.8 && distance(a, point) < 1.5) {
                            this.damage(a, 80 * wave.power);
                            wave.hit.add(a.id);
                            this.effect('impact', a, 3, .4);
                        }
                    if (point.x < 0 || point.y < 0 || point.x >= SIZE || point.y >= SIZE)
                        continue;
                    const index = Math.floor(point.y / CELL) * GRID + Math.floor(point.x / CELL);
                    if (this.groundHeight(point.x, point.y) > .15 + wave.z) {
                        wave.remaining = 0;
                        this.terrain(point, 2, 30 * wave.power);
                        this.effect("impact", { ...point, z: wave.z }, 3, .4);
                        break;
                    }
                    if (wave.z > this.coverTop(point.x, point.y) + .3)
                        continue;
                    if (wave.cut.has(index))
                        continue;
                    wave.cut.add(index);
                    this.cellVersions[index] = this.revision + 1;
                    const c = this.cells[index];
                    c.depth = Math.min(12, c.depth + .08 * wave.power);
                    if (c.hp > 0) {
                        c.hp = Math.max(0, c.hp - 65 * wave.power);
                        if (c.hp === 0) {
                            c.kind = 0;
                            this.destroyed++;
                        }
                    }
                    changed = true;
                }
            }
            if (changed)
                this.revision++;
            wave.remaining -= travel;
        }
        this.waves = this.waves.filter(w => w.remaining > .001);
        for (const c of this.casts) {
            const previousZ = c.z;
            c.left -= sceneDt;
            c.groundZ = this.groundHeight(c.x, c.y);
            c.z = c.groundZ + (c.startZ - c.groundZ) * Math.pow(Math.max(0, Math.min(1, c.left / .4)), 2);
            for (const a of this.actors)
                if (this.canDamage(c.owner, a) && a.hp > 0 && !c.hit.has(a.id) && distance(a, c) < c.radius && a.z + .7 >= c.z - 1 && a.z + .7 <= previousZ + 1) {
                    this.damage(a, 160 * c.power * (1 - distance(a, c) / c.radius * .65));
                    c.hit.add(a.id);
                }
            if (c.left <= 0) {
                this.terrain(c, c.radius, 160 * c.power);
                this.effect('nova', { ...c, z: this.groundHeight(c.x, c.y) }, c.radius, 1.8, c.angle);
            }
        }
        this.casts = this.casts.filter(c => c.left > 0);
        for (const e of this.effects)
            e.life -= sceneDt;
        this.effects = this.effects.filter(e => e.life > 0);
    }
    saveTerrain() { return JSON.stringify({ version: 2, cells: this.cells, destroyed: this.destroyed }); }
    loadTerrain(raw: string) {
        const data = JSON.parse(raw);
        if (![1, 2].includes(data.version) || !Array.isArray(data.cells) || data.cells.length !== GRID * GRID || !Number.isInteger(data.destroyed) || data.destroyed < 0 || !data.cells.every((c: Cell) => c && Number.isInteger(c.kind) && c.kind >= 0 && c.kind <= 2 && Number.isFinite(c.hp) && c.hp >= 0 && c.hp <= c.max && [0, 55, 200].includes(c.max) && Number.isFinite(c.depth) && c.depth >= 0 && c.depth <= 12))
            throw Error('Invalid terrain save');
        const restored: Cell[] = data.cells.map((c: Cell, i: number) => ({ ...c, elevation: data.version === 1 ? landscapeHeight(i % GRID * CELL + 2, Math.floor(i / GRID) * CELL + 2) : c.elevation }));
        if (!restored.every(c => Number.isFinite(c.elevation) && c.elevation >= -20 && c.elevation <= 30))
            throw Error('Invalid height map');
        this.cells = restored;
        this.destroyed = data.destroyed;
        this.revision++;
        this.cellVersions.fill(this.revision);
    }
}

