# Scheduler Recovery Plan (Phase Seven)

- Scheduler restart: execution state is persisted. Claimed occurrences are not replayed; occurrences whose window expired are logged `MISSED`.
- Lease: a competing executor cannot act while another holds an unexpired lease (5 s, renewed each tick).
- Worker crash: handled by the Phase Six supervisor (`WORKER_RECOVERY_PLAN.md`); the scheduler continues on the next tick.
- Bad publication: restore a previous revision with `POST .../scheduler/restore` (creates a new draft, optional immediate publish after re-validation).
- Rollback of this phase: stop schedulers (`STOP_SCHEDULER`), revert the Phase Seven code and drop the three scheduler tables (migration `20261128_0003`); Phase Six playout is unaffected.
