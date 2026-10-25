# Severed Heaven — browser reference

Updated 2026-10-25. The product is migrating to Windows desktop in the user's existing Godot project. Browser play is no longer a product requirement. Preserve this checkout, its uncommitted work and historical evidence as the rules/content/test reference.

Future work starts at the [native status](../cultivationGame3-Godot/new-game-project/docs/STATUS.md), [native design](../cultivationGame3-Godot/new-game-project/docs/GAME_DESIGN.md) and [sole active migration roadmap](../cultivationGame3-Godot/new-game-project/docs/IMPLEMENTATION_PLAN.md). Actual project: `C:\Users\janpe\CMPTProjects\cultivationGame3-Godot\new-game-project\project.godot`. The native starter is solo flight/terrain/crater comparison only, with placeholder art; browser combat and networking have not automatically migrated.

Browser M1 bounded local feasibility and M2.P1–P4/P5a are complete; guardian/campaign remain unimplemented. Latest handoff reports 165 TypeScript tests, not native certification. HTTP polling is a loopback development adapter; performance observations are scene-dependent. [Historical README and run instructions](README.browser-history.md), [historical status](docs/STATUS.browser-history.md), [historical plan](docs/IMPLEMENTATION_PLAN.browser-history.md).

Reference commands: `npm run dev` (original solo, normally 5173), `npm run spike` (stationary co-op) or `npm run encounter` (skirmish co-op, normally 5174). `npm run check`, `npm test`, `npm run build` validate browser work only. Start local hosts only when needed; historical review URLs may no longer be live.

Next native implementation is N1: fixed-step local authority and canonical terrain/query contract. No further browser guardian phase or full port is launched by this documentation update. No reset, commit, push or publication performed.
