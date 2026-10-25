# Current project status

Updated 2026-10-24. Workflow proposal: [WORKFLOW.md](WORKFLOW.md).

Full milestone and phase status checklist: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md#milestone-and-phase-checklist). Update it with this status file at phase handoff; future phase breakdowns remain provisional.

- Direction: co-op cultivation RPG; outsiders fleeing danger find sect ruins and choose to establish a new sect. Rebuilding and prosperity support world-map exploration.
- Art: user endorsed `docs/art/fallen-sect-direction-v1.png`; production rules in `docs/ART_DIRECTION.md`.
- Specifications: `docs/GAME_DESIGN.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/OPENING_CHAPTER.md`.
- Playable build: combat study. Opening chapter and painted rendering are not yet implemented.
- Latest code: M1.P2 adds `SessionAuthority` with host-assigned actor ownership, validated bounded commands, connection generations, sequencing, one-shot actions, and 250 ms stale-input handling over `World.stepPlayers`. Solo browser behavior is unchanged; no network clients are connected.
- Latest validation: 75 tests (63 regression + 12 authority), TypeScript checking, build, and emitted authority module smoke check passed on 2026-10-24. M0.P1 recovery validation remains recorded in its handoff.
- M0.P1 complete: local Git baseline `943e923`; committed completion records and verified `backups/M0.P1-baseline.bundle`. Recovery coverage, exclusions, checks, and M1.P2 decision gate: [phase handoff](phases/M0.P1-baseline.md).
- M1.P2 complete: [phase rules and handoff](phases/M1.P2-session-authority.md). Next proposed phase: M1.P3, select a development transport and connect two real clients; write its brief before starting.
- Spike decisions: two actors, one per authenticated client identity supplied by a future adapter; host-only assignment, reconnect generations, 60 Hz shared clock, neutral input after 15 ticks. Open: target platform, transport/hosting, production party size, ally/team rules, full recovery policies, and final multiplayer Heavenly Step feel.
- Chat organization: project hub `01a17000-ab53-7440-9602-5ac68322ba50`; user authorized M1.P2 in this same implementation chat. Stop at M1.P2; future phase chats require user request.
