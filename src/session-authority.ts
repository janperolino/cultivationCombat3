import { DT, SIZE, World } from './sim.ts';
import type { ActorInput } from './sim.ts';
import { LOCK_RANGE, targetInRange } from './targeting.ts';

export const STALE_INPUT_TICKS = 15;
export const MAX_COMMANDS_PER_TICK = 4;
export const MAX_SEQUENCE_GAP = 1024;
export const MAX_PENDING_ACTIONS = 16, ACTION_TTL_TICKS = 120;
export type ActionOutcome = { sequence: number; status: 'consumed' | 'expired' };
export type InputReceipt = { received: number; applied: number; actionReceived?: number; actionApplied?: number; outcomes?: ActionOutcome[] };

export type CommandResult = { accepted: true } | {
    accepted: false;
    reason: 'unknown-client' | 'invalid-command' | 'wrong-generation' | 'not-owner' | 'sequence' | 'rate-limit' | 'action-full' | 'action-conflict';
};
type Connection = {
    actorId: number;
    generation: number;
    sequence: number;
    appliedSequence: number;
    acceptedThisTick: number;
    receivedTick: number;
    input?: ActorInput;
    actions: { input: ActorInput; tick: number; sequence?: number; expiresTick?: number }[];
    actionReceived: number;
    actionApplied: number;
    outcomes: ActionOutcome[];
    actionPayloads: Map<number, string>;
};
type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
function keys(value: RecordValue, allowed: string[]) {
    return Object.keys(value).every(key => allowed.includes(key));
}
function finite(value: unknown, min: number, max: number): value is number {
    return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}
function id(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
// Intended for parsed JSON data. Copy only approved fields so later caller mutation
// cannot change accepted inputs. Message byte limits belong at the transport boundary.
function parseInput(value: unknown): ActorInput | undefined {
    if (!record(value) || !keys(value, ['move', 'aim', 'fire', 'dash', 'climb', 'autoAltitude'])) return;
    const { move, aim, fire, dash, climb, autoAltitude } = value;
    if (!record(move) || !keys(move, ['x', 'y']) || !finite(move.x, -1, 1) || !finite(move.y, -1, 1)) return;
    if (!record(aim) || !keys(aim, ['x', 'y', 'z', 'targetId', 'locked']) ||
        !finite(aim.x, -SIZE, SIZE * 2) || !finite(aim.y, -SIZE, SIZE * 2)) return;
    if (aim.z !== undefined && !finite(aim.z, -128, 128)) return;
    if (aim.targetId !== undefined && !id(aim.targetId)) return;
    if (aim.locked !== undefined && typeof aim.locked !== 'boolean') return;
    if (aim.locked && aim.targetId === undefined) return;
    if (fire !== undefined && fire !== 'bolt' && fire !== 'slash' && fire !== 'nova') return;
    if (dash !== undefined && typeof dash !== 'boolean') return;
    if (climb !== undefined && !finite(climb, -1, 1)) return;
    if (autoAltitude !== undefined && typeof autoAltitude !== 'boolean') return;
    return {
        move: { x: move.x, y: move.y },
        aim: { x: aim.x, y: aim.y, z: aim.z as number | undefined,
            targetId: aim.targetId as number | undefined, locked: aim.locked as boolean | undefined },
        fire, dash: dash as boolean | undefined, climb: climb as number | undefined,
        autoAltitude: autoAltitude as boolean | undefined,
    };
}

export class SessionAuthority {
    private readonly world: World;
    private readonly actorIds: readonly number[];
    private readonly connections = new Map<string, Connection>();
    private nextGeneration = 1;
    private currentTick = 0;

    constructor(world: World, actorIds: readonly number[]) {
        if (actorIds.length < 1 || actorIds.length > 2 || new Set(actorIds).size !== actorIds.length ||
            actorIds.some(actorId => !id(actorId) || world.actors.filter(a => a.id === actorId).length !== 1)) {
            throw new Error('Configure one or two unique existing actors');
        }
        this.actorIds = [...actorIds];
        this.world = world;
    }

    get tick() { return this.currentTick; }

    // Host-only API. clientId comes from the trusted adapter, never a command field.
    connect(clientId: string, actorId: number): number {
        if (typeof clientId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(clientId) ||
            this.connections.has(clientId) || !this.actorIds.includes(actorId) ||
            [...this.connections.values()].some(c => c.actorId === actorId)) {
            throw new Error('Invalid or occupied client/actor assignment');
        }
        if (!Number.isSafeInteger(this.nextGeneration)) throw new Error('Session generation exhausted');
        const generation = this.nextGeneration++;
        this.connections.set(clientId, { actorId, generation, sequence: 0, appliedSequence: 0, acceptedThisTick: 0, receivedTick: -STALE_INPUT_TICKS,
            actions: [], actionReceived: 0, actionApplied: 0, outcomes: [], actionPayloads: new Map() });
        return generation;
    }

    disconnect(clientId: string): boolean {
        return this.connections.delete(clientId);
    }

    receipt(clientId: string): InputReceipt {
        const c = this.connections.get(clientId);
        return { received: c?.sequence ?? 0, applied: c?.appliedSequence ?? 0,
            ...(c?.actionReceived ? { actionReceived: c.actionReceived, actionApplied: c.actionApplied, outcomes: structuredClone(c.outcomes) } : {}) };
    }

    submit(clientId: string, data: unknown): CommandResult {
        const c = this.connections.get(clientId);
        if (!c) return { accepted: false, reason: 'unknown-client' };
        if (!record(data) || !keys(data, ['generation', 'sequence', 'actorId', 'input']) ||
            !id(data.generation) || !id(data.sequence) || !id(data.actorId)) {
            return { accepted: false, reason: 'invalid-command' };
        }
        if (data.generation !== c.generation) return { accepted: false, reason: 'wrong-generation' };
        if (data.actorId !== c.actorId) return { accepted: false, reason: 'not-owner' };
        if (data.sequence <= c.sequence || data.sequence - c.sequence > MAX_SEQUENCE_GAP) {
            return { accepted: false, reason: 'sequence' };
        }
        if (c.acceptedThisTick >= MAX_COMMANDS_PER_TICK) return { accepted: false, reason: 'rate-limit' };
        const input = parseInput(data.input);
        if (!input) return { accepted: false, reason: 'invalid-command' };
        if (input.aim.targetId !== undefined && !this.target(c.actorId, input.aim.targetId)) {
            return { accepted: false, reason: 'invalid-command' };
        }
        if ((input.fire || input.dash) && c.actions.length >= MAX_PENDING_ACTIONS) return { accepted: false, reason: 'action-full' };
        // Compatibility commands preserve accepted one-shots even when newer motion coalesces.
        if (input.fire || input.dash) c.actions.push({ input: structuredClone(input), tick: this.currentTick });
        delete input.fire; delete input.dash;
        c.sequence = data.sequence;
        c.receivedTick = this.currentTick;
        c.acceptedThisTick++;
        c.input = input;
        return { accepted: true };
    }

    submitAction(clientId: string, data: unknown): CommandResult {
        const c = this.connections.get(clientId);
        if (!c) return { accepted: false, reason: 'unknown-client' };
        if (!record(data) || !keys(data, ['generation', 'sequence', 'actorId', 'input', 'expiresTick']) ||
            !id(data.generation) || !id(data.sequence) || data.sequence < 1 || !id(data.actorId)) return { accepted: false, reason: 'invalid-command' };
        if (data.generation !== c.generation) return { accepted: false, reason: 'wrong-generation' };
        if (data.actorId !== c.actorId) return { accepted: false, reason: 'not-owner' };
        const input = parseInput(data.input);
        if (!input || (!input.fire && !input.dash)) return { accepted: false, reason: 'invalid-command' };
        if (data.expiresTick !== undefined && (!id(data.expiresTick) || data.expiresTick > this.currentTick + ACTION_TTL_TICKS)) return { accepted: false, reason: 'invalid-command' };
        const payload = JSON.stringify({ input, expiresTick: data.expiresTick });
        if (data.sequence <= c.actionReceived) {
            if (c.actionPayloads.has(data.sequence) && c.actionPayloads.get(data.sequence) !== payload) return { accepted: false, reason: 'action-conflict' };
            return { accepted: true }; // Retried or old already-consumed ID never executes twice.
        }
        if (data.sequence !== c.actionReceived + 1) return { accepted: false, reason: 'sequence' };
        if (c.actions.length >= MAX_PENDING_ACTIONS) return { accepted: false, reason: 'action-full' };
        if (c.acceptedThisTick >= MAX_COMMANDS_PER_TICK) return { accepted: false, reason: 'rate-limit' };
        // Target hints can become invalid in flight; consume with coordinate fallback.
        c.actions.push({ input, tick: this.currentTick, sequence: data.sequence, expiresTick: data.expiresTick as number | undefined });
        c.actionReceived = data.sequence; c.actionPayloads.set(data.sequence, payload); c.acceptedThisTick++;
        while (c.actionPayloads.size > 32) c.actionPayloads.delete(c.actionPayloads.keys().next().value!);
        return { accepted: true };
    }

    private target(actorId: number, targetId: number) {
        const actor = this.world.actors.find(a => a.id === actorId);
        const target = this.world.actors.find(a => a.id === targetId);
        return actor && target && targetInRange(actor, target, LOCK_RANGE) ? target : undefined;
    }

    step(): void {
        const inputs = new Map<number, ActorInput>();
        for (const actorId of this.actorIds) {
            const actor = this.world.actors.find(a => a.id === actorId);
            if (!actor) throw new Error('Controlled actor removed; recreate the authority for a new world');
            // Idle actors remain present in stepPlayers, suppressing AI takeover.
            inputs.set(actorId, { move: { x: 0, y: 0 }, aim: {
                x: actor.x + Math.cos(actor.aim), y: actor.y + Math.sin(actor.aim),
            } });
        }
        for (const c of this.connections.values()) {
            if (c.input && this.currentTick - c.receivedTick < STALE_INPUT_TICKS) {
                const aim = { ...c.input.aim };
                if (aim.targetId !== undefined) {
                    const target = this.target(c.actorId, aim.targetId);
                    if (target) { aim.x = target.x; aim.y = target.y; aim.z = target.z + .7; }
                    else { delete aim.targetId; delete aim.locked; }
                }
                inputs.set(c.actorId, { ...c.input, aim });
            }
            const action = c.actions.shift();
            if (action) {
                const expired = this.currentTick - action.tick >= ACTION_TTL_TICKS ||
                    (action.expiresTick !== undefined && this.currentTick >= action.expiresTick);
                if (!expired) {
                    const aim = { ...action.input.aim };
                    if (aim.targetId !== undefined) {
                        const target = this.target(c.actorId, aim.targetId);
                        if (target) { aim.x = target.x; aim.y = target.y; aim.z = target.z + .7; }
                        else { delete aim.targetId; delete aim.locked; }
                    }
                    inputs.set(c.actorId, { ...inputs.get(c.actorId)!, aim, fire: action.input.fire, dash: action.input.dash,
                        ...(action.input.dash ? { move: { ...action.input.move } } : {}) });
                }
                if (action.sequence !== undefined) {
                    c.actionApplied = action.sequence;
                    c.outcomes.push({ sequence: action.sequence, status: expired ? 'expired' : 'consumed' });
                    c.outcomes = c.outcomes.slice(-32);
                }
            }
        }
        this.world.stepPlayers(inputs, DT);
        this.currentTick++;
        for (const c of this.connections.values()) {
            c.acceptedThisTick = 0;
            if (c.input && this.currentTick - 1 - c.receivedTick < STALE_INPUT_TICKS) c.appliedSequence = c.sequence;
            if (c.input) { delete c.input.fire; delete c.input.dash; }
        }
    }
}
