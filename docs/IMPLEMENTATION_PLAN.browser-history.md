> Archived browser-era evidence as of 2026-10-25. Old stack choices, current-state claims and next-step instructions below are historical. Future work follows the [native roadmap](../../cultivationGame3-Godot/new-game-project/docs/IMPLEMENTATION_PLAN.md).

# Severed Heaven — Implementation Plan

Working draft · 2026-10-24 · Design source: [GAME_DESIGN.md](GAME_DESIGN.md)

Concrete specifications: [opening chapter](OPENING_CHAPTER.md) · [art direction](ART_DIRECTION.md).

**2026-10-25 platform update:** user selected native desktop and the existing sibling Godot project `cultivationGame3-Godot/new-game-project`. Preserve this browser prototype as a reference; prioritize a native terrain/flight/destruction comparison, then bounded authoritative co-op parity and performance review before resuming guardian/campaign work. Historical browser acceptance is not native-engine certification.

## Milestone and phase checklist

Updated 2026-10-24. Checked means the stated deliverable is complete; unchecked means work remains. **In progress**, **next**, and **planned** distinguish unfinished work. Milestones close only after their exit review. Later phases are provisional and will receive a precise brief before implementation; this checklist is the authoritative phase index.

- [ ] **M0 — Agree on the game contract · In progress**
  - [x] M0.P1 — Establish version control and a recoverable backup baseline. Local Git commit, bundle restore/content verification, 63 tests, type check, and build; [handoff](phases/M0.P1-baseline.md).
  - [x] M0.P2 — Record the core game direction, sect restoration loop, and opening premise.
  - [x] M0.P3 — Write the opening chapter specification and initial restoration proposal.
  - [x] M0.P4 — Establish the art direction and save the user-endorsed concept.
  - [ ] M0.P5 — Define the cultivation glossary and select the first two build paths.
  - [ ] M0.P6 — Resolve initial co-op scope, world ownership, death rules, and technical constraints.
  - [ ] M0.P7 — Review and agree on the bounded first playable scope and deferred systems.

- [x] **M1 — Prove multiplayer combat feasibility · Complete (bounded local prototype accepted 2026-10-24)**
  - [x] M1.P1 — Separate shared simulation inputs and preserve solo combat behavior. Validated: 63 tests, type check, build.
  - [x] M1.P2 — Implement session authority, actor ownership, command validation, sequencing, and stale-input handling. 75 tests, type check, build, emitted module smoke; [handoff](phases/M1.P2-session-authority.md).
  - [x] M1.P3 — Select a development transport and connect two real clients to one authority. Loopback HTTP polling, 82 tests/type check/build, two-browser movement/cast/shared damage and terrain verification; [handoff](phases/M1.P3-local-transport.md).
  - [x] M1.P4 — Replicate join snapshots, ordered state changes, and bounded terrain deltas. 92 tests/type check/build, full-world paging/retry/resync checks and two-browser late join; [handoff](phases/M1.P4-state-replication.md).
  - [x] M1.P5 — Add local prediction/reconciliation and remote interpolation; exercise latency, jitter, and loss. 101 tests/type check/build, seeded profiles and two impaired browser clients; [measurements and limits](phases/M1.P5-responsive-clients.md).
  - [x] M1.P6 — Handle disconnect, rejoin, idle actors, and host departure. Bounded 30-second reservation, fresh-generation snapshot recovery, 106 tests/type check/build and two-browser recovery/restart checks; [handoff](phases/M1.P6-session-recovery.md).
  - [x] M1.P7 — Review two-client combat/terrain behavior, shared-clock Heavenly Step, and stack feasibility. Initial review identified common-enemy/action/responsiveness gaps; these were resolved in M1.P8–P10. Historical 106-test [review](phases/M1.P7-integration-review.md).
  - [x] M1.P8 — Implement bounded reliable cast/dodge delivery across loss, reordering, expiry and recovery. [Handoff](phases/M1.P8-reliable-actions.md).
  - [x] M1.P9 — Demonstrate both allied players damaging the shared stationary sentinel, with host-owned teams and no friendly fire. [Handoff](phases/M1.P9-shared-target.md).
  - [x] M1.P10 — Meet agreed scoped responsiveness budgets; review integrated shared-clock combat/terrain and obtain user bounded-prototype acceptance. 117 tests/check/build, seeded and real-client checks plus load diagnostic; no independent two-human playtest claim. [Final review](phases/M1.P10-responsiveness-review.md).

- [ ] **M2 — Turn the arena into an encounter · In progress**
  - [x] M2.P1 — Define reusable technique, enemy, and encounter data with validation. 120 tests/check/build, emitted import and whitespace checks pass; stationary baseline and fixed roster limits documented. [Handoff](phases/M2.P1-content-data.md).
  - [x] M2.P2 — Add multiple-enemy perception, navigation, altitude handling, and telegraphed attacks. Bounded flying skirmishers, protocol-4 roster/warnings, 132 tests/check/build/import/whitespace checks and two-browser review; [handoff and limits](phases/M2.P2-enemy-ai.md).
  - [x] M2.P3 — Implement encounter lifecycle, leash/reset, defeat, and revive/recovery rules. User-selected ally revive, terrain-preserving terminal Retry, epoch-safe actions; 147 tests/check/build/import/whitespace checks and two-browser UI verification. [Handoff](phases/M2.P3-encounter-lifecycle.md).
  - [x] M2.P4 — Build two distinct loadout variants and explicit ally/team targeting rules. Host-owned guided-volley/committed-crescent presets, protocol-6 display slots and reset/recovery preservation; 156 tests/check/build/import/whitespace checks and two-browser control verification. [Handoff](phases/M2.P4-loadouts-teams.md).
  - [ ] M2.P5 — Build a guardian encounter with solo and co-op patterns.
  - [x] M2.P5a — Original study presentation connected to network-driven actors; moved ahead of P5 at the user’s request on 2026-10-25. Solo preserved; two-browser checks, 163 tests/check/build and 46 emitted imports pass. Painted production art remains M4. [Handoff](phases/M2.P5a-study-presentation.md).
  - [ ] M2.P6 — Review encounter readability, contribution, collision behavior, and sustained performance.

- [ ] **M3 — Persist an expedition and a character · Planned**
  - [ ] M3.P1 — Define versioned character, world, settings, region, and sect state schemas.
  - [ ] M3.P2 — Implement recoverable save/load, migrations, backups, and explicit legacy terrain handling.
  - [ ] M3.P3 — Implement inventory, loot ownership, and idempotent reward transactions.
  - [ ] M3.P4 — Persist technique unlocks, journal objectives, and checkpoints.
  - [ ] M3.P5 — Persist region scars and implement coordinated region transitions.
  - [ ] M3.P6 — Persist sect facilities, contributions, treasury permissions, and restoration transactions.
  - [ ] M3.P7 — Integrate reconnect restoration and review corruption, interruption, and duplicate-message recovery.

- [ ] **M4 — First complete secret-realm expedition · Planned**
  - [ ] M4.P1 — Greybox the approach, fallen sect, wilderness loop, and sanctuary.
  - [ ] M4.P2 — Implement chapter facts, objectives, checkpoints, and solo/co-op onboarding.
  - [ ] M4.P3 — Build the sanctuary puzzle, guardian, discovery, and inheritance rewards.
  - [ ] M4.P4 — Complete the expedition-to-restoration loop, visible refuge renewal, and founding decision.
  - [ ] M4.P5 — Build the first painted courtyard slice and validate dynamic terrain, altitude, and combat readability.
  - [ ] M4.P6 — Extend the proven art kit; add necessary UI, dialogue, ambience, and audio cues.
  - [ ] M4.P7 — Review the complete chapter solo and in co-op, including recovery and player feedback.

- [ ] **M5 — Make cultivation meaningful · Planned**
  - [ ] M5.P1 — Define cultivation methods, mastery, stage requirements, insights, and bottlenecks.
  - [ ] M5.P2 — Implement cultivation resources, preparation consumables, and one peaceful sect activity.
  - [ ] M5.P3 — Connect restored spiritual infrastructure to preparation and the cultivation interface.
  - [ ] M5.P4 — Build the Qi Gathering-to-Foundation trial, recoverable failure, and capability reward.
  - [ ] M5.P5 — Add the next discoverable route and meaningful realm-based traversal or survival requirements.
  - [ ] M5.P6 — Review thematic fidelity, advancement pacing, mixed-realm cooperation, and clarity.

- [ ] **M6 — Social consequences, challenges, and duels · Planned**
  - [ ] M6.P1 — Build two faction interests, neutral relationships, and reputation/commission rules.
  - [ ] M6.P2 — Add a consequential story branch with explicit host/guest outcome handling.
  - [ ] M6.P3 — Expand sect prosperity, specialists, visitors, and faction responses.
  - [ ] M6.P4 — Build a repeatable scored challenge with safe reward handling.
  - [ ] M6.P5 — Implement consensual 1v1 duels, explicit stakes, normalization options, and exit rules.
  - [ ] M6.P6 — Evaluate four-player support against measured budgets and implement it if viable.
  - [ ] M6.P7 — Review social consequences, challenge/duel exploits, and co-op/PvP tuning boundaries.

- [ ] **M7 — Campaign production and completion · Planned**
  - [ ] M7.P1 — Set a measured content budget and campaign/sect-restoration stage outline.
  - [ ] M7.P2 — Build reusable content authoring and validation tools.
  - [ ] M7.P3 — Produce the approved regions, routes, secret realms, and enemy families.
  - [ ] M7.P4 — Complete the remaining approved cultivation paths and realm breakthroughs.
  - [ ] M7.P5 — Complete faction/story arcs, sect prosperity stages, and the campaign ending.
  - [ ] M7.P6 — Add repeatable mastery content using the proven systems.
  - [ ] M7.P7 — Review full fresh-character solo/co-op runs, build viability, quest safety, and persistent geography.

- [ ] **M8 — Release readiness · Planned**
  - [ ] M8.P1 — Complete accessibility, input, text, audio, and motion settings.
  - [ ] M8.P2 — Validate released save migrations, backups, restoration, and upgrade recovery.
  - [ ] M8.P3 — Harden network input handling, session recovery, and reward integrity.
  - [ ] M8.P4 — Profile chosen minimum hardware and resolve performance blockers.
  - [ ] M8.P5 — Complete the asset/license audit and player-facing instructions.
  - [ ] M8.P6 — Prepare deployment/relay operations, service cost review, and support/recovery procedures.
  - [ ] M8.P7 — Conduct final release review against platform targets and campaign blockers. Publishing remains a separate action.

Working rule: one bounded phase per implementation chat, with a brief, acceptance checks, and a handoff. Large provisional phases—especially campaign content production—will be split into smaller numbered phases when their scope is known. Update this checklist and `docs/STATUS.md` at each phase handoff. No phase chat or implementation work is launched by checking or adding a planning item.

## Current work — 2026-10-24

M1 is complete at the bounded local feasibility boundary, following the user's explicit acceptance of the prototype, numerical targets and no-friendly-fire test rule. Two allied browser clients move/cast, damage a shared stationary sentinel and terrain, recover without state/action grants, and use one authoritative combat clock. Reliable discrete actions, protocol-3 replication and tuned motion buffering resolve the gaps identified in M1.P7. All 117 tests, type check, build, scoped seeded budgets and real-client checks pass; see [M1.P10 final review](phases/M1.P10-responsiveness-review.md).

The overhead harness is intentionally minimal network-test presentation. The user flagged that it does not look like the original study; that renderer is preserved under `npm run dev` and is now connected to multiplayer through M2.P5a. This acceptance does not approve the harness as the final game look. M2 is authorized and M2.P1–P4 are complete; M2.P5 has not started; see [phase brief](phases/M2.P1-content-data.md). Run one implementation phase at a time in the shared checkout.

Retain TypeScript/Canvas for the next prototype. Local HTTP is a development transport, not proof of production platform/hosting, NAT/relay/account security or arbitrary internet performance. Campaign/team/death/ownership policy, a universal solo/network authority interface, complete restorable simulation/RNG state, durable events and inventory/reward persistence remain deferred. The common target is stationary, not an M2 enemy encounter. No independent two-human playtest or production combat-feel certification is claimed.

M1 is checkpointed at `c69eb34` and pushed to origin/master. Its 117 tests, type check, build and whitespace check passed on checkpoint verification. The user authorized this M2 hub to start phase chats. No publication or deployment is authorized by milestone implementation.

## Planning rules

Preserve the playable combat study throughout development. Ship small playable milestones with exit criteria. Estimates wait until multiplayer, renderer limits, available effort, and content production rate are known. This document authorizes no implementation by itself; the current task is planning and design.

User-confirmed product direction: cooperative multiplayer cultivation RPG with exploration, secret realms, builds, challenges, duels, factions, story, and thematic fidelity. Party size, platform, narrative ownership, death penalties, and detailed content bounds remain proposals.

Update, 2026-10-24: the user endorsed the design and confirmed a fallen sect hub that players rebuild into a prosperous community. Personal strength opens further exploration on a world map. Peaceful activities are part of the experience; seamless open-world travel is optional. Prioritize persistent connected regions and a complete expedition-to-restoration loop before considering seamless streaming.

## Baseline

- TypeScript and Canvas 2D browser project; no runtime dependencies or backend.
- `src/sim.ts` owns simulation, combat entities, terrain, and current rival logic.
- `src/main.ts` owns input, browser loop, HUD, camera, and storage; presentation adapters already exist.
- Terrain save version 2 supports migration from version 1; no complete character/world save.
- Verification on 2026-10-24: `npm run check` and `npm test` pass, 60 tests.
- `tools.mjs` explicitly lists built modules; adding modules requires updating the build or replacing that list deliberately.
- M0.P1 completed on 2026-10-24: local Git baseline and verified recovery bundle; see [coverage and recovery instructions](phases/M0.P1-baseline.md).

## Milestone 0 — Agree on the game contract

Deliverables: resolve the critical decisions in the design, write a cultivation glossary, select the first two paths, outline one chapter, define solo/co-op ownership and death policies, and establish version control.

Include a first sect restoration goal, the starting ruins and inhabitants, one visible prosperity change, a world-map route, and rules distinguishing personal advancement from shared sect advancement.

Confirmed opening: outsiders fleeing danger discover the ruined sect. Outline the immediate threat, arrival, first shelter, and decision to stay. Keep the pursuers' identity and the sect's fall as explicit story decisions; do not assume the protagonists inherit leadership or are secretly connected to the ruins.

Exit: a short approved scope, an example 20–30 minute expedition on paper, and explicit deferred systems. The duration is a proposed session target, not a measured existing feature.

## Milestone 1 — Prove multiplayer combat feasibility

Dependencies: population, platform, authority, and Heavenly Step decisions.

1. Separate player intent from actor identity and allow multiple controlled actors without changing existing solo behavior.
2. Extract explicit simulation commands, snapshots, stable entity IDs, seeded random state, and ordered events. Audit all player/rival special cases and time domains.
3. Introduce one authority interface used by local solo and a two-client network harness.
4. Compare practical transports and host/relay deployment needs. Record service cost, availability, authentication, and operational tradeoffs before selecting dependencies.
5. Implement authoritative movement/casting, movement prediction and reconciliation, remote interpolation, sequenced snapshots, and bounded terrain deltas.
6. Prototype the shared-clock Heavenly Step proposal. Verify combat fairness and feel before reproducing presentation effects.

Exit: two clients can fly, attack, damage the same enemy and terrain, join a running test, and disconnect cleanly. Exercise proposed network targets of 50–150ms round-trip latency, jitter, and 1–3% packet loss; record behavior rather than claiming universal tolerance. No duplicated rewards or divergent authoritative terrain. Solo combat tests remain green.

Decision gate: continue the browser stack if acceptable. Consider a renderer/engine change only with evidence of unmet requirements, migration cost, and a preserved simulation boundary. Do not build campaign content on an unproven network model.

## Milestone 2 — Turn the arena into an encounter

Dependencies: multiplayer authority stable enough for repeated play.

Planning note from M1 closure: connect the original study presentation to network-driven actors before presenting the top-down test harness as representative gameplay. Preserve its rendering work; painted production art remains M4. Define the next bounded phase before implementation.

Deliver: data-defined encounters and techniques; multiple enemies; enemy perception, navigation/altitude handling, telegraphed attacks, leash/reset, encounter completion, revive/recovery, and a boss with multiple targets. Add two mechanically distinct build variants using a limited technique set.

Exit: solo and two-player versions are completable; high-realm threats are readable; no AI deadlock behind ordinary cover; boss patterns support aerial combat; all party members can contribute. Profile actor counts, guidance, terrain collision, and large effects under sustained combat.

## Milestone 3 — Persist an expedition and a character

Dependencies: stable character, encounter, and authority identity.

Deliver: versioned character/world/settings schemas; atomic or recoverable saves; inventory and reward transactions; loot ownership; technique unlocks; journal/checkpoints; import/export or backup flow; disconnect/reconnect restoration. Keep legacy terrain import explicit.

Add stable region IDs and a region registry, unloaded-region persistence, discovered routes, sect restoration state, resident IDs, treasury/contribution records, and authorized shared spending. Save region terrain independently from facility upgrade state. Use an explicit region transition protocol: commit departing state, transfer participating players under the agreed party-travel policy, load destination state, and reconcile the session snapshot. Initially keep the party in one active expedition region; party splitting across regions remains a separate scope decision.

Exit: save/load preserves builds, world scars, rewards, and quest state; interrupted writes recover; replaying a completion message cannot duplicate a reward; incompatible or corrupted saves produce a useful recovery path. Returning guests retain earned character progress under the agreed policy.

Also verify: damage terrain in region A, visit B, restart, and return to A with identical scars. A guest cannot spend shared resources without permission. Duplicate restoration requests cannot charge twice or grant duplicate unlocks.

## Milestone 4 — First complete secret-realm expedition

Dependencies: encounters and persistence.

Deliver: one small hub, wilderness route, discoverable entrance, formation puzzle, optional discovery, guardian, inheritance choice, return journey, and a short quest arc. Add onboarding, map, inventory, loadout, and session UI only as needed by this loop. Include original environmental and audio assets with tracked licenses.

The hub starts as the fallen sect. The expedition must recover something needed for one meaningful restoration, such as a formation diagram and materials. Returning players complete the project, see a repaired facility and renewed activity, and gain a useful preparation option plus a lead to another destination. Include one peaceful interaction and one recruitable specialist or resident. Represent the next destination on the world map without building an entire additional region yet.

Introduce this loop through the fugitives' arrival: a short playable escape, discovery of shelter, and a first restoration that meets an immediate survival need. Support solo and co-op arrival without requiring identical personal histories. Test that new players understand why they fled, why the ruins offer refuge, and why they choose to stay; the deeper mystery can remain unresolved.

Exit: a new solo player and a new co-op party can understand the goal, prepare, explore, complete or retreat, return, and use the reward without developer controls. Document confusion, duration, enjoyment, and performance from playtests. Proceed only if the loop works; expand no regions merely to compensate for a weak loop.

The return must visibly improve the sect and make the next expedition appealing. Verify restoration does not reset wilderness scars, damage essential travel links, or consume a guest's personal progression unexpectedly.

## Milestone 5 — Make cultivation meaningful

Dependencies: expedition rewards and build choices have value.

Deliver: cultivation method, technique mastery, stage/bottleneck rules, resources, a complete Qi Gathering-to-Foundation breakthrough, preparation consumables, recoverable failure, and a trial. Provide clear requirements and outcomes in the cultivation UI.

Connect restored spiritual infrastructure and one peaceful activity to breakthrough preparation. Define the first route unlocked or made survivable through the new realm, while retaining separate discovery requirements and danger warnings.

Exit: advancement requires a combination of exploration, understanding, and preparation; the breakthrough unlocks a useful capability; no idle grind is required to test it. Mixed-realm parties have useful activities without flattening realm differences. Audit terms, incentives, and quest text against the glossary.

## Milestone 6 — Social consequences, challenges, and duels

Dependencies: persistent world ownership and progression policies.

Deliver: two faction interests, neutral hub relationships, commissions, a consequential branch, contribution/reward rules, one repeatable scored challenge, and consensual 1v1 duels with explicit normalization/stakes. Expand to four players only after measured simulation/network/render budgets hold.

Make these relationships respond to sect restoration: a specialist arrives, a faction offers or withholds an agreement, and visitors recognize growing influence. Expand prosperity through a small set of visible conditions and facilities. Defer raids, upkeep, and detailed disciple simulation.

Exit: faction choices change access or events visibly; guests understand host-owned outcomes; challenge rewards cannot be farmed through reconnects; duel initiation, cancellation, defeat, and leaving are handled. Co-op tuning and duel tuning can differ without corrupting character data.

## Milestone 7 — Campaign production and completion

Dependencies: the previous slice is fun, understandable, and stable.

Deliver: authored regional campaign, remaining approved realm breakthroughs, additional secret realms and enemy families, remaining approved paths, ending, and repeatable mastery content. Set exact content counts from measured authoring time. Build reusable encounter, dialogue, quest, loot, and region validation tools before multiplying content.

Plan the campaign around successive sect restoration stages and world-map discoveries. Each major stage adds visible prosperity and a playable opportunity. Preserve stable region geography and saved terrain across the complete campaign; seamless streaming is not an exit criterion.

Exit: a fresh character can complete the campaign solo and in co-op; all approved realms have distinct play and thematic purpose; story dependencies cannot be destroyed or skipped into dead ends; builds have viable answers to required encounters. No unfinished feature is necessary to reach the ending.

## Milestone 8 — Release readiness

Deliver: accessibility and input pass, save migration fixtures, restore/backup UX, network abuse and malformed-input handling, recovery messages, profiling on chosen minimum hardware, deployment/relay runbook, asset/license audit, and player-facing instructions.

Exit: defined platform and performance targets pass; repeated save/reconnect/upgrade tests pass; campaign blockers are resolved; service and support costs are understood. A public release or service deployment is a separate authorized action.

## Proposed architecture boundaries

Names indicate responsibilities, not a requirement to create empty folders now.

| Boundary | Responsibility | Constraint |
| --- | --- | --- |
| Simulation | Movement, collision, techniques, damage, enemies, terrain | No DOM, networking, or wall-clock access |
| Authority/session | Accepted commands, actor ownership, ordered events, encounter and reward commits | Clients cannot grant their own damage, items, or progression |
| Network adapter | Transport, sequencing, snapshots/deltas, reconnect | Presentation effects are derived from events |
| Campaign/domain | Characters, inventory, methods, quests, factions, breakthroughs | Explicit rules and serializable state |
| Content | Validated definitions for techniques, enemies, regions, quests, rewards | Stable IDs; no arbitrary executable downloaded content |
| Persistence | Schemas, migrations, integrity, recovery | Separate character and host world ownership |
| Presentation/UI | Rendering, audio, input, camera, menus, interpolation | Never determines combat outcomes |

Avoid rewriting the entire existing simulation before the network spike. Introduce boundaries when a milestone needs them and preserve behavior with current tests. Replication must distinguish full terrain snapshots from incremental mutation stamps; current local revision tracking alone is not a network protocol.

## Verification strategy

- Keep deterministic combat and geometry tests as the regression baseline.
- Add meaningful tests at authority, reward, save migration, quest transition, and multiplayer reconciliation boundaries.
- Test two real clients in addition to simulated transport; inspect join, late packets, reconnect, host loss, and long-running terrain mutation.
- Use playable checks for targeting readability, altitude, boss signals, party visibility, and cultivation comprehension.
- Record simulation step cost, frame time percentiles, memory, snapshot size, and outgoing bandwidth for repeatable scenarios. Pick numerical budgets after target hardware and transport are selected.
- Maintain save fixtures from every released schema and include interrupted/corrupted records. Validate required content references before build.

## Principal risks and responses

| Risk | Early response | Fallback |
| --- | --- | --- |
| Player-specific time dilation conflicts with multiplayer | Shared-clock prototype in milestone 1 | Personal movement art without global slow |
| Destruction dominates bandwidth or CPU | Chunk deltas, relevance, bounded mutations, profiling | Reduce concurrent mutation rate and active area |
| Canvas presentation fails content/readability needs | Multi-actor boss benchmark before content scale-up | Measured renderer/engine migration |
| Co-op players advance at different rates | Shared credit, clear realm danger, mixed-role encounter tests | Voluntary equalized challenge mode; preserve campaign realm identity |
| World choices conflict between hosts | Separate character and world records; explicit ownership UI | Replay per host without duplicating unique rewards |
| Cultivation becomes ordinary XP grinding | Bottleneck, method, insight, and tribulation prototype | Fewer, deeper progression systems |
| Content ambition exceeds production capacity | Measure first expedition and chapter authoring | Fewer regions, paths, and secret realms with a complete ending |
| Browser/session service assumptions fail | Transport and hosting spike before campaign work | Revisit delivery platform before irreversible investment |

## Next planning conversation

Resolve party size/hosting, first sect restoration and peaceful activities, first paths, death stakes, and Heavenly Step. Develop what the outsiders are fleeing and who remains in the ruins at their arrival. Then refine milestone 0 scope. Implementation begins only after the user selects the next work.

