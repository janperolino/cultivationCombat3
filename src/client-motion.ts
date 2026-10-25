import { DT, World } from './sim.ts';
import type { Actor, ActorInput, Cell } from './sim.ts';
import type { DisplayFrame } from './replication.ts';

export const HISTORY_LIMIT = 120, PREDICTION_HORIZON = 15, INTERPOLATION_TICKS = 12;
type Sample = { tick: number; input: ActorInput };
const copy = (a: Actor): Actor => ({ ...a, cool: [...a.cool] });
export class MotionPredictor {
    private world = new World();
    private actorId: number;
    private history: Sample[] = [];
    private pending: number[] = [];
    private authoritative?: DisplayFrame;
    private lastReceiveTick = -Infinity;
    tick = 0;
    correction = 0;
    maxCorrection = 0;
    constructor(actorId: number) { this.actorId = actorId; }
    get actor() { return this.authoritative ? this.world.actors.find(a => a.id === this.actorId) : undefined; }
    get historySize() { return this.history.length; }
    get pendingCount() { return this.pending.length; }
    setTerrain(cells: Cell[]) { this.world.cells = cells; }
    noteCommand(sequence: number) { this.pending.push(sequence); this.pending = this.pending.slice(-64); }
    private motion(input: ActorInput) {
        const a = this.actor;
        if (!a) return;
        this.world.climb(a, input.climb ?? 0, DT);
        if (input.autoAltitude && !input.climb) this.world.autoClearance(a, input.move, DT);
        this.world.locomotion(a, input.move, DT);
        a.aim = Math.atan2(input.aim.y - a.y, input.aim.x - a.x);
        // No cast/dash calls: onset, resources and all combat stay authoritative.
    }
    advance(input: ActorInput, allowPrediction = true) {
        this.tick++;
        const motion: ActorInput = { move: { x: input.move.x, y: input.move.y }, aim: { ...input.aim },
            climb: input.climb, autoAltitude: input.autoAltitude };
        this.history.push({ tick: this.tick, input: motion });
        this.history = this.history.slice(-HISTORY_LIMIT);
        if (allowPrediction && this.authoritative && this.tick - this.lastReceiveTick <= PREDICTION_HORIZON) this.motion(motion);
    }
    reconcile(frame: DisplayFrame, capturedLocalTick: number) {
        if (this.authoritative && frame.tick <= this.authoritative.tick) return false;
        const before = this.actor ? copy(this.actor) : undefined;
        this.world.actors = frame.actors.map(copy);
        this.authoritative = frame; this.lastReceiveTick = this.tick;
        this.pending = this.pending.filter(seq => seq > frame.receipt.applied);
        const cut = Math.min(this.tick, Math.max(0, Math.round(capturedLocalTick)));
        // If the sample predates retained input, correct instead of inventing history.
        if (cut >= (this.history[0]?.tick ?? 1) - 1) {
            for (const sample of this.history) if (sample.tick > cut) this.motion(sample.input);
        }
        const a = this.actor!;
        this.correction = before ? Math.hypot(a.x - before.x, a.y - before.y, a.z - before.z) : 0;
        this.maxCorrection = Math.max(this.maxCorrection, this.correction);
        return true;
    }
}

export class RemoteInterpolator {
    private frames: { tick: number; actors: Actor[] }[] = [];
    get size() { return this.frames.length; }
    push(frame: DisplayFrame) {
        if (frame.tick <= (this.frames.at(-1)?.tick ?? -1)) return;
        this.frames.push({ tick: frame.tick, actors: frame.actors.map(copy) });
        this.frames = this.frames.slice(-32);
    }
    sample(estimatedTick: number): Actor[] {
        if (!this.frames.length) return [];
        const target = estimatedTick - INTERPOLATION_TICKS;
        const upper = this.frames.find(f => f.tick >= target) ?? this.frames.at(-1)!;
        const lower = [...this.frames].reverse().find(f => f.tick <= target) ?? this.frames[0];
        const t = upper.tick === lower.tick ? 0 : Math.max(0, Math.min(1, (target - lower.tick) / (upper.tick - lower.tick)));
        return upper.actors.map(a => {
            const b = lower.actors.find(b => b.id === a.id) ?? a;
            const angle = Math.atan2(Math.sin(a.aim - b.aim), Math.cos(a.aim - b.aim));
            return { ...copy(a), x: b.x + (a.x - b.x) * t, y: b.y + (a.y - b.y) * t,
                z: b.z + (a.z - b.z) * t, aim: b.aim + angle * t };
        });
    }
}
