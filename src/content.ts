// Host-owned content, independent of mutable actors and protocol actor IDs.
export type TechniqueId = 'bolt' | 'slash' | 'nova';
export type LoadoutDefinition = Readonly<{ id: string; name: string; slots: readonly [TechniqueId, TechniqueId | null, TechniqueId | null] }>;
export const VOLLEY_LOADOUT = 'seeking-volley', CRESCENT_LOADOUT = 'sweeping-crescent';
// Also validates the bounded display copies received by a client. These copies
// describe controls; only the host catalog governs equipped techniques.
export function validateLoadout(raw: unknown): LoadoutDefinition {
    const l = raw as LoadoutDefinition;
    const supported = (v: unknown) => v === 'bolt' || v === 'slash' || v === 'nova';
    if (!l || typeof l !== 'object' || Array.isArray(l) || typeof l.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(l.id) ||
        typeof l.name !== 'string' || l.name.length > 40 || !l.name.trim() || /[\x00-\x1f\x7f]/.test(l.name) ||
        !Array.isArray(l.slots) || l.slots.length !== 3 || !supported(l.slots[0]) || l.slots.some(s => s !== null && !supported(s)) ||
        l.slots.filter(s => s !== null).length < 2 || new Set(l.slots.filter(s => s !== null)).size !== l.slots.filter(s => s !== null).length) {
        throw new Error('Invalid content: loadout id/name/slots (three slots, unique known techniques, primary required)');
    }
    return Object.freeze({ id: l.id, name: l.name, slots: Object.freeze([...l.slots]) as LoadoutDefinition['slots'] });
}
export type TechniqueDefinition = Readonly<{ id: TechniqueId; behavior: TechniqueId; cost: number; cooldown: number; powerScale: number }>;
export type EnemyDefinition = Readonly<{ id: string; behavior: 'stationary' | 'skirmisher'; hp: number; ward: number; realm: number; team: number;
    combat?: Readonly<{ perception: number; range: number; speed: number; windup: number; recovery: number; technique: TechniqueId }> }>;
export const MAX_ENEMIES = 6, MAX_ACTORS = MAX_ENEMIES + 2;
export type EncounterRules = Readonly<{ leash: number; disengage: number; returnTimeout: number; reviveRange: number; reviveSeconds: number }>;
export type EncounterDefinition = Readonly<{ id: string; playerTeam: number; playerLoadouts?: readonly [string, string]; rules?: EncounterRules; spawns: readonly Readonly<{ enemyId: string; count: number; x: number; y: number; altitude: number }>[] }>;
export type Content = Readonly<{ techniques: readonly TechniqueDefinition[]; loadouts: readonly LoadoutDefinition[]; enemies: readonly EnemyDefinition[]; encounters: readonly EncounterDefinition[] }>;

export const BASELINE_ENCOUNTER = 'sentinel-arena', SKIRMISH_ENCOUNTER = 'skirmish-arena';
export const DEFAULT_CONTENT: Content = validateContent({
    techniques: [
        { id: 'bolt', behavior: 'bolt', cost: 9, cooldown: .95, powerScale: 1 },
        { id: 'slash', behavior: 'slash', cost: 16, cooldown: .65, powerScale: 1 },
        { id: 'nova', behavior: 'nova', cost: 38, cooldown: 3.2, powerScale: 1 },
    ],
    loadouts: [
        { id: VOLLEY_LOADOUT, name: 'Seeking volley', slots: ['bolt', null, 'nova'] },
        { id: CRESCENT_LOADOUT, name: 'Sweeping crescent', slots: ['slash', null, 'nova'] },
    ],
    enemies: [{ id: 'sentinel', behavior: 'stationary', hp: 3000, ward: 0, realm: 1, team: 2 },
        { id: 'ruin-skirmisher', behavior: 'skirmisher', hp: 400, ward: 0, realm: 1, team: 2,
            combat: { perception: 150, range: 42, speed: 12, windup: 1.1, recovery: 2.4, technique: 'slash' } }],
    encounters: [{ id: BASELINE_ENCOUNTER, playerTeam: 1, spawns: [{ enemyId: 'sentinel', count: 1, x: 256, y: 256, altitude: 3 }] },
        { id: SKIRMISH_ENCOUNTER, playerTeam: 1, playerLoadouts: [VOLLEY_LOADOUT, CRESCENT_LOADOUT], rules: { leash: 120, disengage: 3, returnTimeout: 8, reviveRange: 4, reviveSeconds: 2 }, spawns: [
            { enemyId: 'ruin-skirmisher', count: 1, x: 310, y: 240, altitude: 8 },
            { enemyId: 'ruin-skirmisher', count: 1, x: 314, y: 268, altitude: 12 },
            { enemyId: 'ruin-skirmisher', count: 1, x: 300, y: 292, altitude: 6 },
        ] }],
});

// Validate and copy the entire catalog before exposing it to a World. Frozen copies
// prevent caller edits (including nested spawn edits) from changing live tuning.
export function validateContent(raw: unknown): Content {
    function fail(path: string): never { throw new Error(`Invalid content: ${path}`); }
    function object(value: unknown, path: string): Record<string, unknown> {
        if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(path);
        return value as Record<string, unknown>;
    }
    function num(value: unknown, min: number, max: number, path: string, integer = false): number {
        if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) fail(path);
        return value as number;
    }
    function id(value: unknown, path: string): string {
        if (typeof value !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(value)) fail(path);
        return value as string;
    }
    const root = object(raw, 'catalog');
    function rows(key: string): Record<string, unknown>[] {
        const value = root[key];
        if (!Array.isArray(value) || value.length < 1 || value.length > 32) fail(`${key} count (1..32)`);
        const seen = new Set<string>();
        return (value as unknown[]).map((v, i) => {
            const row = object(v, `${key}[${i}]`), name = id(row.id, `${key}[${i}].id`);
            if (seen.has(name)) fail(`${key}: duplicate id ${name}`);
            seen.add(name); return row;
        });
    }
    const techniques = rows('techniques').map(t => {
        if (!['bolt', 'slash', 'nova'].includes(t.id as string) || t.behavior !== t.id) fail(`technique ${t.id}: unsupported behavior/id`);
        return Object.freeze({ id: t.id as TechniqueId, behavior: t.behavior as TechniqueId,
            cost: num(t.cost, 0, 100, `${t.id}.cost`), cooldown: num(t.cooldown, .01, 60, `${t.id}.cooldown`), powerScale: num(t.powerScale, .01, 10, `${t.id}.powerScale`) });
    });
    if (techniques.length !== 3) fail('techniques: require bolt, slash and nova');
    const loadouts = rows('loadouts').map(validateLoadout);
    const enemies = rows('enemies').map(e => {
        if (!['stationary', 'skirmisher'].includes(e.behavior as string)) fail(`${e.id}: unsupported enemy behavior`);
        let combat: EnemyDefinition['combat'];
        if (e.behavior === 'skirmisher') {
            const c = object(e.combat, `${e.id}.combat`);
            if (!techniques.some(t => t.id === c.technique)) fail(`${e.id}.technique: missing technique`);
            const perception = num(c.perception, 10, 220, `${e.id}.perception`);
            combat = Object.freeze({ perception, range: num(c.range, 4, perception, `${e.id}.range`),
                speed: num(c.speed, 1, 30, `${e.id}.speed`), windup: num(c.windup, .4, 5, `${e.id}.windup`),
                recovery: num(c.recovery, .4, 10, `${e.id}.recovery`), technique: c.technique as TechniqueId });
        } else if (e.combat !== undefined) fail(`${e.id}: stationary enemy cannot attack`);
        return Object.freeze({ id: e.id as string, behavior: e.behavior as EnemyDefinition['behavior'], combat, hp: num(e.hp, 1, 100000, `${e.id}.hp`),
            ward: num(e.ward, 0, 100, `${e.id}.ward`), realm: num(e.realm, 0, 3, `${e.id}.realm`, true), team: num(e.team, 1, 16, `${e.id}.team`, true) });
    });
    const encounters = rows('encounters').map(e => {
        const playerTeam = num(e.playerTeam, 1, 16, `${e.id}.playerTeam`, true);
        let playerLoadouts: EncounterDefinition['playerLoadouts'];
        if (e.playerLoadouts !== undefined) {
            if (!Array.isArray(e.playerLoadouts) || e.playerLoadouts.length !== 2 ||
                e.playerLoadouts.some(v => !loadouts.some(l => l.id === v))) fail(`${e.id}.playerLoadouts: require two existing presets`);
            playerLoadouts = Object.freeze([...e.playerLoadouts]) as readonly [string, string];
        }
        let rules: EncounterRules | undefined;
        if (e.rules !== undefined) {
            const r = object(e.rules, `${e.id}.rules`);
            rules = Object.freeze({ leash: num(r.leash, 40, 220, `${e.id}.leash`), disengage: num(r.disengage, 1, 10, `${e.id}.disengage`),
                returnTimeout: num(r.returnTimeout, 1, 15, `${e.id}.returnTimeout`), reviveRange: num(r.reviveRange, 2, 8, `${e.id}.reviveRange`),
                reviveSeconds: num(r.reviveSeconds, 1, 5, `${e.id}.reviveSeconds`) });
        }
        // Shared with the bounded replication roster.
        if (!Array.isArray(e.spawns) || e.spawns.length < 1 || e.spawns.length > MAX_ENEMIES) fail(`${e.id}.spawns: require 1..6 spawns`);
        const spawns = e.spawns.map((v: unknown) => {
            const s = object(v, `${e.id}.spawn`), enemyId = id(s.enemyId, `${e.id}.enemyId`);
            const enemy = enemies.find(enemy => enemy.id === enemyId);
            if (!enemy) fail(`${e.id}: missing enemy ${enemyId}`);
            if (enemy.team === playerTeam) fail(`${e.id}: enemy team equals player team`);
            return Object.freeze({ enemyId, count: num(s.count, 1, MAX_ENEMIES, `${e.id}.count`, true), x: num(s.x, 1, 511, `${e.id}.x`),
                y: num(s.y, 1, 511, `${e.id}.y`), altitude: num(s.altitude, 0, 60, `${e.id}.altitude`) });
        });
        if (spawns.reduce((n, s) => n + s.count, 0) > MAX_ENEMIES) fail(`${e.id}: total enemy count exceeds six`);
        for (const s of spawns) if (s.x + (s.count - 1) * 4 > 511) fail(`${e.id}: spawn formation outside arena`);
        return Object.freeze({ id: e.id as string, playerTeam, playerLoadouts, rules, spawns: Object.freeze(spawns) });
    });
    return Object.freeze({ techniques: Object.freeze(techniques), loadouts: Object.freeze(loadouts), enemies: Object.freeze(enemies), encounters: Object.freeze(encounters) });
}
