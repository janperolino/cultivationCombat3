import { test } from 'node:test';
import assert from 'node:assert/strict';
import { benchmark } from '../scripts/network-benchmark.mjs';

test('seeded two-client 50–150 ms RTT scenarios converge with bounded history, shared clocks and identical terrain', () => {
    for (const profile of ['local', 'mild', 'typical', 'harsh']) {
        const result = benchmark(profile);
        assert.equal(result.finalErrorM, 0, profile);
        assert.equal(result.terrainEqual, true, profile);
        assert.equal(result.terrainEqualUnderImpairment, true, profile);
        assert.equal(result.sharedClock, true, profile);
        assert.equal(result.historyBounded, true, profile);
        // Regression envelope for this deterministic clear-arena workload, not universal budgets.
        const p95Budget = profile === 'harsh' ? 2 : 1;
        assert.ok(result.p95ErrorM <= p95Budget, JSON.stringify(result));
        assert.ok(result.maxCorrectionM <= 3 && result.maxStateAgeMs <= 400, profile);
        assert.ok(result.wholeWorldDeltaCatchupSeconds <= 5, profile);
        if (profile !== 'local') assert.ok(result.droppedTransactions > 0);
    }
});
