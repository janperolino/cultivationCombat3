import type { World, Actor } from './sim.ts';
import type { Aim } from './targeting.ts';
import type { TechniqueId } from './content.ts';

export type Telegraph = { owner: number; targetId: number; kind: TechniqueId; aim: { x: number; y: number; z: number }; remaining: number; duration: number };
export type EnemyState = { actorId: number; definitionId: string; targetId?: number; recovery: number; warning?: Telegraph };
const separation = (a: Actor, b: Actor) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

// Bounded flying navigation: look ahead and rise over terrain/cover, then sidestep
// actor congestion. This uses the same swept collision as player movement.
export function approach(world: World, actor: Actor, target: Actor, speed: number, dt: number) {
    const dx = target.x - actor.x, dy = target.y - actor.y, n = Math.hypot(dx, dy) || 1;
    world.climb(actor, Math.abs(target.z - actor.z) > 1 ? Math.sign(target.z - actor.z) : 0, dt);
    world.autoClearance(actor, { x: dx / n, y: dy / n }, dt);
    const x = actor.x, y = actor.y;
    world.move(actor, dx / n, dy / n, dt, speed);
    if (Math.hypot(actor.x - x, actor.y - y) < speed * dt * .25) {
        // Stable per-actor handedness avoids random navigation/RNG coupling.
        const side = actor.id % 2 ? -1 : 1;
        world.move(actor, -dy / n * side, dx / n * side, dt, speed);
    }
    actor.vx = (actor.x - x) / dt; actor.vy = (actor.y - y) / dt;
}

export function stepEnemies(world: World, dt: number) {
    if (world.encounter && world.encounter.phase !== 'active') return;
    for (const state of world.enemyStates.values()) {
        const actor = world.actors.find(a => a.id === state.actorId);
        const config = world.content.enemies.find(e => e.id === state.definitionId)?.combat;
        if (!actor || !config) continue; // Stationary baseline has no autonomous behavior.
        actor.vx = 0; actor.vy = 0;
        state.recovery = Math.max(0, state.recovery - dt);
        const valid = (a: Actor) => a.id < 2 && (!world.encounter || world.encounter.participants.has(a.id)) && a.hp > 0 && world.canDamage(actor.id, a) && separation(actor, a) <= config.perception;
        if (actor.hp <= 0) { actor.vz = 0; state.warning = undefined; state.targetId = undefined; continue; }
        if (state.warning) {
            actor.vz = 0;
            const target = world.actors.find(a => a.id === state.warning!.targetId);
            if (!target || !valid(target)) {
                state.warning = undefined; state.targetId = undefined; state.recovery = config.recovery; continue;
            }
            state.warning.remaining = Math.max(0, state.warning.remaining - dt);
            if (state.warning.remaining < 1e-9) {
                // Coordinates are committed when the warning starts. targetId is
                // only used by the existing cast for vertical aim/guided bolts.
                const aim: Aim = { ...state.warning.aim, targetId: target.id };
                world.cast(actor, state.warning.kind, aim);
                state.warning = undefined; state.recovery = config.recovery;
            }
            continue;
        }
        const candidates = world.actors.filter(valid).sort((a, b) => separation(actor, a) - separation(actor, b) || a.id - b.id);
        const target = candidates[0]; state.targetId = target?.id;
        if (!target) { actor.vz = 0; continue; }
        actor.aim = Math.atan2(target.y - actor.y, target.x - actor.x);
        const d = separation(actor, target);
        // Attack only with a clear trajectory at launch altitude. Otherwise fly
        // above cover before warning, rather than repeatedly firing into a wall.
        const clear = lineClear(world, actor, target);
        if (d > config.range || !clear) approach(world, actor, target, config.speed, dt);
        else if (state.recovery <= 0) {
            actor.vz = 0;
            const slot = ['bolt', 'slash', 'nova'].indexOf(config.technique);
            const technique = world.content.techniques.find(t => t.id === config.technique)!;
            if (actor.cool[slot] <= 0 && actor.qi >= technique.cost) state.warning = {
                owner: actor.id, targetId: target.id, kind: config.technique,
                aim: { x: target.x, y: target.y, z: target.z + .7 }, remaining: config.windup, duration: config.windup,
            };
        } else actor.vz = 0;
    }
}

function lineClear(world: World, a: Actor, b: Actor) {
    const steps = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.y - b.y) / 2));
    for (let i = 1; i < steps; i++) {
        const t = i / steps, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t;
        if (world.coverTop(x, y) + .3 > a.z + .7 + (b.z - a.z) * t) return false;
    }
    return true;
}
