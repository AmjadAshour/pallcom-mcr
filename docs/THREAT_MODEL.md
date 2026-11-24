# Threat model

| Actor or event | Asset at risk | Control and residual work |
|---|---|---|
| Unauthenticated client | Accounts and availability | Argon2id, session rotation, rate limits; add MFA and verified recovery |
| Malicious operator or stolen account | On-air Program, other tenants | Resource RBAC and audits; separate high-impact operator roles and strengthen audit integrity |
| Compromised station Agent | Event integrity and RPC availability | Station identity, schema/frame/backlog limits; rotate credentials and validate command results |
| Hostile media and manifests | Worker, private resources and storage | Local root confinement; enforce egress restrictions, parser isolation and quotas before remote intake |
| Lost network or telemetry | Continuity and operator trust | Transport watchdog, stale metrics and UI status; add media-derived health and verified backup |
| Supply chain incident | Deployed executable and secrets | Lockfile and audit; add SBOM, CI scanning, artifact signing and restore exercises |
