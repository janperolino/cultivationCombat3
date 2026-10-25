# Development workflow

Proposed on 2026-10-24 for focused milestone/phase sessions. Milestone scope lives in [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md); product intent lives in [GAME_DESIGN.md](GAME_DESIGN.md).

## Chat organization

- Project: Severed Heaven, pointing to this workspace.
- Project hub: overall direction, decisions, milestone index, and cross-milestone review. This planning chat can serve that role.
- One milestone hub chat at a time: plan its phases, track dependencies, review results, and decide whether exit criteria are met.
- One fresh implementation chat per phase: complete one bounded result, verify it, and write a concise handoff.

This is a logical hierarchy maintained through titles, chat links/IDs, and files. The currently available app tools treat chats as peers and do not expose nested chat folders. Do not assume one chat automatically inherits another's decisions. Prefer a fresh phase chat with a focused brief; fork only when the earlier conversation itself is needed.

Suggested titles: `SH — Project hub`, `SH — M1 hub — Co-op foundation`, `SH — M1.P2 — Session authority`.

Create chats only when the user explicitly requests them. Do not pre-create all future phase chats or start background work just to populate the structure.

## Phase contract

Before implementation, each phase brief states:

1. Objective and concrete deliverable.
2. Dependencies and relevant decisions.
3. Relevant source/design files to read.
4. Acceptance criteria and appropriate validation.
5. Scope boundaries and known risks.

Aim for one cohesive result that fits a focused session, rather than an arbitrary time quota. If interrupted, record partial progress accurately and continue that phase later. If it is too large, split remaining work into explicit phases; do not call unfinished acceptance criteria complete.

At the end, record changed behavior, files, checks and outcomes, unresolved issues, decisions, and the next phase's starting instructions. Include the phase chat ID/link when available. Keep handoffs compact and link to details rather than copying logs or whole designs.

## Durable context and collaboration

Maintain `docs/STATUS.md` as the short current-state entry point. Add detailed phase briefs/handoffs under `docs/phases/` when a phase is scheduled. Read status first, then the selected brief and only relevant design/code. Treat code and current verification as evidence if a historical handoff disagrees.

Use the milestone hub for decisions and review; keep routine implementation in phase chats. Initially run one implementation phase at a time in this shared checkout. Concurrent editing requires explicit coordination or isolated worktrees after version control is established.

Each phase includes its own verification. A milestone ends with an integration review against its exit criteria; completion of all named phase chats alone is insufficient. User feedback can reopen a phase or revise the plan.

## Initial milestone phase breakdown

Prerequisite M0.P1: establish version control/backup and resolve only decisions blocking the co-op spike. Unrelated story and content decisions can remain open.

| Phase | Deliverable | Completion evidence |
| --- | --- | --- |
| M1.P1 — Shared simulation inputs | Multiple controlled actors, shared clock, solo behavior preserved | Implemented in this planning chat; 63 tests, type check, build passed |
| M1.P2 — Session authority | Actor ownership, validated bounded commands, sequencing, stale-input policy | Reject invalid/unauthorized commands; deterministic authority tests |
| M1.P3 — Transport spike | Chosen local-development transport and two real clients sharing authority | Both clients move/cast and observe the same authoritative outcomes |
| M1.P4 — State replication | Join snapshot, ordered deltas, terrain revisions and bounded transfer | Late join and damaged terrain agree; no missing or duplicated changes |
| M1.P5 — Responsive clients | Local prediction/reconciliation and remote interpolation | Measured behavior under latency/jitter/loss; no combat-clock disagreement |
| M1.P6 — Session recovery | Disconnect/rejoin, idle actors, host departure behavior | Defined recovery scenarios pass without duplicate effects or state grants |
| M1.P7 — Integration review | Two-client combat/terrain demonstration and decision on the stack | Milestone 1 exit criteria reviewed, limitations recorded |

M1.P1 through M1.P5 are implemented. M1.P5 validation: 101 tests, type check/build, seeded network-condition measurements, and two impaired browser clients; see its [handoff](phases/M1.P5-responsive-clients.md). Loopback HTTP carries ordered terrain pages plus independent live frames for motion prediction/reconciliation and remote interpolation. Measured corrections/stalls remain for M1.P7 review. Internet hosting, full recovery, and friendly-fire/team policies are not implemented. Reward persistence belongs to later milestones; the spike must not claim to validate inventory transactions that do not exist.

The full milestone/phase checklist in `docs/IMPLEMENTATION_PLAN.md` is the authoritative phase index. Later phase entries are provisional: refine their scope and split large entries shortly before starting them. The table above explains M1 rather than defining a second roadmap. The first painted courtyard slice is indexed as M4.P5, with the endorsed art guide and destruction/readability checks.

## Usage-conscious defaults

Keep hubs concise, use fresh implementation chats, avoid importing long histories unnecessarily, reuse current verification results when no relevant changes occurred, and avoid idle background agents or repetitive status polling. Phase size should include enough context to finish coherently. Do not promise numerical usage savings or separate allowances for different chats.

Starter prompt:

> Work on phase M1.P2 only. Read docs/STATUS.md, docs/WORKFLOW.md, the phase brief, and relevant source files. Complete the deliverable and acceptance checks, update status and the phase handoff, and stop before the next phase. Flag decisions that require user input without expanding scope.
