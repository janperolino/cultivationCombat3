# Current project status

Updated 2026-10-24. Workflow proposal: [WORKFLOW.md](WORKFLOW.md).

Full milestone and phase status checklist: [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md#milestone-and-phase-checklist). Update it with this status file at phase handoff; future phase breakdowns remain provisional.

- Direction: co-op cultivation RPG; outsiders fleeing danger find sect ruins and choose to establish a new sect. Rebuilding and prosperity support world-map exploration.
- Art: user endorsed `docs/art/fallen-sect-direction-v1.png`; production rules in `docs/ART_DIRECTION.md`.
- Specifications: `docs/GAME_DESIGN.md`, `docs/IMPLEMENTATION_PLAN.md`, `docs/OPENING_CHAPTER.md`.
- Playable builds: original solo combat study (`npm run dev`) and separate loopback two-client sparring harness (`npm run spike`, http://127.0.0.1:5174 in two tabs). Opening chapter, cooperative team rules, and painted rendering are not implemented.
- Latest code: M1.P5 adds local motion prediction/reconciliation, remote interpolation, protocol-2 independent live actor frames during terrain paging, a browser network lab, and seeded two-client measurements. Combat/terrain remain authoritative; solo behavior is unchanged.
- Latest validation: 101 tests, TypeScript checking, build, seeded 50/100/150 ms RTT scenarios with jitter/loss, and two real browser clients under 100/150 ms profiles passed on 2026-10-24. Model harsh-profile p95 motion error 3.000 m and max correction 9.121 m expose tuning limits; all profiles settle with equal terrain and shared authority clocks. See M1.P5 handoff.
- M0.P1 complete: local Git baseline `943e923`; committed completion records and verified `backups/M0.P1-baseline.bundle`. Recovery coverage, exclusions, checks, and M1.P2 decision gate: [phase handoff](phases/M0.P1-baseline.md).
- M1.P5 complete: [responsive-client rules, measurements, and handoff](phases/M1.P5-responsive-clients.md). Next proposed phase: M1.P6, session recovery/idle/rejoin and host-departure policy. Write its precise brief before starting. M1 remains open; M1.P7 must review responsiveness limits.
- Spike decisions: two actors, one per local bearer connection identity supplied by the HTTP adapter; host-only assignment, reconnect generations, 60 Hz shared clock, neutral input after 15 ticks. Development transport: loopback HTTP polling. Open: production target platform, transport/hosting, production party size, ally/team rules, full recovery policies, and final multiplayer Heavenly Step feel.
- Chat organization: project hub `01a17000-ab53-7440-9602-5ac68322ba50`; user authorized M1.P2 through M1.P5 in this same implementation chat. Stop at M1.P5; future phase chats require user request.
