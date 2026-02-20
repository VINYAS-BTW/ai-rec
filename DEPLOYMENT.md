# AI-REC – Ubuntu server deployment guide

Deploy on a **fresh Ubuntu server** with your port forwarding.  
Use **122.166.250.176** for SSH and **203.192.243.34** as the public IP for browsers/APIs.

---

## Port mapping (router → server)

| Service        | Server port | External port | Public URL                    |
|----------------|-------------|---------------|-------------------------------|
| SSH            | 22          | 1401          | (SSH only)                    |
| Auth (Node)    | 8080        | 1402          | http://203.192.243.34:1402    |
| ML/Back2 (FastAPI) | 8000   | 1403          | http://203.192.243.34:1403    |
| Webhooks (Node)| 3001        | 1404          | http://203.192.243.34:1404    |
| Frontend (Vite) | 5173       | 1405          | http://203.192.243.34:1405    |
| HTTP (optional) | 80         | 1406          | http://203.192.243.34:1406    |

---

## 1. SSH into the server

From your PC:

```bash
ssh -p 1401 your_username@122.166.250.176
```

(Replace `your_username` with the Ubuntu user you use for SSH.)

---

## 2. Update system and install basics

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git build-essential
```

---

## 3. Install Node.js (LTS)

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v   # should show v20.x
npm -v
```

---

## 4. Install Python 3.11+ and pip

```bash
sudo apt install -y python3 python3-pip python3-venv
python3 --version   # 3.11 or higher preferred
```

---

## 5. Clone the project (or upload it)

**Option A – Git**

```bash
cd ~
git clone <YOUR_REPO_URL> ai-rec
cd ai-rec
```

**Option B – Upload from your PC**

From your Windows machine (PowerShell), from the folder that contains `ai-rec`:

```powershell
scp -P 1401 -r ai-rec your_username@122.166.250.176:~/
```

Then on the server:

```bash
cd ~/ai-rec
```

---

## 6. Backend – Auth service (port 8080)

```bash
cd ~/ai-rec/backend/auth
npm install
```

Create/edit `.env`:

```bash
nano .env
```

Contents (adjust if you use different DB or secrets):

```env
PORT=8080
DATABASE_URL=postgresql://USER:PASSWORD@YOUR_NEON_HOST/YOUR_DB?sslmode=require&channel_binding=require
JWT_SECRET="your-strong-secret-here-change-in-production"
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
AUTH_BASE_URL=http://122.166.250.176:1402
FRONTEND_URL=http://122.166.250.176:1406
CORS_ORIGINS=http://122.166.250.176:1406
```

Run DB migrations (Drizzle):

```bash
npm run db:migrate
```

Test run:

```bash
npm start
```

You should see: `Auth service running at http://localhost:8080`. Stop with `Ctrl+C`.

---

## 7. Backend – Webhooks service (port 3001)

Open a second SSH session (or use a terminal multiplexer like `tmux`). Then:

```bash
cd ~/ai-rec/backend/webhooks_services
npm install
```

Create/edit `.env`:

```bash
nano .env
```

```env
PORT=3001
DATABASE_URL=postgresql://USER:PASSWORD@YOUR_NEON_HOST/YOUR_DB?sslmode=require&channel_binding=require
CORS_ORIGINS=http://203.192.243.34:1405,http://203.192.243.34:1406,http://122.166.250.176:1405
```

Migrations:

```bash
npm run db:migrate
```

Test:

```bash
npm start
```

You should see: `Webhook service running at http://localhost:3001`. Stop with `Ctrl+C`.

---

## 8. Backend – ML / FastAPI (back2, port 8000)

```bash
cd ~/ai-rec/backend/back2
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Create/edit `.env`:

```bash
nano .env
```

```env
DATABASE_URL=postgresql://USER:PASSWORD@YOUR_NEON_HOST/YOUR_DB?sslmode=require&channel_binding=require
MLFLOW_TRACKING_URI=postgresql://USER:PASSWORD@YOUR_NEON_HOST/YOUR_DB?sslmode=require&channel_binding=require
JWT_SECRET=your-strong-secret-here-change-in-production
WEBHOOK_SERVICE_URL=http://127.0.0.1:3001
CORS_ORIGINS=http://203.192.243.34:1405,http://203.192.243.34:1406,http://122.166.250.176:1405
```

Optional (for server-to-server): set `BACK2_INTERNAL_KEY` to a shared secret if your webhook service calls back2 with `X-Internal-Key`.

Test (with venv active):

```bash
uvicorn saas_api:app --host 0.0.0.0 --port 8000
```

You should see Uvicorn listening on 8000. Stop with `Ctrl+C`.

---

## 9. Frontend – Build and serve

Build the frontend with **production API URLs**:

```bash
cd ~/ai-rec/frontend/s
npm install
```

Create a `.env.production` (Vite uses this for `npm run build`):

```bash
nano .env.production
```

```env
VITE_AUTH_API_URL=http://203.192.243.34:1402
VITE_ML_API_URL=http://203.192.243.34:1403
VITE_WEBHOOK_API_URL=http://203.192.243.34:1404
```

Build:

```bash
npm run build
```

To **serve** the built app you can use either:

- **Option A – Vite preview (port 5173)**  
  Serves the built files on 5173 (maps to external 1405):

  ```bash
  npm run preview -- --host 0.0.0.0 --port 5173
  ```

- **Option B – Nginx on port 80 (external 1406)**  
  Install nginx and point it at the built files (see section 11).

---

## 10. Run everything with PM2 (recommended)

So all services restart on reboot and run in the background:

```bash
sudo npm install -g pm2
```

**Auth (8080):**

```bash
cd ~/ai-rec/backend/auth
pm2 start index.js --name auth
```

**Webhooks (3001):**

```bash
cd ~/ai-rec/backend/webhooks_services
pm2 start server.js --name webhooks
```

**Back2 (8000)** – use the venv’s Python:

```bash
cd ~/ai-rec/backend/back2
pm2 start "venv/bin/uvicorn saas_api:app --host 0.0.0.0 --port 8000" --name back2 --interpreter none
```

**Frontend (5173)** – serve the build:

```bash
cd ~/ai-rec/frontend/s
pm2 start "npm run preview -- --host 0.0.0.0 --port 5173" --name frontend
```

Save the process list and set startup:

```bash
pm2 save
pm2 startup
# Run the command it prints (usually with sudo)
```

Useful PM2 commands:

```bash
pm2 status
pm2 logs
pm2 restart all
pm2 stop all
```

---

## 11. (Optional) Nginx on port 80 (external 1406)

If you want the main site on port 80 (mapped to 1406):

```bash
sudo apt install -y nginx
```

Create a site config:

```bash
sudo nano /etc/nginx/sites-available/ai-rec
```

Example (serves frontend build and proxies APIs; adjust paths if needed):

```nginx
server {
    listen 80 default_server;
    server_name _;
    root /home/YOUR_USERNAME/ai-rec/frontend/s/dist;
    index index.html;
    location / {
        try_files $uri $uri/ /index.html;
    }
    location /auth/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
    location /api/ {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Replace `YOUR_USERNAME` with your Ubuntu username. Enable and reload:

```bash
sudo ln -s /etc/nginx/sites-available/ai-rec /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Then you can use **http://203.192.243.34:1406** as the main app URL. In that case you’d set your frontend’s production env to use the same host and these paths (e.g. `VITE_AUTH_API_URL=http://203.192.243.34:1406` for auth under `/auth/`) or keep using the direct ports 1402/1403/1404 if the frontend is built with those.

---

## 12. Firewall (optional but recommended)

Allow SSH (1401), your app ports, and nginx if used:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 8080/tcp
sudo ufw allow 8000/tcp
sudo ufw allow 3001/tcp
sudo ufw allow 5173/tcp
sudo ufw allow 80/tcp
sudo ufw enable
sudo ufw status
```

Note: port forwarding is on your router; the server firewall only needs to allow the **internal** ports (22, 8080, 8000, 3001, 5173, 80).

---

## 13. Quick checklist

- [ ] SSH: `ssh -p 1401 user@122.166.250.176`
- [ ] Auth: http://203.192.243.34:1402 (e.g. GET `/` → “pong”)
- [ ] Webhooks: http://203.192.243.34:1404 (e.g. GET `/health` → `{"ok":true,"service":"webhooks"}`)
- [ ] Back2: http://203.192.243.34:1403/docs (FastAPI Swagger)
- [ ] Frontend: http://203.192.243.34:1405 (or 1406 if nginx is used)
- [ ] All three `.env` files have `CORS_ORIGINS` including `http://203.192.243.34:1405` (and 1406 if used)
- [ ] Frontend `.env.production` has `VITE_AUTH_API_URL`, `VITE_ML_API_URL`, `VITE_WEBHOOK_API_URL` pointing at 203.192.243.34:1402, 1403, 1404
- [ ] `JWT_SECRET` is the same in auth and back2
- [ ] Google OAuth: see section below for production redirect URI and env vars

---

## 14. Google OAuth on the server (fix “OAuth isn’t working”)

For “Sign in with Google” to work in production, two things must be correct.

### 14.1 Auth service `.env` (on the server)

In `backend/auth/.env` you **must** set:

```env
AUTH_BASE_URL=http://122.166.250.176:1402
FRONTEND_URL=http://122.166.250.176:1406
```

- **AUTH_BASE_URL** = public URL of the auth service. Google will redirect the user to `AUTH_BASE_URL/auth/google/callback`. So it must be exactly the URL where your auth app is reachable (e.g. `http://122.166.250.176:1402`).
- **FRONTEND_URL** = public URL of the frontend. After OAuth, the auth service redirects the user to `FRONTEND_URL/oauth-success?token=...` or `FRONTEND_URL/login`. So it must be the URL where users see your app (e.g. `http://122.166.250.176:1406`).

If you use a different IP or port, change the values accordingly (no trailing slash).

Then restart the auth process:

```bash
pm2 restart auth
```

### 14.2 Google Cloud Console – Authorized redirect URI

Google only allows redirects to URIs you explicitly add.

1. Open [Google Cloud Console](https://console.cloud.google.com/) → your project.
2. Go to **APIs & Services** → **Credentials**.
3. Open your **OAuth 2.0 Client ID** (Web application type).
4. Under **Authorized redirect URIs**, add exactly:
   ```text
   http://122.166.250.176:1402/auth/google/callback
   ```
5. Save.

If your public IP or auth port is different, the redirect URI must match (e.g. `http://YOUR_IP:1402/auth/google/callback`). No trailing slash.

### 14.3 Quick check

- From the server: `curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080/auth/google` should get a **302** (redirect to Google).
- In the browser, open `http://122.166.250.176:1406`, click “Sign in with Google”; you should go to Google, then after signing in come back to your app. If you get “redirect_uri_mismatch”, the redirect URI in Google Console does not exactly match what the auth service sends (check AUTH_BASE_URL and the value in Google).

---

## 15. If you use a domain later

- Point the domain’s A record to **203.192.243.34**.
- In each backend `.env`, add `https://yourdomain.com` to `CORS_ORIGINS`.
- In frontend `.env.production`, set the `VITE_*` URLs to `https://yourdomain.com` (and configure nginx with SSL, e.g. Certbot).

You’re done. For a quick test, open **http://203.192.243.34:1405** (or 1406) and log in; the app will call auth (1402), webhooks (1404), and ML (1403) via the built-in URLs.

---

## 16. Troubleshooting: "Connection timed out"

If the browser or `curl` shows **connection timed out** when opening `http://203.192.243.34:1405` (or 1402/1403/1404), the request is not reaching the server. Work through these checks.

### A. On the server – check that apps are listening

SSH in and run:

```bash
# List what's listening on your app ports (should show 0.0.0.0:PORT or :::PORT)
ss -tlnp | grep -E '5173|8080|8000|3001'
```

You want to see lines like:
- `0.0.0.0:5173` or `:::5173` (frontend)
- `0.0.0.0:8080` (auth)
- `0.0.0.0:8000` (back2)
- `0.0.0.0:3001` (webhooks)

If a port is missing, that service isn’t running or is bound only to `127.0.0.1`. Start it with PM2 or run it manually with `--host 0.0.0.0` (or equivalent).

**Quick local test on the server:**

```bash
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:5173
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8080
```

If these return `200` or `304`, the apps are fine; the problem is network or firewall.

### B. Server firewall (UFW)

If UFW is active, it must allow the **internal** ports (the ones the app listens on), not the external router ports:

```bash
sudo ufw status
```

If `Status: active`, ensure you have:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 8080/tcp
sudo ufw allow 8000/tcp
sudo ufw allow 3001/tcp
sudo ufw allow 5173/tcp
sudo ufw allow 80/tcp
sudo ufw reload
```

Then test again from your PC.

### C. Router port forwarding

Port forwarding must send **external port → server’s LAN IP and internal port**:

| External (router) | Forward to (server on LAN) |
|-------------------|----------------------------|
| 1401 | `SERVER_LAN_IP:22` |
| 1402 | `SERVER_LAN_IP:8080` |
| 1403 | `SERVER_LAN_IP:8000` |
| 1404 | `SERVER_LAN_IP:3001` |
| 1405 | `SERVER_LAN_IP:5173` |
| 1406 | `SERVER_LAN_IP:80` |

- Find the server’s LAN IP on the server: `hostname -I | awk '{print $1}'` or `ip addr`.
- In the router admin, set each rule to this IP and the **internal** port (e.g. 1405 → `192.168.x.x:5173`).
- Save and reboot the router if needed. Some routers have a separate "firewall" that can block forwarded ports; temporarily disable it to test.

### D. Test from your PC

From Windows (PowerShell) or another machine **outside** your LAN (e.g. phone on mobile data):

```powershell
# Replace 1405 with 1402, 1403, 1404 as needed
curl -v --connect-timeout 5 http://203.192.243.34:1405
```

- **Connection timed out** → traffic is not reaching the server (router forwarding, ISP, or server firewall).
- **Connection refused** → something reached the server but nothing is listening on that port (check A).
- **HTTP response** → forwarding and server are OK; if the app still fails, it’s CORS or app config.

### E. Which IP to use

- Use **203.192.243.34** (your public IP from `curl ifconfig.me`) for browser and API calls from outside.
- Use **122.166.250.176** only if that’s the IP you get when you run `curl ifconfig.me` **from the server**; otherwise stick to 203.192.243.34 for external access.
