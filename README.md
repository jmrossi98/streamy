# Streamy – Movie & TV discovery

A Netflix-style discovery app built with **Next.js 14** (App Router), **TypeScript**, and **Tailwind CSS**. Browse movies powered by **TMDB**, with “Where to watch” links to **JustWatch** for legal streaming, rent, and purchase.

## Features

- **Hero section** with trending featured title
- **Horizontal rows**: Trending Now + genre rows (Action, Comedy, Drama, Horror, Sci-Fi) from TMDB
- **Movie detail page** with overview, rating, runtime, genres, and **Where to watch** (JustWatch + provider logos from TMDB)
- **Navbar** and **footer** (Netflix-style UI)
- **AWS Amplify**–ready for deployment

## Setup

### 1. TMDB API key (required)

1. Sign up at [themoviedb.org](https://www.themoviedb.org/signup).
2. Go to [Settings → API](https://www.themoviedb.org/settings/api) and request an API key (free).
3. Copy `.env.example` to `.env.local` and set your key:

```bash
cp .env.example .env.local
# Edit .env.local and set TMDB_API_KEY=your_key
```

### 2. Run locally

Requires **Node.js 18.17+**.

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Without `TMDB_API_KEY`, the app will show an error.

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
   - Add:
     - **Key:** `TMDB_API_KEY`
     - **Value:** your TMDB API key
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

- `npm run dev` – start dev server
- `npm run build` – production build
- `npm run start` – run production server
- `npm run lint` – run ESLint

## Data and attribution

- **Movie data and images:** [The Movie Database (TMDB)](https://www.themoviedb.org/). This product uses the TMDB API but is not endorsed or certified by TMDB.
- **Where to watch:** Streaming availability is powered by [JustWatch](https://www.justwatch.com/). The app links to JustWatch for legal streaming, rent, and purchase options.

## API (legacy)

The app also exposes mock endpoints under `/api/movies` (list, by genre, by id, featured). The main UI uses TMDB server-side; these are optional for other clients.
