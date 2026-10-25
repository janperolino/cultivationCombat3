import type { World, Actor, Cell, Effect } from './sim.ts';
import type { DisplayFrame } from './replication.ts';
import type { StudyScene } from './study-scene.ts';

// A display-only adapter. It never steps, casts, loads saves or mutates the host.
export class StudyState {
    readonly scene: StudyScene;
    terrainReset = false;
    private terrain: World;
    private tick = -1;
    private highestEffect = 0;
    private primed = false;
    private effects = new Map<number, Effect>();
    private cells?: Cell[];
    constructor(terrain: World) {
        this.terrain = terrain;
        this.scene = { actors: [], cells: terrain.cells, cellVersions: terrain.cellVersions, revision: -1, time: 0,
            cellAt: terrain.cellAt.bind(terrain), groundHeight: terrain.groundHeight.bind(terrain), bolts: [], waves: [], casts: [], effects: [] };
    }
    clear() { this.tick = -1; this.primed = false; this.highestEffect = 0; this.effects.clear(); this.cells = undefined; }
    receive(frame: DisplayFrame, actors: Actor[], cells: Cell[], revision: number) {
        this.terrainReset = false;
        if (this.cells !== cells || this.scene.revision !== revision) {
            let changed = false;
            for (let i = 0; i < cells.length; i++) {
                const a = this.cells?.[i], b = cells[i];
                if (!a || a.kind !== b.kind || a.hp !== b.hp || a.max !== b.max || a.depth !== b.depth || a.elevation !== b.elevation) {
                    this.terrain.cellVersions[i] = Math.max(0, revision); changed = true;
                }
            }
            this.terrainReset = !this.cells || (changed && revision === this.scene.revision);
            this.cells = cells; this.terrain.cells = cells; this.terrain.revision = revision;
            this.scene.cells = cells; this.scene.revision = revision;
        }
        this.scene.actors = actors.map(a => ({ ...a, cool: [...a.cool] }));
        if (frame.tick <= this.tick) return undefined;
        this.tick = frame.tick; this.scene.time = frame.time;
        this.scene.bolts = frame.bolts.map(b => ({ ...b })); this.scene.waves = frame.waves.map(w => ({ ...w })); this.scene.casts = frame.casts.map(c => ({ ...c }));
        const fresh: Effect[] = [], next = new Map<number, Effect>();
        for (const e of frame.effects) {
            const copy = this.effects.get(e.visualId) ?? { ...e }; Object.assign(copy, e); next.set(e.visualId, copy);
            if (this.primed && e.visualId > this.highestEffect) fresh.push(copy);
        }
        this.highestEffect = Math.max(this.highestEffect, ...frame.effects.map(e => e.visualId));
        this.effects = next; this.scene.effects = [...next.values()]; this.primed = true;
        return fresh;
    }
}
