import { lift } from './projection.ts';
import type { World, Actor, Vec } from './sim.ts';
type TrailPoint = Vec & {
    time: number;
    z: number;
    dash: boolean;
    angle: number;
};
// All glow, ribbons and hand geometry live outside the deterministic combat model.
export class TechniqueVisuals {
    private trails: TrailPoint[][] = [[], []];
    clear() { this.trails = [[], []]; }
    sample(world: World) {
        for (const a of world.actors) {
            const trail = this.trails[a.id], last = trail.at(-1);
            if (a.hp > 0 && (!last || Math.hypot(last.x - a.x, last.y - a.y, last.z - a.z) > .05))
                trail.push({ x: a.x, y: a.y, z: a.z, time: world.time, dash: a.dashLeft > 0, angle: a.aim });
            this.trails[a.id] = trail.filter(p => world.time - p.time < .55).slice(-40);
        }
    }
    flight(ctx: CanvasRenderingContext2D, world: World, actors: Actor[], zoom: number, tilted = false) {
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (let a of actors) {
            if (a.hp <= 0)
                continue;
            const trail = this.trails[a.id].map(p => { const h = lift(p.z, tilted); return { ...p, x: p.x + h.x, y: p.y + h.y }; }), color = a.id ? '#ffc389' : '#83f5e1';
            if (trail.length > 1) {
                const first = trail[0], last = trail.at(-1)!;
                const gradient = ctx.createLinearGradient(first.x, first.y, last.x + .001, last.y + .001);
                gradient.addColorStop(0, a.id ? '#ffc38900' : '#83f5e100');
                gradient.addColorStop(1, color);
                ctx.fillStyle = gradient;
                ctx.globalAlpha = .6;
                ctx.shadowColor = color;
                ctx.shadowBlur = 12;
                // One tapered silhouette avoids bright seams between simulation samples.
                ctx.beginPath();
                for (const side of [-1, 1])
                    for (let j = 0; j < trail.length; j++) {
                        const i = side === -1 ? j : trail.length - 1 - j, p = trail[i], prev = trail[Math.max(0, i - 1)], next = trail[Math.min(trail.length - 1, i + 1)];
                        const angle = Math.atan2(next.y - prev.y, next.x - prev.x), life = Math.max(0, 1 - (world.time - p.time) / .55), width = life * (p.dash ? 1.15 : .22);
                        const x = p.x - Math.sin(angle) * width * side, y = p.y + Math.cos(angle) * width * side;
                        if (side === -1 && j === 0)
                            ctx.moveTo(x, y);
                        else
                            ctx.lineTo(x, y);
                    }
                ctx.closePath();
                ctx.fill();
                ctx.shadowBlur = 0;
                for (const side of [-1, 1]) {
                    ctx.strokeStyle = gradient;
                    ctx.globalAlpha = .55;
                    ctx.lineWidth = .11;
                    ctx.beginPath();
                    for (let i = 0; i < trail.length; i++) {
                        const p = trail[i], prev = trail[Math.max(0, i - 1)], next = trail[Math.min(trail.length - 1, i + 1)], angle = Math.atan2(next.y - prev.y, next.x - prev.x), offset = side * (.65 + Math.sin(p.time * 24) * .3);
                        const x = p.x - Math.sin(angle) * offset, y = p.y + Math.cos(angle) * offset;
                        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
                    }
                    ctx.stroke();
                }
                for (let i = 0; i < trail.length; i += 4) {
                    const p = trail[i];
                    if (!p.dash)
                        continue;
                    ctx.save();
                    ctx.translate(p.x, p.y);
                    ctx.rotate(p.angle);
                    ctx.globalAlpha = Math.max(0, 1 - (world.time - p.time) / .55) * .17;
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.moveTo(1.1, 0);
                    ctx.lineTo(-1, -.65);
                    ctx.lineTo(-.6, 0);
                    ctx.lineTo(-1, .65);
                    ctx.closePath();
                    ctx.fill();
                    ctx.restore();
                }
            }
            const raised = lift(a.z, tilted);
            a = { ...a, x: a.x + raised.x, y: a.y + raised.y };
            const speed = Math.hypot(a.vx, a.vy);
            ctx.globalAlpha = .55;
            ctx.shadowBlur = 8;
            ctx.shadowColor = color;
            ctx.strokeStyle = color;
            ctx.lineWidth = .1;
            ctx.beginPath();
            ctx.ellipse(a.x, a.y, 1.3 + speed * .012, .65, world.time * 1.2, 0, 7);
            ctx.stroke();
            ctx.shadowBlur = 0;
            if (speed > 1) {
                ctx.globalAlpha = .45;
                for (let i = 0; i < 5; i++) {
                    const t = world.time * 3 + i * 1.7;
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.arc(a.x - Math.cos(a.aim) * (1 + i * .4) + Math.sin(t) * .5, a.y - Math.sin(a.aim) * (1 + i * .4) + Math.cos(t) * .5, .07 + Math.max(0, 2 / zoom) * .04, 0, 7);
                    ctx.fill();
                }
            }
        }
        ctx.restore();
    }
    bolt(ctx: CanvasRenderingContext2D, b: World['bolts'][number], clock: number) {
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(Math.atan2(b.vy, b.vx));
        const strength = 1 + Math.log2(b.power + 1) * .18, tail = 8 * strength, color = b.owner ? '#ffb777' : '#78f9ed';
        ctx.globalCompositeOperation = 'lighter';
        const wake = ctx.createLinearGradient(-tail, 0, 1, 0);
        wake.addColorStop(0, '#73f8df00');
        wake.addColorStop(.65, b.owner ? '#e9905944' : '#62dbc177');
        wake.addColorStop(1, color);
        ctx.fillStyle = wake;
        ctx.beginPath();
        ctx.moveTo(1.5, 0);
        ctx.quadraticCurveTo(-2, -1.3 * strength, -tail, -.1);
        ctx.quadraticCurveTo(-3, .65 * strength, 1.5, 0);
        ctx.fill();
        ctx.shadowBlur = 18;
        ctx.shadowColor = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = .75 * strength;
        ctx.beginPath();
        ctx.moveTo(-3 * strength, 0);
        ctx.lineTo(1.5, 0);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#fffbe6';
        ctx.lineWidth = .2 * strength;
        ctx.beginPath();
        ctx.moveTo(-2.5, 0);
        ctx.lineTo(1.7, 0);
        ctx.stroke();
        ctx.fillStyle = '#ffffe9';
        ctx.beginPath();
        ctx.moveTo(2.2, 0);
        ctx.lineTo(-.3, -.4 * strength);
        ctx.lineTo(-1, 0);
        ctx.lineTo(-.3, .4 * strength);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = .1;
        for (const side of [-1, 1]) {
            ctx.beginPath();
            for (let i = 0; i < 10; i++) {
                const x = -i * .8, y = side * (.3 + Math.sin(i * .8 + clock * 30) * .3) * strength;
                i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
            }
            ctx.stroke();
        }
        ctx.restore();
    }
    crescent(ctx: CanvasRenderingContext2D, wave: World['waves'][number]) {
        ctx.save();
        ctx.translate(wave.x, wave.y);
        ctx.rotate(wave.angle);
        ctx.globalCompositeOperation = 'lighter';
        const r = wave.span, tip = 1.15;
        ctx.shadowBlur = 22;
        ctx.shadowColor = '#a3f5df';
        ctx.fillStyle = '#bdfbe4';
        ctx.beginPath();
        ctx.arc(0, 0, r, -tip, tip);
        ctx.quadraticCurveTo(r * .88, 0, Math.cos(tip) * r, -Math.sin(tip) * r);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#fffde2';
        ctx.lineWidth = .22;
        ctx.beginPath();
        ctx.arc(0, 0, r, -tip, tip);
        ctx.stroke();
        for (let j = 1; j < 4; j++) {
            ctx.globalAlpha = .25 / j;
            ctx.strokeStyle = '#81ead5';
            ctx.lineWidth = .2;
            ctx.beginPath();
            ctx.arc(-j * 1.1, 0, r, -tip, tip);
            ctx.stroke();
        }
        ctx.restore();
    }
    palm(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, alpha: number, descending = 0, angle = -Math.PI / 2, tilted = false) {
        ctx.save();
        const height = tilted ? lift(descending, true) : { x: 0, y: -descending };
        ctx.translate(x + height.x, y + height.y);
        ctx.rotate(angle + Math.PI / 2);
        ctx.scale(radius * .95, radius * .95);
        ctx.globalAlpha = alpha;
        ctx.shadowBlur = 18;
        ctx.shadowColor = '#ffe0a1';
        // A splayed hand: five separate rounded fingers, a broad palm, and a wrist.
        ctx.beginPath();
        ctx.moveTo(-.2, .79);
        ctx.lineTo(-.35, .36);
        ctx.quadraticCurveTo(-.43, .19, -.64, -.01);
        ctx.quadraticCurveTo(-.84, -.22, -.69, -.3);
        ctx.quadraticCurveTo(-.6, -.35, -.38, -.08);
        ctx.lineTo(-.39, -.57);
        ctx.quadraticCurveTo(-.39, -.78, -.27, -.78);
        ctx.quadraticCurveTo(-.18, -.78, -.18, -.6);
        ctx.lineTo(-.15, -.22);
        ctx.lineTo(-.15, -.84);
        ctx.quadraticCurveTo(-.15, -1.04, -.035, -1.04);
        ctx.quadraticCurveTo(.08, -1.04, .08, -.84);
        ctx.lineTo(.08, -.25);
        ctx.lineTo(.12, -.74);
        ctx.quadraticCurveTo(.13, -.93, .24, -.92);
        ctx.quadraticCurveTo(.35, -.91, .32, -.73);
        ctx.lineTo(.27, -.18);
        ctx.lineTo(.35, -.53);
        ctx.quadraticCurveTo(.41, -.7, .5, -.66);
        ctx.quadraticCurveTo(.61, -.63, .55, -.44);
        ctx.lineTo(.44, .14);
        ctx.quadraticCurveTo(.4, .38, .24, .51);
        ctx.lineTo(.22, .79);
        ctx.closePath();
        const gold = ctx.createLinearGradient(-.4, -1, .3, .8);
        gold.addColorStop(0, '#fff4cfaa');
        gold.addColorStop(.5, '#e6bd7955');
        gold.addColorStop(1, '#e7c88111');
        ctx.fillStyle = gold;
        ctx.fill();
        ctx.strokeStyle = '#ffedb6';
        ctx.lineWidth = .012;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = '#fff1c7bb';
        ctx.lineWidth = .006;
        for (const [px, py] of [[-.28, -.45], [-.04, -.57], [.21, -.5], [.43, -.35]]) {
            ctx.beginPath();
            ctx.moveTo(px - .055, py);
            ctx.lineTo(px + .055, py + .018);
            ctx.moveTo(px - .05, py + .075);
            ctx.lineTo(px + .045, py + .09);
            ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(-.32, -.02);
        ctx.bezierCurveTo(-.04, -.16, .26, -.03, .32, .08);
        ctx.moveTo(-.23, .11);
        ctx.bezierCurveTo(-.05, .35, .22, .24, .27, .19);
        ctx.moveTo(-.3, .04);
        ctx.bezierCurveTo(-.1, .14, -.15, .4, -.02, .52);
        ctx.stroke();
        ctx.strokeStyle = '#ffeab7aa';
        ctx.beginPath();
        ctx.arc(0, .1, .12, 0, 7);
        ctx.moveTo(-.07, .1);
        ctx.lineTo(.07, .1);
        ctx.moveTo(0, .03);
        ctx.lineTo(0, .17);
        ctx.stroke();
        ctx.restore();
    }
    palms(ctx: CanvasRenderingContext2D, world: World, tilted = false) {
        for (const c of world.casts) {
            const t = 1 - c.left / .65, approach = Math.pow(1 - t, 2);
            this.palm(ctx, c.x, c.y, c.radius, .07 + t * .11, world.groundHeight(c.x, c.y), c.angle, tilted);
            const startX = c.sourceX - Math.cos(c.angle) * c.radius * .5;
            const startY = c.sourceY - Math.sin(c.angle) * c.radius * .5;
            this.palm(ctx, c.x + (startX - c.x) * approach, c.y + (startY - c.y) * approach, c.radius, .12 + t * .65, c.z, c.angle, tilted);
        }
        for (const e of world.effects)
            if (e.kind === 'nova') {
                const t = 1 - e.life / e.maxLife;
                this.palm(ctx, e.x, e.y, e.radius, Math.max(0, 1 - t * 1.3) * .85, e.z ?? 0, e.angle, tilted);
            }
    }
}
