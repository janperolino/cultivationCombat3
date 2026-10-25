import type { World, Actor, Bolt, SwordWave, Cast, Effect } from './sim.ts';
export type StudyBolt = Pick<Bolt, 'x' | 'y' | 'z' | 'vx' | 'vy' | 'power' | 'owner' | 'launched'>;
export type StudyWave = Pick<SwordWave, 'x' | 'y' | 'z' | 'owner' | 'span' | 'angle'>;
export type StudyCast = Pick<Cast, 'x' | 'y' | 'z' | 'owner' | 'radius' | 'left' | 'sourceX' | 'sourceY' | 'angle'>;
export type StudyScene = Pick<World, 'cells' | 'cellVersions' | 'revision' | 'cellAt' | 'groundHeight' | 'time'> & {
    actors: Actor[]; bolts: StudyBolt[]; waves: StudyWave[]; casts: StudyCast[]; effects: Effect[];
};
export function actorPalette(a: Pick<Actor, 'id' | 'enemyId'>) {
    return a.enemyId ? { glow: '#ef9b91', fade: '#ef9b9100', robe: '#ad796e', trim: '#653d43' } :
        a.id ? { glow: '#ffc389', fade: '#ffc38900', robe: '#a26d57', trim: '#5b403c' } :
        { glow: '#83f5e1', fade: '#83f5e100', robe: '#d7e0ca', trim: '#47776b' };
}
