# 🏆 World Cup 2026 Prediction Web Application

A premium, responsive, glassmorphic prediction website for the World Cup 2026, built to run entirely serverless on **Cloudflare Pages** (using React 19 + Pages Functions) and **Cloudflare D1** (SQLite database). 

It features integration with **API-Football** for schedules, live scores, and win-probability odds, an automatic 6-hour cron sync worker, points tracking (1pt winner, 1pt over/under, 1pt exact score), and active leaderboard standings with tie-breaker logic.

---

## ✨ Features
- **Live Sync**: Matches, schedules, results, and moneyline win percentages synced from API-Football.
- **Smart Fallback/Simulation Mode**: Operates fully offline if no API key is specified (simulates realistic scores and odds based on team strength rankings).
- **Predictions Panel**: Lock checks prevent users from placing or updating predictions once a match has kicked off.
- **Interactive Match Center**: Includes H/D/A implied probability bars and Over/Under lines.
- **Admin Control Panel**: Add/remove players, trigger forced manual syncs, and manually override scores or odds.
- **Leaderboard Standings**: Order determined by:
  1. Total Points
  2. Correct Exact Scores (Tie-Breaker 1)
  3. Correct Outcomes (Tie-Breaker 2)
  4. Participant Name (Alphabetical)

---

## 🛠️ Project Structure

```
├── db/
│   ├── schema.sql         # D1 database schema
│   ├── seed_teams.sql     # Seed script for 48 World Cup teams
│   └── seed_matches.sql   # Seed script for all 104 matches
├── functions/
│   └── api/               # Cloudflare Pages Functions API endpoints
│       ├── sync.js        # Syncs data from API-Football & simulates matches
│       ├── matches.js     # GET matches, POST admin match overrides
│       ├── predictions.js # GET predictions, POST prediction updates
│       └── leaderboard.js # GET computed player standings
├── sync-worker/           # Cloudflare Worker Cron Trigger (Runs every 6 hours)
│   ├── index.js           # Cron trigger scheduler handler
│   └── wrangler.toml      # Cron configuration settings
├── src/                   # React Frontend App
│   ├── components/        # App UI components
│   └── index.css          # Premium glassmorphism design system styles
└── wrangler.toml          # Pages & D1 database bindings
```

---

## ⚙️ Local Development Setup

1. **Clone the repository and install dependencies**:
   ```bash
   npm install
   ```
2. **Start the Pages Function & Database Emulator**:
   ```bash
   npx wrangler pages dev dist --d1 db --port 8888
   ```
   *Note: On first startup, the edge backend helper will automatically self-seed D1 from the sql file.*
3. **Start the Frontend development server**:
   ```bash
   npm run dev
   ```
4. **Access the application**: Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🚀 Cloudflare Production Deployment

### 1. Create the D1 Database
Create the production D1 database instance in your Cloudflare account:
```bash
npx wrangler d1 create worldcup_predictions
```
Copy the `database_id` hash outputted in your terminal and update the value in [wrangler.toml](./wrangler.toml):
```toml
database_id = "your-new-d1-database-id-uuid"
```

Initialize your production database tables:
```bash
npx wrangler d1 execute worldcup_predictions --remote --file=./db/schema.sql
```

### 2. Deploy the Pages Project
1. Go to the **Cloudflare Dashboard** -> **Workers & Pages** -> **Create application** -> **Pages** tab.
2. Connect your GitHub repository (`yajinni/Dubbs_Bets`).
3. Set the following build settings:
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Build Output Directory**: `dist`
4. Under project **Settings** -> **Functions** -> **D1 database bindings**:
   - Add a binding named `db` (lowercase) mapped to the `worldcup_predictions` database. (Do this for both **Production** and **Preview** environments).
5. (Optional) Under **Settings** -> **Environment variables**:
   - Add `API_FOOTBALL_KEY` set to your API-Football API Key.
   - Add `SYNC_SECRET` set to a random secret token (e.g. `my_super_secret_token`) to secure your sync endpoint.

---

## ⏰ Setting up the 6-Hour Background Sync

To run the sync automatically every 6 hours regardless of page visits, we deploy the Cron Trigger Worker in the `/sync-worker` folder:

1. Navigate to the sync-worker directory:
   ```bash
   cd sync-worker
   ```
2. Update the `PAGES_URL` value in `wrangler.toml` to your deployed Pages URL (e.g., `https://dubbs-bets.pages.dev`).
3. Deploy the worker:
   ```bash
   npx wrangler deploy
   ```
4. Configure the shared secret key to authorize the cron trigger:
   ```bash
   npx wrangler secret put SYNC_SECRET
   ```
   *(Enter the same secret token you set in your Pages project's `SYNC_SECRET` environment variable.)*

Once deployed, Cloudflare will automatically fire the cron trigger every 6 hours, hitting your website's API endpoint, fetching fresh fixture details, and updating participant points!
