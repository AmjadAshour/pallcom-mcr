# MCR PRO — REST API & WebSocket Protocol Reference

All REST endpoints are versioned under `/api/v1`.

## Authentication Endpoints

### 1. `POST /api/v1/auth/login`
- **Rate Limit**: 10 attempts per 15 minutes.
- The request accepts only `email` and `password`. Passwords must contain 8 to 4,096 characters. Invalid shape or length returns HTTP 400.
- **Request Body**:
  ```json
  {
    "email": "operator@mcrpro.local",
    "password": "Password123!"
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "accessToken": "eyJhbGciOi...",
    "user": {
      "id": "usr-uuid",
      "email": "operator@mcrpro.local",
      "fullName": "Live Deck Operator",
      "role": "OPERATOR",
      "organizationId": "org-uuid",
      "permissions": ["station:control", "station:read"]
    }
  }
  ```
  Login sets HttpOnly `mcr_access_token` and `mcr_refresh_token` cookies. The example shows the JSON response for a programmatic client that sends neither browser origin headers (`Origin` or `Sec-Fetch-Site`) nor session cookies. Browser and cookie-based clients receive `success` and `user` and authenticate through the cookies.

### 2. `POST /api/v1/auth/refresh`
- Rotates access token and refresh token.
- Cookie clients can send an empty body. An originless programmatic client using JSON sends one `refreshToken` string of 1 to 4,096 characters. Invalid types, oversized values and extra JSON fields return HTTP 401 without rotating the session. A supplied refresh cookie takes precedence over JSON.
- Browser and cookie-based clients receive `{ "success": true }` and the rotated HttpOnly cookies. Programmatic clients satisfying the login header and cookie conditions also receive `accessToken` in JSON.

### 3. `POST /api/v1/auth/logout`
- Revokes active session, clears cookies, records audit entry.

The authentication router sends `Cache-Control: no-store` on its responses.

---

## Station Management Endpoints

- `GET /api/v1/stations`: List stations for authenticated organization.
- `GET /api/v1/stations/:id`: Retrieve single station (sensitive passwords masked).
- `POST /api/v1/stations`: Create station (OBS password encrypted using AES-256-GCM).
- `PATCH /api/v1/stations/:id`: Update station configuration.
- `DELETE /api/v1/stations/:id`: Delete station.

---

## OBS Control Endpoints

### 1. `POST /api/v1/stations/:id/scenes/switch`
- **Request Body**:
  ```json
  {
    "sceneName": "Cam 1 - Close Up",
    "preview": false
  }
  ```
- **Response `200 OK`**:
  ```json
  {
    "success": true,
    "message": "Switched Program to 'Cam 1 - Close Up' on Station 01"
  }
  ```

### 2. `POST /api/v1/stations/:id/stream/start` & `stop`
- Starts or stops output broadcast stream.

### 3. `POST /api/v1/stations/:id/record/start` & `stop`
- Starts or stops video recording.

### 4. `POST /api/v1/stations/:id/audio/volume`
- **Request Body**:
  ```json
  {
    "inputName": "Host Wireless Mic",
    "inputVolumeMul": 0.85
  }
  ```

### 5. `POST /api/v1/stations/:id/audio/mute`
- **Request Body**:
  ```json
  {
    "inputName": "Host Wireless Mic",
    "inputMuted": true
  }
  ```

---

## Device Pairing Endpoints

### 1. `POST /api/v1/pairing/generate`
- Generates single-use 8-character pairing code with 5-minute TTL.

### 2. `POST /api/v1/pairing/claim`
- Called by MCR Agent daemon to exchange pairing code for long-lived device token.

---

## WebSocket & Real-time Events

### Connection Endpoint
- Browser Dashboard: `ws://host:port/socket.io/?token=<JWT>`
- MCR Agent Outbound Tunnel: `ws://host:port/agent-ws?stationId=<ID>&token=<TOKEN>`

### Broadcast Event Names
- `station:status_changed`: Station transitioned between ONLINE / OFFLINE / DEGRADED.
- `station:telemetry`: Real-time FPS, CPU, memory, and dropped frame metrics.
- `obs:sceneChanged`: OBS Program scene switched.
- `obs:previewSceneChanged`: OBS Preview scene switched.
- `obs:streamStateChanged`: On-air streaming state changed.
- `obs:recordStateChanged`: Recording state changed.
