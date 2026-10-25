// Undefined teams retain the original solo sparring/free-for-all behavior.
type TeamActor = { id: number; team?: number };
export const sameTeam = (a: TeamActor, b: TeamActor) => a.team !== undefined && b.team !== undefined && a.team === b.team;
export const hostile = (a: TeamActor, b: TeamActor) => a.id !== b.id && !sameTeam(a, b);
