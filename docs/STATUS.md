# Current project status

Updated 2026-10-24. Workflow proposal: [WORKFLOW.md](WORKFLOW.md).

Full milestone and phase status checklist: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md#milestone-and-phase-checklist). Update it with this status file at phase handoff; future phase breakdowns remain provisional.

- Direction: co-op cultivation RPG; outsiders fleeing danger find sect ruins and choose to establish a new sect. Rebuilding and prosperity support world-map exploration.
- Art: user endorsed `docs/art/fallen-sect-direction-v1.png`; production rules in `docs/ART_DIRECTION.md`.
- Specifications: `docs/GAME_DESIGN.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/OPENING_CHAPTER.md`.
- Playable builds: original solo combat study (`npm run dev`) and separate loopback two-client sparring harness (`npm run spike`, http://127.0.0.1:5174 in two tabs). Opening chapter, cooperative team rules, and painted rendering are not implemented.
- Latest code: M1.P4 adds versioned join snapshots, sequenced/acknowledged state pages, bounded terrain deltas, atomic client commits, retry/resync handling, and received/applied input receipts to the two-client local host. Each terrain page is limited to 256 cells and 64 KiB. Solo behavior is unchanged.
- Latest validation: 92 tests (63 original + 12 authority + 9 replication + 8 real HTTP transport), TypeScript checking, and build passed on 2026-10-24. Whole-world damaged terrain, sparse/during-transfer updates, retries/gaps/recovery, receipts, and two real browser clients including late join were verified; see M1.P4 handoff.
- M0.P1 complete: local Git baseline `943e923`; committed completion records and verified `backups/M0.P1-baseline.bundle`. Recovery coverage, exclusions, checks, and M1.P2 decision gate: [phase handoff](phases/M0.P1-baseline.md).
- M1.P4 complete: [replication rules and handoff](phases/M1.P4-state-replication.md). Next proposed phase: M1.P5, local prediction/reconciliation, remote interpolation, and measured latency/jitter/loss behavior. Write its precise brief before starting. M1 remains open.
- Spike decisions: two actors, one per local bearer connection identity supplied by the HTTP adapter; host-only assignment, reconnect generations, 60 Hz shared clock, neutral input after 15 ticks. Development transport: loopback HTTP polling. Open: production target platform, transport/hosting, production party size, ally/team rules, full recovery policies, and final multiplayer Heavenly Step feel.
- Chat organization: project hub `01a17000-ab53-7440-9602-5ac68322ba50`; user authorized M1.P2 through M1.P4 in this same implementation chat. Stop at M1.P4; future phase chats require user request.
