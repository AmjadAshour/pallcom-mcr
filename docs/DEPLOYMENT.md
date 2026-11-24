# Deployment

Follow the [existing deployment guide](../backend/docs/DEPLOYMENT_GUIDE.md) for TLS, secrets, SQLite volume and pairing. Before any production rollout, take a tested backup, verify compatible Agent versions in staging, and obtain deployment approval. Preserve the current OBS source and leave shared device configuration unchanged during tests. Verify API, WSS, dashboard login, Agent reconnect and Program status after an approved rollout.
