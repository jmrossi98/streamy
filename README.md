# Streamy – Movie & TV discovery

A Netflix-style discovery app built with **Next.js 14** (App Router), **TypeScript**, and **Tailwind CSS**. Browse movies powered by **TMDB**, with “Where to watch” links to **JustWatch** for legal streaming, rent, and purchase.

## Features

- **Hero section** with trending featured title
- **Horizontal rows**: Trending Now + genre rows (Action, Comedy, Drama, Horror, Sci-Fi) from TMDB
- **Movie detail page** with overview, rating, runtime, genres, and **Where to watch** (JustWatch + provider logos from TMDB)
- **User accounts**: sign up, sign in, sign out (NextAuth.js + credentials)
- **My List**: add/remove movies from your watchlist (per-user, stored in DB)
- **Progress**: save and resume “minutes watched” per movie per user
- **Navbar** and **footer** (Netflix-style UI)
- **AWS Amplify**–ready for deployment

## Setup

### 1. Environment variables

Copy `.env.example` to `.env.local` and set:

- **TMDB_API_KEY** – get a free key at [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api)
- **DATABASE_URL** – for local dev use `file:./dev.db` (SQLite)
- **NEXTAUTH_SECRET** – random string (e.g. `openssl rand -base64 32`)
- **NEXTAUTH_URL** – `http://localhost:3000` for local dev

### 2. Database (required for auth and watchlist)

Requires **Node.js 18+**. From the project root:

```bash
npm install
npx prisma migrate deploy
# or, to create the DB from scratch: npx prisma migrate dev --name init
```

This creates the SQLite DB and tables (User, WatchlistItem, WatchProgress).

### 3. TMDB API key

1. Sign up at [themoviedb.org](https://www.themoviedb.org/signup).
2. Go to [Settings → API](https://www.themoviedb.org/settings/api) and request an API key (free).
Ensure `TMDB_API_KEY` is set in `.env.local` (see step 1).

### 4. Run locally

Requires **Node.js 18.17+**.

**For development (auto-reload on code change):** use the **dev** server. Leave it running and save files to see updates.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Without `TMDB_API_KEY`, the app will show an error.

**Production mode** (`npm run build` then `npm run start`) does **not** auto-rebuild when you edit code; use `npm run dev` while developing.

### Production server + rebuild on save (`npm run start:watch`)

Next.js **does not** support Fast Refresh / HMR when using **`next start`** (production). That’s a framework limitation—not something we can turn on for `npm start`.

What you can do instead:

| Command | What it does |
|--------|----------------|
| **`npm run dev`** | **Best for daily work.** Dev server with **Fast Refresh** (instant updates, no full production build). |
| **`npm run start:watch`** | Runs **`next start`**, but **nodemon** watches `src/`, config files, etc. Each save triggers a **full `npm run build`** then restarts the server. **Slow** (often 15s–2m per save) but matches “production” output. |
| **`npm start`** | Same as **`npm run start:prod`**: one **`build`** + **`next start`** (no file watching). Use for CI-style checks. |

`nodemon.json` enables **`legacyWatch: true`** and a **2s debounce** so file watching works more reliably on **Windows**, **OneDrive**, and **WSL** (native watchers often fail on synced folders). If changes still don’t trigger, try moving the repo to a local non-synced path or set polling env vars your tooling supports.

### Seeing your changes (auto rebuild)

**Leave `npm run dev` running** in a terminal. When you save a file, Next.js will rebuild and the browser will refresh (hot reload). You do **not** need to stop or rerun the command.

- If you **stop** the dev server, you must run `npm run dev` again to see the app.
- If you use **production mode** (`npm run build` then `npm run start`), changes do **not** auto-rebuild; run `npm run dev` for development.
- If the browser doesn’t update, try a hard refresh: **Ctrl+Shift+R** (Windows/Linux) or **Cmd+Shift+R** (Mac).
- If hot reload still doesn’t work with `npm run dev`, try the standard dev server: run `npm run dev:webpack` (same behavior, different bundler).
- The **first time** you open a route (e.g. `/movies`, `/tv`, `/watch/…/play`), Next.js compiles it, which can take 10–80+ seconds on a slow disk or WSL. Later visits to that route are much faster. TMDB data is cached for 1 hour, so repeat navigations hit the cache instead of the API.
- If **first-load compile is very slow** (e.g. 30+ seconds per route), try `npm run dev:webpack` instead of `npm run dev`; the webpack dev server can be faster than Turbopack on some setups (e.g. WSL).

### WSL

Use the project path under Windows (e.g. `/mnt/c/Users/.../streamy`) or clone into your Linux home. Install Node 18+ with nvm, then `npm install` and `npm run dev`.

## Deploy on AWS (Amplify)

**Amplify** is the recommended way to run this Next.js app on AWS. It supports SSR, handles build and hosting, and fits well with a Git-based workflow.

### One-time setup

1. **Push the repo to GitHub, GitLab, Bitbucket, or AWS CodeCommit.**

2. **Create an Amplify app**
   - Open [AWS Amplify Console](https://console.aws.amazon.com/amplify/).
   - **Create new app** → **Host web app**.
   - Connect your repository and branch (e.g. `main`).
   - Amplify will detect Next.js and use the repo’s `amplify.yml` if present (this project includes it).

3. **Set environment variables**
   - In Amplify: **App settings** → **Environment variables**.
   - Add: `TMDB_API_KEY`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL` (your app URL).
   - For production you’ll need a real database: set `DATABASE_URL` to a Postgres URL (e.g. Neon, PlanetScale). Then run `npx prisma migrate deploy` in the build (add to `amplify.yml` preBuild if needed).
   - Save and **Redeploy** the app.

4. **Deploy**
   - Amplify will run `npm ci` and `npm run build`, then deploy the `.next` output. The first build may take a few minutes.

5. **Custom domain (optional)**  
   - In **App settings** → **Domain management**, add and verify your domain and attach it to the branch.

### Build spec (included)

This repo includes `amplify.yml`:

- **preBuild:** `npm ci`
- **build:** `npm run build`
- **artifacts:** `baseDirectory: .next`, `files: '**/*'`
- **cache:** `node_modules` and `.next/cache`

No extra Amplify config is required unless you change the build (e.g. different Node version in Amplify console).

## Scripts

- **`npm run dev`** – **Use this for development.** Starts the dev server (Prisma + Next with Turbopack). Code changes auto-rebuild and the browser updates (hot reload). Do **not** use `npm run start` if you want auto-reload.
- `npm run dev:turbo` – Next.js with Turbopack only (skip Prisma). Use after migrations when you want faster restarts.
- `npm run dev:webpack` – Next.js with webpack dev server (hot reload). Use if `npm run dev` doesn’t rebuild on save.
- `npm run build` – production build
- `npm run start` – **production server only** (no auto-reload; run `npm run build` first or use a script that builds then starts)
- **`npm run start:watch`** – production build + server, and **rebuild + restart on file save** (watches `src/`, Prisma, config). Full build runs on each change; refresh the browser to see updates. Use when you want to test prod mode while editing.
- `npm run lint` – run ESLint

## Data and attribution

- **Movie data and images:** [The Movie Database (TMDB)](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB.
- **Where to watch:** Streaming availability is powered by [JustWatch](https://www.justwatch.com/). The app links to JustWatch for legal streaming, rent, and purchase options.

## API (legacy)

The app also exposes mock endpoints under `/api/movies` (list, by genre, by id, featured). The main UI uses TMDB server-side; these are optional for other clients.
