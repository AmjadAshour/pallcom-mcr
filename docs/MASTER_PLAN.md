# Master plan

Priority order is security, continuity, integrity, correctness, performance, maintainability, accessibility and visual design. Keep deployed OBS paths stable during development.

| Phase | Scope | Exit evidence |
|---|---|---|
| 00 | Inventory and baseline | Test run and 24-capability inventory |
| 01 | Security foundation | Session, RBAC, bounded Agent input, MFA/recovery and credential lifecycle |
| 02 | Worker control plane | Authenticated enrollment, lifecycle, typed commands, health and recovery |
| 03 | Media engine | Probe, decode, transform, encode and validate a real sample output |
| 04 | Continuity | Loss, freeze, black and silence detection with failover hysteresis |
| 05 | Monitoring | Measured metrics, alert delivery and customizable multiview |
| 06 | Live production | Switch, audio and graphics validation against Program |
| 07 | Media operations | In/out points, recording, replay, retention and output checks |
| 08 | Remote production | Guest, commentary, PTZ and return audio interoperability |
| 09 | Distribution | Routing, signed playback, ABR and manifest checks |
| 10 | Broadcast standards | Independent TS, DVB, SCTE-35 and caption verification; licensed CAS fixtures |
| 11 | Distributed nodes | Fleet identity, backup, restore and redundancy exercises |
| 12 | AI and automation | Offline evaluation and operator override |
| 13 | Production readiness | Security, backup/restore, load and 1/8/24/72-hour soak evidence |

Track implementation order and gating dependencies in [tasks](TASKS.md). Run a defensive review after each major phase.

## Current governing specification

The permanent [MASTER_REQUIREMENTS.md](../MASTER_REQUIREMENTS.md), [development plan](DEVELOPMENT_PLAN.md), and [current phase tracker](TASKS.md#current-master-specification-tracker) govern new work. The table above preserves the historical roadmap and does not grant approval to start a phase. Each phase requires explicit owner approval. The final redesign requires the separate Phase 17 gate.
