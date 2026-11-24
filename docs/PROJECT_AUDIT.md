# Project audit

Baseline audited on 2026-11-24. The root worktree already contained edits in README and the Windows Agent entry point and packaging files. Those edits were outside the implementation scope.

| Area | Evidence | Result |
|---|---|---|
| Frontend | `frontend/src/App.jsx`, `frontend/src/pages/`, `frontend/src/components/playout/` | React/Vite dashboards and existing OBS workflows. A UI control is not evidence of actual output. |
| API and realtime | `backend/src/index.js`, `presentation/routes/`, `infrastructure/realtime/socket-gateway.js` under `backend/src/` | Express, Socket.IO, organization-scoped RPC through Agent. |
| Persistence | `backend/src/infrastructure/repositories/repository-factory.js`, `database/sqlite.js` | Active repositories use SQLite. Existing Prisma/MySQL assets do not establish production MySQL parity. |
| Media and protocols | `backend/agent/src/media-library.js`, `backend/packages/obs-client/src/index.js` | File probing and OBS control. No independent ingress or encode pipeline. |
| Auth and deployment | `backend/src/infrastructure/security/`, `backend/infrastructure/docker/` | Argon2id, revocable sessions and TLS configuration. Production rollout and MFA require evidence. |
| Performance and logs | `backend/src/infrastructure/agent/`, `backend/src/presentation/controllers/audit.controller.js` | Station telemetry and operational logs. No representative load, tamper-resistance or 24/7 soak results. |

Baseline `npm test` using a temporary SQLite path passed 20 tests. No production broadcast or database was used. See [test plan](TEST_PLAN.md) and [feature matrix](FEATURE_MATRIX.md).
