# TikTok Subathon Timer + Saweria

Live countdown with a SvelteKit control dashboard, Node/Express API, SQLite persistence, Socket.IO updates, TikTok LIVE gifts, and Saweria HTTP webhook support.

The TikTok connection uses the community-maintained `tiktok-live-connector` package. It is an **unofficial** integration, not an official TikTok API; TikTok protocol changes or stream restrictions can interrupt it.

## Requirements

- Node.js 22.18+ and npm
- Linux VPS for production (no GPU required)
- A TikTok username that is currently live to test gift events
- Saweria HTTP webhook access and its stream key

## Local setup

```sh
cp .env.example .env
npm install
```

Set a unique `ADMIN_TOKEN` of at least 24 characters in `.env`. Configure `SAWERIA_STREAM_KEY` and `TIKTOK_USERNAME` when available. `HOST` defaults to `127.0.0.1`; set `TRUST_PROXY_HOPS=1` only when requests reliably pass through one trusted reverse proxy. Start both applications:

```sh
npm run dev
```

Open the dashboard at <http://localhost:5173>. Enter `ADMIN_TOKEN` at the login screen. The backend listens on port `3001`; the frontend receives its API URL from `VITE_API_URL`. For a remote deployment, set `VITE_API_URL` to the public HTTPS backend URL before building.

## Defaults and settings

| Setting | Default | Environment variable |
|---|---:|---|
| Initial timer | 60 minutes | `INITIAL_TIMER_MINUTES` |
| TikTok gift | 10 seconds per coin | `TIKTOK_COIN_SECONDS` |
| Saweria minimum | Rp1,000 | `SAWERIA_MINIMUM_RUPIAH` |
| Saweria denomination step | Rp1,000 | `SAWERIA_RUPIAH_STEP` |
| Time per Saweria step | 15 minutes | `SAWERIA_MINUTES_PER_STEP` |

Rules and TikTok username can also be updated from the authenticated dashboard and persist in SQLite. Saweria credits only full denomination steps after the minimum is met (e.g. Rp2,500 at defaults adds 30 minutes). Timer totals and transaction history persist across backend restarts.

## Build, test, run

```sh
npm test
npm run check
npm run build
```

Run the compiled backend from the repository root with `node backend/dist/server.js`. Run the SvelteKit Node server with:

```sh
cd frontend
node build
```

The frontend listens on port 3000 by default. Configure `PORT` for the backend and `PORT` / `HOST` for the adapter-node frontend as needed.

## Saweria webhook configuration

1. Set `SAWERIA_STREAM_KEY` in the server `.env`; never put it in `VITE_*` variables or the browser.
2. Set Saweria's HTTP webhook target to `https://your-domain.example/webhooks/saweria`.
3. Saweria sends `Saweria-Callback-Signature`. The backend validates HMAC-SHA256 using the official order-sensitive concatenation `version + id + amount_raw + donator_name + donator_email`, and uses a constant-time comparison.
4. Invalid signatures are rejected. Donation IDs are unique in SQLite so retries cannot credit twice. Below-minimum donations are acknowledged but do not change totals or timer.

Webhook requests are limited to 60/minute per source IP. The dashboard API is bearer-token authenticated and limited to 120/minute per source IP.

## OBS Browser Source

Add a Browser Source to OBS with URL `https://your-domain.example/overlay`. Use a 1920x1080 canvas (the overlay scales responsively). The page has a transparent background and listens for timer and alert events over Socket.IO. Keep the backend's `FRONTEND_ORIGINS` set to the frontend origin; the reverse proxy should forward WebSocket upgrade requests.

## Production deployment (Linux VPS)

1. Install Node.js 22.18+ and clone/copy this repository to `/opt/tiktok-subathon`.
2. From the project root, copy `.env.example` to `.env`, set a long random `ADMIN_TOKEN`, set `FRONTEND_ORIGINS=https://your-domain.example`, set `VITE_API_URL=https://your-domain.example`, and supply the Saweria stream key. Restrict `.env` permissions (`chmod 600 .env`).
3. Install and build with `npm ci && npm run build`. The persistent SQLite database defaults to `backend/data/subathon.sqlite`; use a durable writable directory and regular backups.
4. Create `/etc/systemd/system/subathon.service` using the example below, then run `systemctl daemon-reload && systemctl enable --now subathon`.
5. Configure Nginx as below, point DNS at the VPS, then enable HTTPS (for example `certbot --nginx -d your-domain.example`). Redirect HTTP to HTTPS.

### systemd service

```ini
[Unit]
Description=TikTok Subathon Timer
After=network.target

[Service]
Type=simple
User=subathon
Group=subathon
WorkingDirectory=/opt/tiktok-subathon
Environment=NODE_ENV=production
Environment=HOST=127.0.0.1
Environment=PORT=3001
Environment=TRUST_PROXY_HOPS=1
ExecStart=/usr/bin/node /opt/tiktok-subathon/backend/dist/server.js
Restart=on-failure
RestartSec=5
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Run the frontend Node adapter as a second systemd service or under the same process manager with `HOST=127.0.0.1`, `PORT=3000`, `WorkingDirectory=/opt/tiktok-subathon/frontend`, and `ExecStart=/usr/bin/node build`. Use the same non-root service account for SQLite access.

### Nginx reverse proxy

```nginx
server {
    listen 80;
    server_name your-domain.example;
    # Configure TLS certificates and redirect to HTTPS with Certbot.

    location /socket.io/ {
        proxy_pass http://127.0.0.1:3001/socket.io/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    location /webhooks/saweria {
        proxy_pass http://127.0.0.1:3001/webhooks/saweria;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:3001/api/;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Keep ports 3000 and 3001 bound to localhost/firewalled. Add the final HTTPS origin to `FRONTEND_ORIGINS`, rebuild after changing `VITE_API_URL`, then restart both services.

## Security notes

- Startup fails if `ADMIN_TOKEN` is missing, weak, or shorter than 24 characters.
- All `/api/*` routes require `Authorization: Bearer <ADMIN_TOKEN>`. The token is stored in the browser's local storage on the dashboard device; use a trusted device and HTTPS.
- Socket.IO events intentionally contain timer state and support alerts only. Never broadcast settings, stream keys, donor email, or authentication values.
- Saweria signature input and donation IDs are validated server-side; amounts submitted by dashboard clients are never accepted as contributions.
- Configure a strict production `FRONTEND_ORIGINS`, TLS, firewall, and OS-level backups/updates before exposing the service publicly.
