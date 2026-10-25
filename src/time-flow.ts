export type DashProfile = {
    duration: number;
    worldScale: number;
    recovery: number;
    speed: number;
};
export function dashProfile(realm: number): DashProfile { const tier = Math.max(0, Math.min(3, Math.floor(realm))); return { duration: [1.5, 2, 2.6, 3.3][tier], worldScale: [.35, .28, .22, .18][tier], recovery: 1.1, speed: [38, 48, 60, 72][tier] }; }


