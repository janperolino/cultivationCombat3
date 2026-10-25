> Historical browser-era reference, preserved 2026-10-25. Future edits and product decisions live in the [native version](../../cultivationGame3-Godot/new-game-project/docs/OPENING_CHAPTER.md) and [native roadmap](../../cultivationGame3-Godot/plan.md). Old technical/current-state statements below are historical.

# Opening chapter — A Place to Stay

Working specification · 2026-10-24 · [Game design](GAME_DESIGN.md) · [Art direction](ART_DIRECTION.md)

## Intent and confirmed premise

Outsiders fleeing danger discover a fallen sect's ruins. Shelter becomes a home, and the fugitives decide to establish their own sect here. This premise is user-confirmed. Names, dialogue, encounters, resources, and timing below are proposed implementation details.

The chapter proves one complete loop: arrive → explore → recover something useful → restore protection → discover a future here → choose to found a sect. Proposed first-play target: 20–30 minutes, measured through playtests. One or two players first; the design should accommodate the proposed four-player ceiling later.

## Story boundaries

Players should understand the immediate danger before they reach the ruins. Its larger origin can remain a mystery. For the first playable version, refer to the threat as the pursuit and use temporary dialogue; choose its actual identity before recording or finalizing narrative assets. Do not imply that the protagonists caused the sect's fall, are its heirs, or are destined owners of its inheritance.

The group establishes a new sect in an old sect's ruins. Discovering an old manual does not transfer ownership of that sect's identity or resolve its history. The decision to stay is explicit. Naming and choosing the new sect's doctrine can follow after the chapter; no forced canonical name.

## Play spaces

Start with one continuous hub-and-outskirts region, then a small separate formation-sanctuary instance. The initial region's dimensions are determined by traversal and readability tests. Keep landmarks compact enough that novice flight does not become empty travel.

| Place | Purpose | Spatial requirement |
| --- | --- | --- |
| Mountain approach | Arrival, flight and altitude introduction | Clear route to shelter; visible destination; recoverable falls or collision mistakes |
| Broken gate and courtyard | Establish the place and its scale | Broad ground visible from the gate; damaged formation in view |
| Main hall | Shelter, safe checkpoint, story interactions | Readable entrance, interior or accessible sheltered area; roof cutaway as needed |
| Old formation platform | First restoration and later home landmark | Three readable nodes; one focal interaction; usable surrounding space |
| Overgrown grounds | Quiet discovery and peaceful interaction | Herb patch, remnants of former residents, optional clue |
| Wilderness loop | Resource expedition and combat | Two routes around cover, height variation, persistent destructible terrain |
| Formation sanctuary | Small secret realm and encounter | Entrance remains recoverable; puzzle, guardian, diagram, explicit exit |

Layout relation: approach → gate → courtyard/main hall; courtyard → overgrown grounds → wilderness → sanctuary entrance. The expedition loops back toward familiar landmarks. Mountain backgrounds and unplayable scenery must be distinct from traversable ground; a painted cliff is not permission to remove collision feedback.

## Playable beats and objectives

### 1. Reach the ruins

Opening objective: find shelter beyond the ridge. Introduce movement, altitude assistance, and one evasive action through a short approach. Show evidence of pursuit through sound, distant figures, or environmental danger; no unimplemented scripted army. The first version ends the immediate chase at a defensible passage rather than invoking a mysterious fully functioning ward that contradicts the broken formation.

Failure returns to the approach checkpoint. A slow or inexperienced partner must not repeatedly fail the whole party through an invisible timer.

### 2. Secure temporary shelter

Enter the main hall and establish a checkpoint. Inspect the formation and learn that it can be repaired. Let players explore the quiet grounds, collect one useful herb, and inspect one optional history clue. No recruitable resident is required to explain everything; a damaged diagram or inscription can communicate the immediate repair goal.

Proposed dialogue intent: relief, uncertainty, then practicality. Example placeholder: “The roof will hold. The gate won't. Let's see what still works.” Keep the language natural; no long lore lecture before movement.

### 3. Recover the means to restore protection

Objectives: obtain repair stone from the nearby grounds, recover a charged spirit fragment, and retrieve the missing formation diagram from the sanctuary. Names and counts are tuning data. Use a small fixed requirement set, with quest resources protected from accidental consumption or inventory loss.

One wilderness fight teaches cover, altitude, and a committed enemy attack. Do not assume the exhausted fugitives should cast the prototype's highest-realm battlefield attacks. Keep high-realm powers available in the combat study while the chapter uses an appropriate early progression loadout.

The sanctuary entrance is discovered through a visible spiritual disturbance and a clue from the ruined grounds. For the initial puzzle, redirect two formation nodes to expose the guardian's defense. Interactions remain legible solo; avoid simultaneous switches that demand multiple players. A guardian encounter tests maneuvering and one technique opening rather than damage endurance.

### 4. Restore the protective formation

Return, contribute resources, inspect the outcome, and activate the restoration once. Replicate contribution and completion to all party members. The first repair restores limited refuge protection; it does not instantly rebuild all architecture or guarantee safety against every future enemy.

Visible change: the broken nodes align, a restrained jade current connects them, dormant lanterns illuminate the sheltered hall, and part of the courtyard becomes maintained. Preserve the general ruin silhouette so future restoration has room to matter. Wilderness scars remain exactly where the party left them.

### 5. Choose a future here

A recovered foundational manual suggests a viable cultivation path. Players discuss staying and founding their own sect. Proposed dialogue intent: agency and hope, grounded in what they just repaired. Example placeholder: “We could keep running.” / “Or give ourselves somewhere to return to.”

Show the founding decision and its world ownership clearly. Proposed initial co-op policy: the host commits the world decision after all present players see it; no timed choice and no silent guest resource spending. A guest joining later sees the founded state without repeating the reward transaction.

End with a world-map lead to a spirit vein or a potential recruit. This is an invitation to the next chapter; no promise that every destination is already implemented. The first chapter does not require a full naming interface, faction simulation, or recruiting system.

## State and rewards

Proposed state sequence: `arrival` → `sheltered` → `repair_known` → `sanctuary_open` → `diagram_recovered` → `ward_restored` → `sect_founded`.

Optional herb/clue discoveries are independent flags. Resource collection and sanctuary completion may happen in different orders; derive objective availability from facts rather than forcing a brittle linear script. Every unique resource and reward has a stable ID. Record resource spending, restoration, rewards, and completion together so reloads cannot charge twice or duplicate items.

Personal rewards: a learned foundational teaching and appropriate cultivation progress. World rewards: restored refuge formation, a sect founding record, a new route lead. Exact reward values remain tuning decisions. No permanent realm loss or item theft is assumed by this chapter specification.

## Solo, co-op, and recovery

- One authoritative world owns terrain, quest facts, shared contributions, and restoration. Each player owns personal progression under the agreed save policy.
- Entering the sanctuary initially uses a party-ready transition; define cancellation and disconnected-player handling. Party splitting into independently simulated regions is deferred.
- Wiping returns the party to its latest checkpoint and resets active encounter state under explicit rules. Earned unique objectives remain committed; recoverable combat resources follow the eventual death policy.
- Reconnect restores the current chapter state, not an independent replay of every past scene. Host departure saves or recovers the last commit under the session policy.
- Critical objectives cannot be destroyed, buried permanently, or launched out of bounds. Provide a diegetic recovery interaction or explicit checkpoint recovery for missing quest objects.

## Art and audio needs

Use the approved concept in [the art guide](ART_DIRECTION.md). Minimum environment kit: main hall with ruin/restored accents, gate pieces, courtyard/steps, formation platform and three node states, tree and stone variants, herb patch, sanctuary entrance, painted distant mountains. Keep collision and ground height separate from decorative textures.

First characters: two readable traveler variants and one guardian family. First audio: approach wind, distant pursuit cue, courtyard ambience, shelter warmth, formation interaction/activation, and guardian signals. Music can be deferred until sound and pacing communicate the emotional shift.

## Completion criteria

The chapter is complete when a fresh solo player and a fresh co-op group can arrive, understand the repair goal, find the sanctuary, resolve its puzzle/fight, restore the refuge, and choose to found a sect without developer intervention. Test objective order variation, disconnect during restoration, reload after each commit, duplicate completion input, destruction near objectives, party wipe, and a guest joining after founding.

Players should recognize both the original ruined courtyard and the change they caused. Returning from the expedition should feel safer and more hopeful. Measure that response through playtesting rather than treating the written intent as proof.

## Build order

1. Prove two controlled actors and one shared combat clock in the simulation; then connect two real clients.
2. Greybox the approach, hub, route, and sanctuary; implement chapter facts and checkpoints.
3. Complete the resource-to-restoration transaction and founding interaction.
4. Apply the painted style to one small courtyard scene; verify altitude, targeting, and destruction remain legible.
5. Extend the proven environment kit across the chapter, add narrative/audio, and playtest solo/co-op recovery.

Do not wait for a complete art library to test the chapter, and do not label a generated concept as implemented gameplay.
