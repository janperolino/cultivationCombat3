import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project, unproject, lift } from '../src/projection.ts';
for (const tilted of [false, true]) {
    test(`projection and cursor picking round-trip in ${tilted ? '2.5D' : 'top-down'}`, () => {
        for (const p of [{ x: 0, y: 0 }, { x: 232, y: 256 }, { x: -22.4, y: 17.8 }, { x: 512, y: 512 }]) {
            const restored = unproject(project(p, tilted), tilted);
            assert.ok(Math.abs(restored.x - p.x) < 1e-9);
            assert.ok(Math.abs(restored.y - p.y) < 1e-9);
        }
    });
    test(`screen-relative controls maintain their direction in ${tilted ? '2.5D' : 'top-down'}`, () => {
        for (const screen of [{ x: 1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 1 }]) {
            const rendered = project(unproject(screen, tilted), tilted);
            assert.ok(Math.abs(rendered.x - screen.x) < 1e-9);
            assert.ok(Math.abs(rendered.y - screen.y) < 1e-9);
        }
    });
}
test('height projects straight upward while ground picking stays unchanged', () => {
    const height = project(lift(8, true), true);
    assert.ok(Math.abs(height.x) < 1e-9);
    assert.ok(Math.abs(height.y + 8) < 1e-9);
    const zero = lift(8, false);
    assert.deepEqual(zero, { x: 0, y: 0 });
});
