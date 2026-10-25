import { GRID } from './sim.ts';
import type { Actor, Cell, World } from './sim.ts';
import type { InputReceipt } from './session-authority.ts';

export const PROTOCOL_VERSION = 3, TERRAIN_SCHEMA = 'height-field-v2';
export const CELLS_PER_PAGE = 1024, MAX_PACKET_BYTES = 64 * 1024;
export type CellRow = [number, number, number, number, number, number];
export type DisplayFrame = {
    tick: number; time: number; revision: number; destroyed: number; droppedTime: number;
    actors: Actor[];
    bolts: { x: number; y: number; z: number; owner: number; launched: boolean }[];
    waves: { x: number; y: number; z: number; owner: number; span: number; angle: number }[];
    casts: { x: number; y: number; z: number; owner: number; radius: number; left: number }[];
    receipt: InputReceipt;
};
export type SyncRequest = {
    protocol: number; schema: string; sessionId: string; syncId: number; ack: number;
};
export type StatePage = SyncRequest & {
    sequence: number; kind: 'snapshot' | 'delta'; baseRevision: number; revision: number;
    offset: number; total: number; final: boolean; cells: CellRow[]; state?: DisplayFrame;
};
type Transfer = {
    kind: 'snapshot' | 'delta'; baseRevision: number; revision: number;
    cells: CellRow[]; offset: number; state: DisplayFrame;
};
const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
export function captureDisplayFrame(world: World, tick: number, receipt: DisplayFrame['receipt'], droppedTime = 0): DisplayFrame {
    return structuredClone({ tick, time: world.time, revision: world.revision, destroyed: world.destroyed,
        actors: world.actors, receipt, droppedTime,
        bolts: world.bolts.map(b => ({ x: b.x, y: b.y, z: b.z, owner: b.owner, launched: b.launched })),
        waves: world.waves.map(b => ({ x: b.x, y: b.y, z: b.z, owner: b.owner, span: b.span, angle: b.angle })),
        casts: world.casts.map(c => ({ x: c.x, y: c.y, z: c.z, owner: c.owner, radius: c.radius, left: c.left })),
    });
}
export function validateDisplayFrame(s: DisplayFrame, previous?: DisplayFrame): void {
    if (!s || !integer(s.tick) || s.tick < (previous?.tick ?? 0) || !integer(s.revision) ||
        !finite(s.time) || !finite(s.droppedTime) || !integer(s.destroyed) ||
        !s.receipt || !integer(s.receipt.received) || !integer(s.receipt.applied) || s.receipt.applied > s.receipt.received ||
        s.receipt.received < (previous?.receipt.received ?? 0) || s.receipt.applied < (previous?.receipt.applied ?? 0) ||
        ((previous?.receipt.actionReceived ?? 0) > 0 && s.receipt.actionReceived === undefined) ||
        (s.receipt.actionReceived !== undefined && (!integer(s.receipt.actionReceived) || !integer(s.receipt.actionApplied) ||
            s.receipt.actionApplied > s.receipt.actionReceived || s.receipt.actionReceived < (previous?.receipt.actionReceived ?? 0) ||
            s.receipt.actionApplied < (previous?.receipt.actionApplied ?? 0) || !Array.isArray(s.receipt.outcomes) || s.receipt.outcomes.length > 32 ||
            s.receipt.outcomes.some(o => !integer(o.sequence) || o.sequence > s.receipt.actionApplied! || !['consumed', 'expired'].includes(o.status)))) ||
        !Array.isArray(s.actors) || s.actors.length < 2 || s.actors.length > 3 || new Set(s.actors.map(a => a.id)).size !== s.actors.length ||
        !s.actors.some(a => a.id === 0) || !s.actors.some(a => a.id === 1) ||
        s.actors.some(a => ![0, 1, 2].includes(a.id) || (a.team !== undefined && !integer(a.team)) || ![a.x, a.y, a.z, a.hp, a.qi, a.dashLeft, a.vx, a.vy, a.vz, a.aim, a.dashX, a.dashY, a.realm].every(finite) || !Array.isArray(a.cool)) ||
        ![s.bolts, s.waves, s.casts].every(a => Array.isArray(a) && a.length <= 512 &&
            a.every(b => [b.x, b.y, b.z].every(finite) && s.actors.some(a => a.id === b.owner))) ||
        s.bolts.some(b => typeof b.launched !== 'boolean') ||
        s.waves.some(b => ![b.span, b.angle].every(finite) || b.span < 0) ||
        s.casts.some(c => ![c.radius, c.left].every(finite) || c.radius < 0)) throw new Error('Invalid state frame');
}
export function serializePage(page: StatePage): string {
    const data = JSON.stringify(page);
    if (new TextEncoder().encode(data).length > MAX_PACKET_BYTES) throw new Error('Replication packet budget exceeded');
    return data;
}

// One stop-and-wait stream per authenticated connection. Capture values, not World
// references: a retry and every page of a transfer must describe the same revision.
export class ReplicationStream {
    private syncId = 0;
    private sequence = 0;
    private knownRevision = -1;
    private pending?: StatePage;
    private transfer?: Transfer;
    private readonly world: World;
    private readonly sessionId: string;
    private readonly capture: () => DisplayFrame;

    constructor(world: World, sessionId: string, capture: () => DisplayFrame) {
        this.world = world; this.sessionId = sessionId; this.capture = capture;
    }

    reply(request: SyncRequest): StatePage {
        if (!request || request.protocol !== PROTOCOL_VERSION || request.schema !== TERRAIN_SCHEMA ||
            request.sessionId !== this.sessionId || !integer(request.syncId) || request.syncId < 1 || !integer(request.ack) ||
            Object.keys(request).some(k => !['protocol', 'schema', 'sessionId', 'syncId', 'ack'].includes(k))) {
            throw new Error('Incompatible replication request');
        }
        if (request.syncId < this.syncId) throw new Error('Old sync generation');
        if (request.syncId > this.syncId) {
            if (request.ack !== 0) throw new Error('New sync must start at acknowledgment zero');
            this.syncId = request.syncId; this.sequence = 0; this.knownRevision = -1;
            this.pending = undefined; this.transfer = undefined;
        }
        if (this.pending) {
            if (request.ack === this.pending.sequence - 1) return structuredClone(this.pending);
            if (request.ack !== this.pending.sequence) throw new Error('Acknowledgment gap');
            this.transfer!.offset += this.pending.cells.length;
            if (this.pending.final) { this.knownRevision = this.pending.revision; this.transfer = undefined; }
            this.pending = undefined;
        } else if (request.ack !== this.sequence) throw new Error('Acknowledgment gap');

        if (!this.transfer) {
            const cells: CellRow[] = [];
            this.world.cells.forEach((c, i) => {
                if (this.knownRevision < 0 || this.world.cellVersions[i] > this.knownRevision) {
                    cells.push([i, c.kind, c.hp, c.max, c.depth, c.elevation]);
                }
            });
            this.transfer = { kind: this.knownRevision < 0 ? 'snapshot' : 'delta',
                baseRevision: this.knownRevision, revision: this.world.revision,
                cells, offset: 0, state: structuredClone(this.capture()) };
        }
        const t = this.transfer;
        let count = Math.min(CELLS_PER_PAGE, t.cells.length - t.offset), page: StatePage;
        for (;;) {
            const cells = t.cells.slice(t.offset, t.offset + count), final = t.offset + cells.length === t.cells.length;
            page = { protocol: PROTOCOL_VERSION, schema: TERRAIN_SCHEMA, sessionId: this.sessionId,
                syncId: this.syncId, ack: request.ack, sequence: this.sequence + 1,
                kind: t.kind, baseRevision: t.baseRevision, revision: t.revision,
                offset: t.offset, total: t.cells.length, final, cells, ...(final ? { state: t.state } : {}) };
            try { serializePage(page); break; } catch (error) {
                if (count <= 1) throw error;
                count = Math.floor(count / 2);
            }
        }
        this.sequence++;
        this.pending = page;
        return structuredClone(page);
    }
}

// The display commits only completed transfers. A missing/out-of-order/corrupt
// page cannot partly alter terrain or roll actors back; the caller requests reset.
export class ReplicaClient {
    private readonly sessionId: string;
    private syncId = 1;
    private ack = 0;
    private staged?: { kind: string; revision: number; baseRevision: number; total: number; rows: CellRow[] };
    cells: Cell[] = [];
    state?: DisplayFrame;
    revision = -1;
    constructor(sessionId: string) { this.sessionId = sessionId; }
    request(): SyncRequest {
        return { protocol: PROTOCOL_VERSION, schema: TERRAIN_SCHEMA, sessionId: this.sessionId, syncId: this.syncId, ack: this.ack };
    }
    get syncing() { return this.ack === 0 || !!this.staged; }
    get ready() { return this.ack > 0 && this.revision >= 0 && this.staged?.kind !== 'snapshot'; }
    get progress() { return this.staged ? `${this.staged.rows.length}/${this.staged.total}` : ''; }
    reset(): void { this.syncId++; this.ack = 0; this.staged = undefined; }

    apply(page: StatePage): 'partial' | 'committed' | 'ignored' {
        if (page?.sessionId !== this.sessionId || page.protocol !== PROTOCOL_VERSION || page.schema !== TERRAIN_SCHEMA) throw new Error('Replication version/session mismatch');
        if (integer(page.syncId) && page.syncId < this.syncId) return 'ignored';
        if (page.syncId !== this.syncId || !integer(page.sequence)) throw new Error('Replication sync mismatch');
        if (page.sequence <= this.ack) return 'ignored';
        if (page.sequence !== this.ack + 1 || page.ack !== this.ack) throw new Error('Replication sequence gap');
        if (!integer(page.revision) || page.revision < this.revision || !integer(page.offset) || !integer(page.total) || page.total > GRID * GRID ||
            !Array.isArray(page.cells) || page.cells.length > CELLS_PER_PAGE || typeof page.final !== 'boolean' ||
            !['snapshot', 'delta'].includes(page.kind)) throw new Error('Invalid terrain page');
        serializePage(page);
        const previous = this.staged;
        if (!previous) {
            if (page.offset !== 0 || (page.kind === 'snapshot' ? page.baseRevision !== -1 || page.total !== GRID * GRID :
                this.revision < 0 || page.baseRevision !== this.revision || page.revision < this.revision)) {
                throw new Error('Terrain revision gap');
            }
        } else if (page.kind !== previous.kind || page.revision !== previous.revision ||
            page.baseRevision !== previous.baseRevision || page.total !== previous.total || page.offset !== previous.rows.length) {
            throw new Error('Terrain transfer gap');
        }
        const rows = [...(previous?.rows ?? [])];
        for (const row of page.cells) {
            if (!Array.isArray(row) || row.length !== 6 || !integer(row[0]) || row[0] >= GRID * GRID ||
                row[0] <= (rows.at(-1)?.[0] ?? -1) || ![0, 1, 2].includes(row[1]) ||
                !row.slice(2).every(finite) || row[2] < 0 || row[3] < row[2] || row[4] < 0 || row[4] > 12) {
                throw new Error('Invalid terrain cell');
            }
            if (page.kind === 'snapshot' && row[0] !== rows.length) throw new Error('Incomplete snapshot');
            rows.push([...row] as CellRow);
        }
        if (rows.length > page.total || page.final !== (rows.length === page.total) ||
            (!page.final && (!page.cells.length || page.state !== undefined))) throw new Error('Invalid transfer boundary');
        if (page.final) {
            const s = page.state!;
            validateDisplayFrame(s!, this.state);
            if (s!.revision !== page.revision) throw new Error('State/terrain revision mismatch');
            const cells = page.kind === 'snapshot' ? new Array<Cell>(GRID * GRID) : this.cells.slice();
            for (const [i, kind, hp, max, depth, elevation] of rows) cells[i] = { kind, hp, max, depth, elevation };
            this.cells = cells; this.state = structuredClone(s); this.revision = page.revision; this.staged = undefined;
        } else this.staged = { kind: page.kind, revision: page.revision, baseRevision: page.baseRevision, total: page.total, rows };
        this.ack = page.sequence;
        return page.final ? 'committed' : 'partial';
    }
}
