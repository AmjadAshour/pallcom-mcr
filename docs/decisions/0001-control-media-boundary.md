# ADR 0001 — Preserve OBS control and isolate new media work

Status: accepted for the initial implementation.

Keep OBS control behind the Agent and add a separately bounded worker adapter for future ingest/output pipelines. Node owns control, not frame processing. Retain SQLite in the single-node path until distributed persistence requirements and a tested migration justify another repository implementation. This preserves current station workflows and gives worker rollout an independent rollback. The first media candidate is an offline, reproducible local source before enabling network ingress.
