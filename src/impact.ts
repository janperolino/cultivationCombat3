import type { StudyScene } from './study-scene.ts';
import type { World, Vec, Effect } from './sim.ts';
// Presentation-only: never mutates the world or advances combat time.
type Fragment = Vec & {
    vx: number;
    vy: number;
    z: number;
    ground: number;
    vz: number;
    life: number;
    max: number;
    size: number;
    dust: boolean;
    seed: number;
};
export class ImpactPresentation {
    private seen = new WeakSet<Effect>();
    private charges = new WeakSet<object>();
    particles: Fragment[] = [];
    trauma = 0;
    flash = 0;
    hitStop = 0;
    clock = 0;
    focus: (Vec & {
        radius: number;
        left: number;
    }) | null = null;
    reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    sound = true;
    private audio: AudioContext | null = null;
    private noiseBuffer: AudioBuffer | null = null;
    private lastBoom = -1;
    unlock() {
        if (!this.audio) {
            this.audio = new AudioContext();
            this.noiseBuffer = this.audio.createBuffer(1, this.audio.sampleRate, this.audio.sampleRate);
            const data = this.noiseBuffer.getChannelData(0);
            for (let i = 0; i < data.length; i++)
                data[i] = Math.random() * 2 - 1;
        }
        if (this.audio.state === 'suspended')
            void this.audio.resume();
    }
    private boom(size: number) {
        if (!this.sound || !this.audio)
            return;
        if (this.audio.currentTime - this.lastBoom < .06)
            return;
        this.lastBoom = this.audio.currentTime;
        const a = this.audio, now = a.currentTime, gain = a.createGain(), low = a.createBiquadFilter();
        low.type = 'lowpass';
        low.frequency.setValueAtTime(500, now);
        low.frequency.exponentialRampToValueAtTime(45, now + .65);
        gain.gain.setValueAtTime(.0001, now);
        gain.gain.exponentialRampToValueAtTime(Math.min(.22, .05 + size * .002), now + .015);
        gain.gain.exponentialRampToValueAtTime(.0001, now + 1);
        low.connect(gain);
        gain.connect(a.destination);
        const noise = a.createBufferSource();
        noise.buffer = this.noiseBuffer;
        noise.connect(low);
        noise.start();
        noise.stop(now + 1);
        const sub = a.createOscillator(), subGain = a.createGain();
        sub.frequency.setValueAtTime(85, now);
        sub.frequency.exponentialRampToValueAtTime(28, now + .5);
        subGain.gain.setValueAtTime(.15, now);
        subGain.gain.exponentialRampToValueAtTime(.0001, now + .8);
        sub.connect(subGain);
        subGain.connect(a.destination);
        sub.start();
        sub.stop(now + .8);
    }
    prime(world: Pick<StudyScene, 'effects' | 'casts'>) { for (const e of world.effects) this.seen.add(e); for (const c of world.casts) this.charges.add(c); }
    capture(world: Pick<StudyScene, 'casts' | 'effects' | 'time' | 'groundHeight'>) {
        for (const c of world.casts) {
            if (this.charges.has(c))
                continue;
            this.charges.add(c);
            if (c.radius >= 40)
                this.focus = { x: c.x, y: c.y, radius: c.radius * 1.35, left: c.left + 2.5 };
        }
        for (const e of world.effects) {
            if (this.seen.has(e))
                continue;
            this.seen.add(e);
            if (!['nova', 'impact', 'slash', 'death'].includes(e.kind))
                continue;
            const big = e.kind === 'nova', radius = e.radius;
            this.trauma = Math.min(1, this.trauma + (big ? .8 : e.kind === 'slash' ? .13 : .06));
            this.flash = Math.max(this.flash, big ? .16 : .035);
            if (big) {
                this.hitStop = this.reduced ? 0 : .075;
                this.focus = { x: e.x, y: e.y, radius: radius * 1.35, left: 2.5 };
            }
            this.boom(big ? radius : radius * .12);
            const count = big ? Math.min(260, Math.floor(80 + radius * 2)) : e.kind === 'slash' ? 25 : 8;
            for (let i = 0; i < count; i++) {
                const angle = i * 2.399963 + world.time, rand = (Math.sin(i * 72.17 + world.time * 10) * 43758.5453) % 1, speed = (big ? radius * .9 : 9) * (1 + Math.abs(rand));
                this.particles.push({ x: e.x + Math.cos(angle) * radius * .15, y: e.y + Math.sin(angle) * radius * .15, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, z: e.z ?? 0, ground: world.groundHeight(e.x, e.y), vz: (big ? 12 : 4) * (1 + Math.abs(rand)), life: big ? 2.8 : 1, max: big ? 2.8 : 1, size: (big ? .25 + Math.abs(rand) * 1.1 : .18), dust: i % 3 === 0, seed: angle });
            }
        }
        if (this.particles.length > 850)
            this.particles.splice(0, this.particles.length - 850);
    }
    update(dt: number, paused: boolean, sceneScale = 1) {
        if (paused)
            return;
        const sceneDt = dt * sceneScale;
        this.clock += sceneDt;
        this.trauma = Math.max(0, this.trauma - dt * 1.7);
        this.flash = Math.max(0, this.flash - dt * .9);
        this.hitStop = Math.max(0, this.hitStop - dt);
        if (this.focus) {
            this.focus.left -= dt;
            if (this.focus.left <= 0)
                this.focus = null;
        }
        for (const p of this.particles) {
            p.life -= sceneDt;
            p.x += p.vx * sceneDt;
            p.y += p.vy * sceneDt;
            p.vx *= Math.exp(-sceneDt * (p.dust ? 1.8 : 1.1));
            p.vy *= Math.exp(-sceneDt * (p.dust ? 1.8 : 1.1));
            p.z = Math.max(p.ground, p.z + p.vz * sceneDt);
            p.vz -= sceneDt * 23;
            if (p.z === p.ground && p.vz < 0)
                p.vz = -p.vz * .2;
        }
        this.particles = this.particles.filter(p => p.life > 0);
    }
    offset() { const n = this.reduced ? 0 : this.trauma * this.trauma * 13; return { x: Math.sin(this.clock * 117) * n, y: Math.cos(this.clock * 93) * n }; }
    draw(ctx: CanvasRenderingContext2D, world: Pick<StudyScene, 'effects' | 'actors'>, zoom: number, heightVector: Vec = { x: 0, y: -1 }) {
        for (const e of world.effects) {
            if (e.kind !== 'nova' && e.kind !== 'impact')
                continue;
            const t = 1 - e.life / e.maxLife, r = e.radius;
            ctx.save();
            ctx.translate(heightVector.x * (e.z ?? 0), heightVector.y * (e.z ?? 0));
            ctx.globalAlpha = Math.max(0, 1 - t);
            const glow = ctx.createRadialGradient(e.x, e.y, 0, e.x, e.y, r * (.3 + t));
            glow.addColorStop(0, '#fff4cbcc');
            glow.addColorStop(.2, '#e9c17a66');
            glow.addColorStop(1, '#c4862700');
            ctx.fillStyle = glow;
            ctx.beginPath();
            ctx.arc(e.x, e.y, r * (.3 + t), 0, 7);
            ctx.fill();
            for (let i = 0; i < 3; i++) {
                const progress = Math.max(0, t - i * .08);
                ctx.strokeStyle = i === 0 ? '#f9ead0' : '#bbac8a';
                ctx.lineWidth = Math.max(.12, (1 - t) * (i === 0 ? 1.6 : .6));
                ctx.beginPath();
                ctx.arc(e.x, e.y, r * (.1 + Math.pow(progress, .45) * (1.2 + i * .25)), 0, 7);
                ctx.stroke();
            }
            if (e.kind === 'nova') {
                ctx.strokeStyle = '#e0c394';
                ctx.lineWidth = .18 * (1 - t);
                for (let i = 0; i < 22; i++) {
                    const angle = i * 2.39996;
                    ctx.beginPath();
                    ctx.moveTo(e.x + Math.cos(angle) * r * .2, e.y + Math.sin(angle) * r * .2);
                    ctx.lineTo(e.x + Math.cos(angle + .05) * r * (.7 + t * .4), e.y + Math.sin(angle + .05) * r * (.7 + t * .4));
                    ctx.stroke();
                }
            }
            ctx.restore();
        }
        for (const p of this.particles) {
            const alpha = Math.min(1, p.life / .7);
            ctx.globalAlpha = alpha;
            if (p.dust) {
                ctx.fillStyle = '#baad8b';
                ctx.globalAlpha = alpha * .13;
                ctx.beginPath();
                ctx.arc(p.x + heightVector.x * p.z * .3, p.y + heightVector.y * p.z * .3, p.size * (4 + (1 - p.life / p.max) * 10), 0, 7);
                ctx.fill();
            }
            else {
                ctx.fillStyle = '#080d0a';
                ctx.globalAlpha = alpha * .4;
                ctx.beginPath();
                ctx.ellipse(p.x, p.y, p.size * 1.4, p.size * .6, 0, 0, 7);
                ctx.fill();
                ctx.globalAlpha = alpha;
                ctx.save();
                ctx.translate(p.x + heightVector.x * p.z, p.y + heightVector.y * p.z);
                ctx.rotate(p.seed + this.clock * 3);
                ctx.fillStyle = p.seed % 2 > 1 ? '#9c9d83' : '#524c37';
                ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * .65);
                ctx.restore();
            }
        }
        ctx.globalAlpha = 1;
        // A human remains human-sized even when the destruction forces the camera back.
        if (zoom < 4) {
            for (const a of world.actors) {
                ctx.strokeStyle = a.id ? '#e3b08588' : '#c6eddb88';
                ctx.lineWidth = .7 / zoom;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y - 3);
                ctx.lineTo(a.x, a.y - 9 / zoom - 3);
                ctx.stroke();
            }
        }
    }
    overlay(ctx: CanvasRenderingContext2D, w: number, h: number) {
        if (!this.reduced && this.flash > 0) {
            ctx.fillStyle = `rgba(255,229,178,${this.flash})`;
            ctx.fillRect(0, 0, w, h);
        }
        const vignette = ctx.createRadialGradient(w * .57, h * .5, h * .15, w * .57, h * .5, h * .8);
        vignette.addColorStop(0, '#00000000');
        vignette.addColorStop(1, '#00000066');
        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, w, h);
    }
    clear() { this.particles = []; this.focus = null; this.trauma = 0; this.flash = 0; this.hitStop = 0; }
}
