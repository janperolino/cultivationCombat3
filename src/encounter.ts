import type { World, Actor, ActorInput } from './sim.ts';
import type { EncounterRules } from './content.ts';
import { approach } from './enemy-ai.ts';
import { sameTeam } from './teams.ts';

export type EncounterPhase = 'waiting' | 'active' | 'returning' | 'completed' | 'defeated';
export type ReviveProgress = { actorId: number; targetId: number; progress: number; duration: number };
export type EncounterView = { id: string; epoch: number; attempt: number; phase: EncounterPhase; participants: number[]; revives: ReviveProgress[] };
const distance = (a: Actor, b: Actor) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

export class Encounter {
    private world: World;
    readonly id: string;
    readonly rules: EncounterRules;
    phase: EncounterPhase = 'waiting';
    epoch = 1;
    attempt = 1;
    readonly participants = new Set<number>();
    readonly revives = new Map<number, ReviveProgress>();
    private readonly homes: { actor: Actor; altitude: number }[];
    private disengaged = 0;
    private returning = 0;
    constructor(world: World, id: string, rules: EncounterRules) {
        this.world = world; this.id = id; this.rules = rules;
        this.homes = world.actors.map(a => ({ actor: structuredClone(a), altitude: a.z - world.groundHeight(a.x, a.y) }));
    }
    view(): EncounterView { return { id: this.id, epoch: this.epoch, attempt: this.attempt, phase: this.phase,
        participants: [...this.participants].sort(), revives: [...this.revives.values()].map(r => ({ ...r })) }; }
    join(actorId: number) {
        if (actorId !== 0 && actorId !== 1) throw Error('Only player seats can participate');
        this.participants.add(actorId);
        if (this.phase === 'waiting') this.phase = 'active';
    }
    canAct(actorId: number) { return this.phase === 'active' && (actorId >= 2 || this.participants.has(actorId)); }
    private clearCombat() {
        this.world.bolts = []; this.world.waves = []; this.world.casts = []; this.world.effects = [];
        this.revives.clear();
        for (const s of this.world.enemyStates.values()) { s.warning = undefined; s.targetId = undefined; s.recovery = 0; }
        for (const a of this.world.actors) { a.vx = a.vy = a.vz = a.dashLeft = 0; }
    }
    private transition(phase: EncounterPhase) { this.phase = phase; this.epoch++; this.clearCombat(); }
    private restore(players: boolean) {
        for (const home of this.homes) {
            if (!players && home.actor.id < 2) continue;
            const current = this.world.actors.find(a => a.id === home.actor.id)!;
            Object.assign(current, structuredClone(home.actor));
            current.z = Math.min(65, Math.max(this.world.groundHeight(current.x, current.y) + home.altitude, this.world.coverTop(current.x, current.y) + 2));
        }
    }
    retry(): boolean {
        if (this.phase !== 'completed' && this.phase !== 'defeated') return false;
        this.restore(true); this.attempt++; this.disengaged = this.returning = 0; this.transition('active'); return true;
    }
    beforeStep(dt: number) {
        if (this.phase !== 'active' && this.phase !== 'returning') return;
        const living = this.world.actors.filter(a => this.participants.has(a.id) && a.hp > 0);
        if (this.participants.size && !living.length) { this.transition('defeated'); return; }
        const enemies = this.world.actors.filter(a => a.id >= 2 && a.hp > 0);
        if (this.phase === 'active') {
            if (!enemies.length) { this.transition('completed'); return; }
            const inArena = this.homes.filter(h => h.actor.id >= 2).some(h => living.some(a => distance(a, h.actor) <= this.rules.leash));
            this.disengaged = inArena ? 0 : this.disengaged + dt;
            const out = enemies.some(a => distance(a, this.homes.find(h => h.actor.id === a.id)!.actor) > this.rules.leash);
            if (out || this.disengaged + 1e-9 >= this.rules.disengage) { this.returning = 0; this.transition('returning'); }
        }
        if (this.phase === 'returning') {
            this.returning += dt;
            let arrived = true;
            for (const a of enemies) {
                const home = this.homes.find(h => h.actor.id === a.id)!;
                const goal = { ...home.actor, z: Math.min(65, Math.max(this.world.groundHeight(home.actor.x, home.actor.y) + home.altitude, this.world.coverTop(home.actor.x, home.actor.y) + 2)) };
                if (distance(a, goal) > 2) { arrived = false; approach(this.world, a, goal, 20, dt); }
                else a.vx = a.vy = a.vz = 0;
            }
            if (arrived || this.returning + 1e-9 >= this.rules.returnTimeout) {
                this.restore(false); this.attempt++; this.disengaged = 0; this.transition('active');
            }
        }
    }
    afterStep(inputs: ReadonlyMap<number, ActorInput>, previousVitality: ReadonlyMap<number, number>, dt: number) {
        if (this.phase !== 'active') return;
        // Defeat wins simultaneous elimination; terminal transitions cancel every
        // attack before it can cross into a reset or revived attempt.
        const alive = this.world.actors.some(a => this.participants.has(a.id) && a.hp > 0);
        if (this.participants.size && !alive) { this.transition('defeated'); return; }
        if (!this.world.actors.some(a => a.id >= 2 && a.hp > 0)) { this.transition('completed'); return; }
        for (const a of this.world.actors.filter(a => a.id < 2)) {
            const input = inputs.get(a.id);
            const target = this.world.actors.find(t => this.participants.has(t.id) && t.id !== a.id && t.hp <= 0 && sameTeam(t, a) && distance(a, t) <= this.rules.reviveRange);
            if (!input?.revive || !this.participants.has(a.id) || a.hp <= 0 || !target || input.fire || input.dash || a.dashLeft > 0 ||
                Math.hypot(input.move.x, input.move.y, input.climb ?? 0) > .01 || Math.hypot(a.vx, a.vy, a.vz) > .5 || a.hp + a.ward < (previousVitality.get(a.id) ?? a.hp + a.ward)) {
                this.revives.delete(a.id); continue;
            }
            const old = this.revives.get(a.id), progress = old?.targetId === target.id ? old.progress : 0;
            const next = { actorId: a.id, targetId: target.id, progress: progress + dt, duration: this.rules.reviveSeconds };
            if (next.progress + 1e-9 >= next.duration) {
                target.hp = target.maxHp * .5; target.qi = 50; target.ward = 0;
                target.cool = [0, 0, 0]; target.dashLeft = target.dashCool = target.vx = target.vy = target.vz = 0;
                this.revives.delete(a.id);
            } else this.revives.set(a.id, next);
        }
    }
}
