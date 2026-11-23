# MCR PRO — Deployment & Operational Guide

## Quick Start (Local Development)

1. Install dependencies with `npm install` on Node.js 22.13 or newer.
2. Create a local `.env` in the project root and set `MCR_ADMIN_PASSWORD` to your own password of at least 12 characters. Start the backend with `npm run dev:server`. On a fresh database it creates `admin@mcrpro.local`. If the administrator still uses the legacy default password, startup replaces that password with the configured one.
3. Start the web dashboard with `npm run dev:web` and open `http://localhost:5173`. To serve the production build from the local backend, run `npm run build:web` and open `http://127.0.0.1:4000`.
4. Sign in, add an OBS station, and pair the Agent using its station-specific code. For the desktop client, keep the local backend running and start the client with `npm run dev:desktop` after building the web dashboard.

---

## Production Deployment (Online Edition)

### Using Docker Compose

1. Set separate random values for `JWT_SECRET`, `REFRESH_TOKEN_SECRET`, and `ENCRYPTION_MASTER_KEY` in your local `.env` or deployment secret store. Generate each value independently:
```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```
Keep the existing private encryption key when redeploying against the same database. If you change it, existing station passwords must be saved again before pairing. Changing the JWT signing key invalidates existing access tokens and Agent pairings.

2. Set `MCR_PUBLIC_ORIGIN` to the exact HTTPS origin (for example `https://mcr.example.org`), and `MCR_TLS_DIRECTORY` to the host directory containing `fullchain.pem` and `privkey.pem`. Set private values for `MYSQL_ROOT_PASSWORD` and `MYSQL_PASSWORD`. Keep the certificate files outside the repository.
3. If upgrading an existing deployment, back up the SQLite database and migrate it into the Compose `mcr_sqlite` volume before starting the new stack. Existing dashboard users must sign in again after the session upgrade.
4. Launch Docker Compose:
```bash
docker compose --env-file .env -f backend/infrastructure/docker/docker-compose.yml up -d --build
```
This provisions:
- Internal MySQL and Node.js containers. The web application's SQLite data and sessions persist in the `mcr_sqlite` volume.
- Nginx serves HTTPS on port 443, redirects port 80 to HTTPS, and proxies Socket.IO and the Agent tunnel over WSS.

For account recovery, use the organization's approved administrative process and verify the operator's identity out of band. Dashboard sessions should be revoked before restoring account access. A dashboard self-service reset and MFA are outside the current deployment workflow.

---

## Installing MCR Agent on OBS Machines

Every computer running OBS Studio must have the lightweight MCR Agent daemon installed:

1. Enable OBS Studio WebSocket v5:
   - In OBS Studio, open **Tools** -> **WebSocket Server Settings**.
   - Check **Enable WebSocket server**.
   - Default Server Port: `4455`.

2. Generate a Pairing Code in MCR PRO Dashboard:
   - Add the station in **Stations** with its OBS WebSocket port and password. Navigate to **Settings** → **MCR Agent Device Pairing** and select that station.
   - Click **Generate New** to receive an 8-character single-use code (e.g. `MCR-89A4`).

3. Pair the Machine:
   ```bash
   node backend/agent/src/index.js pair --code MCR-89A4 --server https://<MCR_SERVER_HOST>
   ```

4. Launch the Agent:
   ```bash
   node backend/agent/src/index.js start
   ```
   The Agent connects to OBS on loopback using the configured port. Use an HTTPS MCR URL for a remote Agent so its outbound WebSocket uses WSS. Previously paired Agents must pair again after upgrading to the signed station credentials.

