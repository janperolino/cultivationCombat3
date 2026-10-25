import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DepthScene } from '../src/depth-scene.ts';
import { HeightTerrain } from '../src/height-terrain.ts';
import { World } from '../src/sim.ts';

test('static scenery caches survive unchanged revisions, invalidate damage and release offscreen rasters', () => {
    const previous = globalThis.document;
    let created = 0, draws = 0;
    const transform = { a: 1, b: 0, c: 0, d: 1, e: 100, f: 100 };
    const context = (canvas: object) => new Proxy({ canvas, getTransform: () => transform,
        createLinearGradient: () => ({ addColorStop() {} }), drawImage() { draws++; } }, {
        get(target, key) { return key in target ? target[key] : () => {}; },
    });
    globalThis.document = { createElement() { created++; const canvas = { width: 0, height: 0, getContext() { return context(canvas); } }; return canvas; } };
    try {
        const world = new World(), scene = new DepthScene(true);
        const ctx = context({ width: 1024, height: 1024 });
        const draw = () => scene.draw(ctx, world, [], { x: 256, y: 256 }, 1, 1024, 1024);
        draw(); const initial = created; assert.ok(initial > 6);
        draws = 0; draw(); assert.equal(created, initial); assert.ok(draws > 0);
        world.revision++; draw(); assert.equal(created, initial, 'unrelated terrain revision reuses unchanged scenery');
        const cell = world.cells.find(c => c.hp > 0)!; cell.hp = 0; world.revision++;
        draw(); assert.ok(created > initial, 'destroyed cover invalidates its cached band');
        const damaged = created; transform.e = transform.f = 100000; draws = 0; draw();
        assert.equal(draws, 0, 'offscreen bands are neither painted nor drawn');
        transform.e = transform.f = 100; draw(); assert.ok(created > damaged, 'returning bands rebuild released rasters');
    } finally { globalThis.document = previous; }
});

test('terrain culling skips offscreen paint and preserves mutation checks on returning patches', () => {
    const previous = globalThis.document;
    let paints = 0, draws = 0;
    const transform = { a: 6, b: 0, c: 0, d: 6, e: -1200, f: -1200 };
    const context = (canvas: object) => new Proxy({ canvas, getTransform: () => transform,
        drawImage() { draws++; }, clearRect() { paints++; } }, { get(target, key) { return key in target ? target[key] : () => {}; } });
    globalThis.document = { createElement() { const canvas = { width: 0, height: 0, getContext() { return context(canvas); } }; return canvas; } };
    try {
        const world = new World(), terrain = new HeightTerrain(true), ctx = context({ width: 800, height: 600 });
        terrain.draw(ctx, world); const first = paints;
        assert.ok(first > 0 && first < 64); assert.equal(draws, first);
        terrain.draw(ctx, world); assert.equal(paints, first, 'unchanged patches stay cached');
        transform.e = transform.f = 100000; draws = 0;
        world.revision++; world.cellVersions.fill(world.revision);
        terrain.draw(ctx, world); assert.equal(draws, 0); assert.equal(paints, first);
        transform.e = transform.f = -1200; terrain.draw(ctx, world);
        assert.ok(paints > first, 'returning patches retain the pending terrain mutation');
    } finally { globalThis.document = previous; }
});
