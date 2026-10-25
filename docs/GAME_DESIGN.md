> Historical browser-era reference, preserved 2026-10-25. Future edits and product decisions live in the [native version](../../cultivationGame3-Godot/new-game-project/docs/GAME_DESIGN.md) and [native roadmap](../../cultivationGame3-Godot/new-game-project/docs/IMPLEMENTATION_PLAN.md). Old technical/current-state statements below are historical.

# Severed Heaven — Full Game Design

Working draft · 2026-10-24 · Companion: [implementation plan](IMPLEMENTATION_PLAN.md)

Detailed specifications: [opening chapter](OPENING_CHAPTER.md) · [art direction and endorsed concept](ART_DIRECTION.md).

## 1. Direction and decision status

**User-confirmed direction:** a multiplayer cooperative cultivation RPG with duels, challenges, varied builds, exploration, secret realms, progression, factions, and a story. Fidelity to cultivation tropes and themes is a core requirement.

**Planning update, 2026-10-24:** the user endorsed the design direction and established the campaign anchor: rebuild a fallen sect as a home hub, increase its prosperity, and explore more of the world map as cultivators grow stronger. Peaceful activities belong in the game. A seamless open world is desirable for immersion but is not required. Detailed proposals and unresolved rules below still need refinement.

**Proposed scope, pending discussion:** private parties of 1–4 players; fully playable solo; real-time aerial combat; a connected set of authored regions and instanced secret realms; a finite campaign with repeatable endgame challenges. These are planning defaults, not approved production commitments.

The fantasy: begin as a vulnerable cultivator, discover a path through study and dangerous opportunities, form bonds and rivalries, and become powerful enough to leave permanent scars on the world. Cooperation should help cultivators pursue distinct paths rather than require identical progression.

This draft distinguishes existing systems from proposed systems. It sets no release date or staffing assumptions.

## 2. Design pillars

1. **Cultivation is the structure of play.** Realms change capabilities and social standing; breakthroughs need preparation and resolve a meaningful bottleneck.
2. **Power has physical consequences.** Flight, range, destruction, and enemy behavior communicate realm differences. Environments remain readable during spectacular attacks.
3. **Different paths can cooperate.** Players contribute through techniques, formations, preparation, control, and knowledge without mandatory tank/healer roles.
4. **Fortuitous encounters reward curiosity.** Ruins, hidden inheritances, spirit veins, dangerous bargains, and secret realms offer discoveries beyond map completion.
5. **The world responds.** Sects, rivals, obligations, and damaged places remember consequential choices within an explicit persistence model.

## 3. Core loops

**Moment to moment:** read terrain and enemies → maneuver in three dimensions → manage qi and techniques → exploit an opening → collect resources or uncover information.

**Expedition:** prepare at a settlement or sect → choose a lead, commission, or secret realm → travel and explore → overcome combat and environmental trials → decide whether to risk deeper exploration → return with resources, knowledge, and consequences.

**Sect restoration:** choose a restoration goal → seek resources, expertise, allies, or lost teachings → return and invest → restore a useful place and attract inhabitants → gain new opportunities → undertake a more ambitious expedition. Personal cultivation and sect development reinforce one another without requiring every guest to repeat the host's advancement.

**Cultivation:** obtain or interpret a manual → practice its methods → acquire compatible resources → resolve a bottleneck → prepare for a breakthrough → face a trial or tribulation → gain a new capability and new obligations.

**Campaign:** build relationships and reputation → discover why regional spiritual balance is failing → choose allies and methods → contest inheritances and spirit veins → confront the source of the severed heavens. This premise and all names remain proposals.

## 4. Cultivation rules and thematic fidelity

Use familiar xianxia concepts consistently, while acknowledging that novels differ in terminology and realm order. Maintain a project glossary rather than claiming a universal canon.

| Concept | Proposed gameplay expression | Guardrail |
| --- | --- | --- |
| Qi and spiritual energy | Combat reserve, ambient concentration, recovery and cultivation environments | Combat regeneration and long-term advancement are separate systems |
| Cultivation method | A primary path that shapes qi handling, affinities, strengths, and bottlenecks | More meaningful than selecting a damage color |
| Manuals and comprehension | Learn a technique, practice it, then unlock deliberate variations | Avoid hundreds of interchangeable skill drops |
| Realms and stages | Qi Gathering → Foundation Establishment → Golden Core → Nascent Soul for the initial scope | Higher realms belong to later scope decisions |
| Breakthrough | Required insight, sufficient accumulated cultivation, preparation, then a playable trial | Repeating ordinary kills alone cannot bypass every bottleneck |
| Tribulation | Telegraph-driven encounter testing the new realm's demands | Not every small stage needs a heavenly lightning trial |
| Pills and impurities | Powerful preparation with dosage limits and a recoverable drawback | No irreversible build ruin from an unexplained consumable |
| Spirit roots and affinities | Starting inclination with strengths and tradeoffs | No random character creation result that invalidates co-op participation |
| Dao comprehension | Later specialization earned through path-specific actions and choices | Define tangible mechanics before expanding abstract Dao statistics |
| Sects and karma | Teaching, protection, access, duties, debts, and consequences | No generic reputation bar detached from conduct |
| Secret realms | Bounded spaces with entry conditions, formations, inheritance trials, and valuable discoveries | Not merely randomized loot rooms |

Major realm gaps should remain intimidating. Equal-realm encounters emphasize skill; higher-realm enemies may require escape, a formation, environmental leverage, or later return. Do not silently normalize all enemies to the party. Telegraph threats before unavoidable commitment.

Foundation quality is a proposed bounded specialization choice, not a permanent hidden punishment. Players can repair mistakes through understandable effort. Cultivation should reward preparation without requiring idle waiting or real-world daily chores.

## 5. Characters, progression, and builds

Separate realm advancement, technique mastery, equipment, and faction standing. Each provides distinct rewards. Proposed character choices: appearance, name, starting affinity, and an initial method; narrative background can remain cosmetic until it earns a concrete role.

A build consists of one primary cultivation method, a limited equipped technique set, movement art, defensive art, equipment, and optional formation or profession support. Keep the prototype's three attack slots for the first expedition; test input capacity before expanding it.

Initial proposed paths:

- Sword cultivation: committed trajectories, precision, penetrating crescents, and sword intent.
- Qi arts: flexible ranged pressure, affinities, and area control.
- Body cultivation: close-range pressure, resilience, and physical commitment; must answer airborne foes.

Ship the first path pair before committing to all three. Formations and alchemy initially support expedition preparation; defer complete crafting professions until the core expedition is enjoyable. No mandatory healer; all builds have a viable solo recovery strategy. Shared success grants advancement credit, while optional mastery objectives recognize individual actions.

## 6. Combat and multiplayer rules

Preserve aerial inertia, manual altitude, optional rise-only clearance, assisted aiming, terrain interception, and committed area attacks. Expand enemy behavior around readable intent rather than raw health inflation. Proposed enemy roles: pursuer, ranged disciple, formation keeper, aerial predator, and a tribulation guardian.

**Friendly damage proposal:** disabled for player health in cooperative expeditions; allied terrain destruction still matters. PvP uses explicit consent and separate encounter rules. Destruction inside settlements and protected quest spaces requires defined limits communicated visually.

**Heavenly Step decision:** the current implementation slows the global battlefield while the local player uses a personal clock. That has no direct fair multiplayer interpretation. Proposed co-op replacement: personal speed and perception effects with everyone sharing one authoritative combat clock. No local slowing of authoritative enemies or projectiles. Prototype this before locking tuning. A party-wide slow is an alternative requiring explicit rules for stacking, consent, and PvP.

**Duels proposal:** consensual arena or designated-space matches, normalized optional preset alongside progression-based rules, clear stakes before acceptance, no item theft or permanent character loss. Start with 1v1; defer ranked matchmaking and team PvP. Duels and challenges reuse combat but have distinct scoring and reward policies.

Threats and rewards scale with party size through encounter composition first. Preserve realm identity; do not make a low-realm enemy secretly equal to a high-realm player. Bosses need multi-target patterns, clear altitude cues, recovery windows, and useful roles for multiple builds. Spectacle must retain target, hazard, and ally visibility.

## 7. Exploration and secret realms

World structure: the fallen sect is the persistent home hub, with a world map opening further exploration as the players grow stronger. Proposed implementation: large authored outdoor regions connected by explicit travel transitions, plus instanced secret realms. Flight and exploration are uninterrupted within each region. Exact region dimensions depend on performance and encounter density; the current arena size is not a final world-size decision.

Each persistent region retains its terrain changes when unloaded, revisited, or entered in a later session. Region transitions must never regenerate a scarred battlefield accidentally. Landmarks, distant scenery, departure/arrival routes, and stable geography should make separate regions feel part of one place. Seamless streaming remains a future option; region identity and persistence should not depend on it.

Reveal destinations through maps, rumors, sect knowledge, scouts, and story events. Distinguish discovering a place from being ready to survive it. Use spiritual pressure, dangerous terrain, formations, traversal capabilities, and informed NPC warnings to communicate increasing realm requirements. Avoid making every destination a locked menu button with a level number. Initial scope: sect grounds, one surrounding wilderness region, and one secret realm.

Discovery sources include rumors, commissions, visible landmarks, environmental clues, and interactions with factions. A secret realm has an entry condition, a distinct spatial rule, at least one noncombat problem, a guardian or trial, an inheritance choice, and a defined exit/failure policy.

Proposed first realm: a ruined formation sanctuary where disciples restore or redirect spiritual nodes, exposing alternate routes and determining the guardian's defenses. Its inheritance offers mutually exclusive technique variations with a later respecialization route.

Persistent scars are strongest in wilderness and owned worlds. Protect essential entrances and narrative objects against softlocks; offer a clear recovery mechanism for traversable routes. Instances may reset terrain on a new run, explicitly distinguished from persistent region damage.

### Fallen sect hub and prosperity

Confirmed fantasy: the home grows from ruined sect grounds into a prosperous cultivation community. The following facilities and rules are proposals for achieving it.

**Confirmed opening premise:** the protagonists are outsiders fleeing something who discover the fallen sect's ruins. They arrive seeking refuge, without inherited authority over the sect. What pursues them, their relationship to one another, and the cause of the sect's fall remain undecided.

Proposed opening sequence:

1. A brief playable flight from danger teaches movement and establishes vulnerability. Give the solo protagonist or co-op group a shared immediate objective without prescribing every character's background.
2. The fugitives discover ruined mountain grounds and find temporary shelter. Environmental clues establish that this was a cultivation sect and that its fall left unanswered questions.
3. A small local expedition secures the means to make the refuge habitable. The first restoration solves an immediate need, such as shelter or a damaged protective formation.
4. Finding a surviving teaching, spiritual resource, or promising route gives the group a reason to stay. Claiming responsibility for the place begins the restoration campaign.
5. The wider world gradually notices the renewed activity. The original danger remains a story thread, while the sect develops an identity shaped by its new inhabitants.

Keep the pursuit concrete enough to explain why the characters cannot simply return home. Avoid assuming that the pursuers caused the sect's fall or that the protagonists are secretly its chosen heirs; either connection requires a later story decision. Reuse the refuge and surrounding landscape throughout the campaign so the opening location becomes a recognizable home.

| Restoration | Visible change | Gameplay purpose |
| --- | --- | --- |
| Main hall and damaged records | Clear ruins, repair roofs, restore banners and archives | Establish identity, restoration goals, recovered history, and commissions |
| Spirit gathering formation | Repair nodes and renew spiritual circulation | Cultivation preparation and access to better practice conditions |
| Scripture pavilion | Recover shelves, manuals, and teaching spaces | Unlock methods, technique study, and lost inheritance leads |
| Herb garden and pill room | Cultivate spiritual plants and recruit an alchemist | Meaningful peaceful preparation and expedition consumables |
| Guest court and dwellings | Occupied homes, visiting cultivators, active courtyards | Recruit specialists and disciples; introduce relationships and opportunities |
| Training grounds | Restore practice formations and duel space | Build experiments, challenges, and consensual duels |

Prosperity should be visible through repaired architecture, healthier grounds, more inhabitants, activity, visitors, and stronger spiritual atmosphere. Track a small set of legible conditions such as spiritual infrastructure, supplies, population/expertise, and reputation; avoid a single currency that solves every restoration. An upgrade may need rare materials, a rescued specialist, a recovered formation diagram, or a faction agreement.

Proposed restoration stages: abandoned foothold → functioning refuge → established sect → flourishing sect. Each stage needs concrete visual and playable changes. Restoration unlocks opportunities and preparation; personal breakthroughs still require the cultivator's own insight and trials. Strong players may open routes through danger, while sect knowledge can reveal alternative access.

Peaceful play includes studying manuals, cultivation preparation, gardening, alchemy, conversations, recruitment, and choosing restoration priorities. Start with a few meaningful interactions. Background work advances through explicit active-play or expedition progress; no requirement to return at a real-world hour, and no offline decay while players are absent.

The sect belongs to the saved world. Guests can contribute, use unlocked facilities, and retain personal rewards; proposed spending permissions distinguish donations, ordinary shared spending, and major host-authorized restoration. Record contributions and apply each restoration once. Exact governance remains open.

Destruction and rebuilding need separate meanings. Wilderness scars remain until an explicit repair or authored recovery event. Hub ruins are authored restoration states; rebuilding a hall should not erase unrelated terrain damage. Proposed initial policy: protective sect formations prevent casual friendly attacks from destroying restored critical facilities. Raids, upkeep, happiness simulation, and repeated rebuilding losses are deferred until the restoration loop is proven.

## 8. Factions, story, and party decisions

Begin with two competing sect interests and one neutral settlement. Each needs a cultivation philosophy, a resource need, teachers, obligations, and a reason to cooperate or conflict. Reputation changes through identifiable actions and unlocks teachings, commissions, or access.

Proposed campaign arc: initiation and first inheritance → regional competition over damaged spirit veins → sect conflict and discovery of the fracture → a prepared ascent and final trial. Write the first chapter completely before expanding the rest. The initial antagonist should have motives grounded in scarcity, doctrine, or survival.

Anchor that arc in the fallen sect: establish a foothold → recover its teachings and recruit its first specialists → regain regional standing → discover the cause of its fall → decide what kind of sect will rise from it. The cause of the fall and the player's connection to it remain story decisions. Nearby factions should respond to the sect's increasing prosperity and influence.

Track personal character progression separately from world narrative state. Before consequential shared decisions, show the world owner and consequence. Proposed first-release rule: the host chooses irreversible world outcomes after a party discussion prompt; participants keep earned character rewards, but another host's quest flags are not silently overwritten. Replay and reward rules must prevent repeated quest duplication.

## 9. Multiplayer, ownership, and persistence

Proposed delivery: invite-only sessions with a host-owned world. Combat and rewards run on one authority. Local solo play uses the same authority interface. Select a transport and relay/deployment solution after a small networking spike; browser hosting cannot be assumed to work through NAT without supporting services.

The authority validates movement, casting, range, cooldowns, qi, inventory changes, rewards, and terrain mutations. Clients send intent, predict local movement, interpolate remote actors, and reconcile corrections. Seeded randomness helps testing but does not make client lockstep or network determinism automatically safe.

Persist three separate records: character progression/loadout; world/quest/faction/terrain state; user settings. Version schemas and provide migrations. Use stable entity and encounter IDs plus idempotent reward transactions. The existing terrain-only browser save must remain importable or be explicitly isolated from campaign saves.

World state includes sect facilities and restoration stages, shared treasury and contributions, recruited residents, prosperity conditions, discovered destinations and routes, and terrain mutations keyed by stable region ID. Only active regions need full simulation. Unloaded regions retain state without requiring a continuously simulated world; define time advancement explicitly before adding production systems.

Proposed disconnect rules: reconnect to the same running session with the last committed character state; authority resolves active attacks; no fresh reward grant on reconnect. Initially, host departure ends the session after a save opportunity. Host migration is deferred. Decide whether local character imports are trusted before any public competitive economy; private host authority alone does not establish anti-cheat security.

Join-in-progress requires a snapshot of actors, terrain, encounters, quest state, and a sequence boundary before deltas. Transfer terrain chunks with revisions and bounded budgets. Cap large attacks and effect replication. Never replicate every visual particle.

## 10. Presentation and usability

Retain the 2.5D presentation as the starting point; evaluate readability and renderer capacity before a full 3D engine decision. Use human-scale architecture and terrain to convey power. Build silhouettes, casting poses, and realm-specific sound language before increasing particle density.

Visual direction confirmed on 2026-10-24: the user requested a simpler painted direction informed by Tale of Immortal and enthusiastically endorsed the generated fallen-sect concept. Use soft organic foliage, weathered painted architecture/stone, restrained ink contours, and atmospheric mountains. Preserve luminous combat and physical destruction while reducing visible terrain facets. See [ART_DIRECTION.md](ART_DIRECTION.md) for the production rules and first art slice; the concept is not implemented gameplay.

Provide a compact combat HUD, party health/realm indicators, readable altitude/target feedback, journal, character/build screen, inventory, cultivation screen, map, faction relationships, and session screen. Reveal these through an onboarding expedition rather than exposing the current experiment controls as the RPG interface.

Include remappable inputs, adjustable assistance, motion/flash controls, volume controls, scalable text, color-independent warnings, pause in solo, and a clear multiplayer menu rule: opening a menu does not pause the session. The combat study remains available as a separate developer sandbox.

## 11. Release boundaries and content targets

These are proposed planning bounds, subject to playtests and available effort.

| Scope | Contents | Explicit boundary |
| --- | --- | --- |
| First co-op expedition | 1–2 players, hub, short outdoor route, one secret realm, two build variants, one boss, one meaningful advancement reward | Proves the loop and networking; not the full campaign |
| Alpha | Up to four players if performance permits, two paths, breakthrough trial, faction choices, repeatable challenge, consent-based duel | No ranked service or player economy |
| Initial complete game | Four existing realms, a small connected regional campaign, three proposed paths, several secret realms, ending, repeatable mastery challenges | Content counts follow a measured production budget |
| Later candidates | Extra realms, larger faction simulation, housing, deep professions, additional regions | Must not block the initial complete game |

Sect restoration and visible prosperity are core scope. Deep sect administration remains deferred: individual disciple schedules, large economic supply chains, political office management, and automated armies.

Out of initial scope: MMO population, seamless planet, auction house, open-world forced PvP, offline world simulation, procedural story promises, volumetric caves, and destructive mesh physics. Revisit only through an explicit scope change.

## 12. Existing foundation and limits

Verified on 2026-10-24: TypeScript check and all 60 tests pass. Current code provides a deterministic fixed-step combat study, one 512m square height-field arena, two actors, four selectable realms, three attacks, Heavenly Step, altitude and assistance, destructible cover and physical craters, terrain-only local persistence, and Canvas presentation. There is no campaign, inventory, character progression, faction system, multiplayer transport, session authority, or full character save yet.

The 4m single-surface height field cannot represent caves or overhangs. Current rival AI and actor assumptions need revision for parties. Current browser origin storage is not a multiplayer account system. Realm selectors, revival, and terrain reset are development controls rather than progression rules.

## 13. Decisions for the planning session

1. Confirm private 1–4 player sessions and solo support, or choose another population model.
2. Set the depth of peaceful sect activities and choose the first restoration projects; peaceful play and rebuilding are confirmed.
3. Choose the first two paths and how much manual/technique customization they need.
4. Set death stakes: proposed recoverable expedition loss, no permanent realm loss, checkpoint return.
5. Choose personal Heavenly Step or a carefully bounded shared slow.
6. Confirm host-owned story outcomes and portability of character progress.
7. Define which cultivation traditions and reference works should guide tone and terminology.
8. Decide target platform and visual ambition after multiplayer and rendering prototypes.

9. Define what the outsiders are fleeing, who remains in the ruins, and co-op authority over shared restoration. Their arrival as fleeing outsiders is confirmed.

Decision log, 2026-10-24: user endorsed the design and confirmed fallen-sect restoration, increasing prosperity, and strength-driven world-map exploration as the campaign structure. Seamless travel is an immersion ambition rather than a requirement. Affects milestones 0, 3–7. Large persistent connected regions are the recommended implementation, pending detailed scope agreement.

Decision log, 2026-10-24: user selected outsiders fleeing an unresolved danger and discovering the sect ruins as the opening premise. Shelter precedes the decision to rebuild. Affects the opening chapter, onboarding, and milestones 0 and 4. Pursuers and the sect's history remain open.
