import { fileURLToPath } from 'node:url';
import { World, DT } from '../src/sim.ts';
import { SessionAuthority } from '../src/session-authority.ts';
import { ReplicationStream, ReplicaClient, captureDisplayFrame, serializePage } from '../src/replication.ts';
import { MotionPredictor, RemoteInterpolator } from '../src/client-motion.ts';
import { NetworkLab, NETWORK_PROFILES } from '../src/network-lab.ts';

export function benchmark(profile, ticks = 2700) {
    const world = new World(), authority = new SessionAuthority(world, [0, 1]);
    world.cells.forEach(c => Object.assign(c, { kind: 0, hp: 0, max: 0, elevation: 0, depth: 0 }));
    Object.assign(world.actors[0], { x: 100, y: 100, z: 10 });
    Object.assign(world.actors[1], { x: 400, y: 400, z: 10 });
    const clients = [0, 1].map(id => {
        const name = `client${id}`, generation = authority.connect(name, id), replica = new ReplicaClient('lab');
        const capture = () => captureDisplayFrame(world, authority.tick, authority.receipt(name));
        const stream = new ReplicationStream(world, 'lab', capture), predictor = new MotionPredictor(id), remote = new RemoteInterpolator();
        // Warm join separately; impair ongoing traffic, not 64-page initial loading.
        for (let i = 0; i < 64; i++) replica.apply(stream.reply(replica.request()));
        predictor.setTerrain(replica.cells); predictor.reconcile(capture(), 0);
        return { id, name, generation, replica, stream, predictor, remote, capture,
            lab: new NetworkLab(profile, 0x534800 + id), sequence: 0, commands: 0, live: 0, sync: false, frameTick: 0, terrainCaughtUpTick: 0 };
    });
    const queue = [], errors = [], corrections = [];
    let bytes = 0, maxAge = 0, accepted = 0, rejected = 0, rttSum = 0, transactionCount = 0;
    function schedule(time, type, run) { queue.push({ time, type, run }); }
    const delayTicks = ms => Math.ceil(ms / (DT * 1000));
    function transaction(c, tick, type, action, receive) {
        const f = c.lab.next(), up = delayTicks(f.up), down = delayTicks(f.down);
        rttSum += (up + down) * DT * 1000; transactionCount++;
        if (f.dropRequest) { schedule(tick + up + down, 'down', () => receive(undefined)); return; }
        schedule(tick + up, type, () => {
            const payload = action();
            if (payload) bytes += Buffer.byteLength(JSON.stringify(payload));
            schedule(tick + up + down, 'down', () => receive(f.dropResponse ? undefined : payload));
        });
    }
    function deliver(tick, commandsOnly) {
        for (;;) {
            const index = queue.findIndex(e => e.time <= tick && (commandsOnly ? e.type === 'command' : e.type !== 'command'));
            if (index < 0) return;
            queue.splice(index, 1)[0].run();
        }
    }
    for (let tick = 1; tick <= ticks; tick++) {
        if (tick === 900) world.terrain({ x: 256, y: 256 }, 600, 300); // Whole-world delta under impairment.
        for (const c of clients) {
            const moving = tick <= 1200, direction = Math.floor((tick - 1) / 180) % 2 ? -1 : 1;
            const input = { move: { x: moving && c.id === 0 ? direction : 0, y: moving && c.id === 1 ? -direction : 0 },
                aim: { x: 256, y: 256 }, climb: moving && tick % 240 < 60 ? 1 : 0 };
            c.predictor.advance(input);
            if (tick % 2 === 0 && c.commands < 6) {
                c.commands++;
                const command = { generation: c.generation, sequence: ++c.sequence, actorId: c.id, input };
                c.predictor.noteCommand(command.sequence); bytes += Buffer.byteLength(JSON.stringify(command));
                transaction(c, tick, 'command', () => {
                    const result = authority.submit(c.name, command);
                    if (result.accepted) accepted++; else rejected++;
                    return result;
                }, () => { c.commands--; });
            }
            if (tick % 3 === 0 && c.live < 3) {
                c.live++;
                transaction(c, tick, 'capture', c.capture, frame => {
                    c.live--;
                    if (!frame || frame.tick <= c.frameTick) return;
                    c.frameTick = frame.tick;
                    const halfRttTicks = (c.predictor.tick - tick) / 2;
                    c.predictor.reconcile(frame, c.predictor.tick - Math.round(halfRttTicks), halfRttTicks);
                    c.remote.push(frame); corrections.push(c.predictor.correction);
                });
            }
            const pageCadence = tick % 3 === 0 || tick % 3 === 2; // 40 Hz quantized onto 60 Hz ticks.
            if (!c.sync && (tick % 6 === 0 || (c.replica.syncing && pageCadence))) {
                c.sync = true; const request = c.replica.request();
                transaction(c, tick, 'capture', () => c.stream.reply(request), page => {
                    c.sync = false;
                    if (page) {
                        serializePage(page); c.replica.apply(page); c.predictor.setTerrain(c.replica.cells);
                        if (!c.terrainCaughtUpTick && world.revision > 0 && c.replica.revision === world.revision) c.terrainCaughtUpTick = c.predictor.tick;
                    }
                });
            }
        }
        deliver(tick, true); authority.step(); deliver(tick, false);
        for (const c of clients) {
            const a = c.predictor.actor, b = world.actors[c.id];
            if (tick <= 1200) errors.push(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z));
            maxAge = Math.max(maxAge, (tick - c.frameTick) * DT * 1000);
            c.remote.sample(tick);
        }
    }
    const terrainEqualUnderImpairment = clients.every(c => JSON.stringify(c.replica.cells) === JSON.stringify(world.cells));
    // Drain terrain through the actual stream without impairments, verifying eventual recovery.
    for (const c of clients) {
        for (let page = 0; page < 130; page++) {
            const data = c.stream.reply(c.replica.request()); c.replica.apply(data);
            if (c.replica.revision === world.revision && data.final) break;
        }
    }
    errors.sort((a, b) => a - b);
    const finalError = Math.max(...clients.map(c => Math.hypot(c.predictor.actor.x - world.actors[c.id].x,
        c.predictor.actor.y - world.actors[c.id].y, c.predictor.actor.z - world.actors[c.id].z)));
    const round = n => Math.round(n * 1000) / 1000;
    return { profile, target: NETWORK_PROFILES[profile], durationSeconds: ticks * DT, activeMovementSeconds: 20,
        meanErrorM: round(errors.reduce((a, b) => a + b, 0) / errors.length), p95ErrorM: round(errors[Math.floor(errors.length * .95)]),
        maxErrorM: round(errors.at(-1)), maxCorrectionM: round(Math.max(0, ...corrections)),
        maxStateAgeMs: round(maxAge), jsonBytes: bytes, accepted, reorderedRejected: rejected,
        effectiveMeanRttMs: round(rttSum / transactionCount), terrainEqualUnderImpairment,
        wholeWorldDeltaCatchupSeconds: clients.every(c => c.terrainCaughtUpTick) ? round((Math.max(...clients.map(c => c.terrainCaughtUpTick)) - 900) * DT) : null,
        attemptedTransactions: clients.reduce((n, c) => n + c.lab.requests, 0),
        droppedTransactions: clients.reduce((n, c) => n + c.lab.dropped, 0), finalErrorM: round(finalError),
        terrainEqual: clients.every(c => JSON.stringify(c.replica.cells) === JSON.stringify(world.cells)),
        sharedClock: world.timeScale === 1 && world.sceneTime === world.time,
        historyBounded: clients.every(c => c.predictor.historySize <= 120 && c.remote.size <= 32),
    };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    console.log(JSON.stringify({ seed: '0x534800 + client ID', warmJoin: true, impairedTerrainDrainFollowedByReliableRecovery: true,
        scenarios: Object.keys(NETWORK_PROFILES).map(profile => benchmark(profile)) }, null, 2));
}
