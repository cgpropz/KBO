# KBO Props UI — Supabase Setup & Refresh System Guide

## Overview

The KBO Props UI now uses **Supabase** as the authoritative data backend instead of GitHub Raw CDN. This provides:
- **Consistent data freshness** with `updated_at` timestamps
- **Zero-cache guarantees** (no GitHub CDN delays)
- **Real-time odds updates** (PrizePicks odds refresh every 10 minutes)
- **Separate concerns** (odds vs. stats vs. projections refresh independently)

---

## Part 1: Initial Setup (One-Time)

### Step 1: Execute SQL Schema in Supabase

The SQL schema creates 7 tables with RLS policies and auto-update triggers.

1. Go to **[Supabase Dashboard](https://supabase.com)** → Your Project
2. Click **SQL Editor** (left sidebar)
3. Click **New Query**
4. Copy the entire contents of `supabase_schema.sql` from your project
5. Paste into the SQL editor
6. Click **Execute** (Ctrl+Enter or ⌘+Enter)

**Expected output:**
```
CREATE TABLE (7 times)
CREATE OR REPLACE FUNCTION
CREATE TRIGGER (7 times)
ALTER TABLE (7 times)
CREATE POLICY (7 times)
```

### Step 2: Verify Tables Exist

In Supabase, click **Table Editor** and verify these 7 tables exist:
- `strikeout_projections`
- `batter_projections`
- `pitcher_rankings`
- `prizepicks_props`
- `matchup_data`
- `prop_results`
- `pitcher_logs`

---

## Part 2: Environment Variables

### Frontend (Vercel)

In Vercel Dashboard → Project Settings → Environment Variables, ensure:

| Name | Value | Source |
|------|-------|--------|
| `VITE_SUPABASE_URL` | `https://ocaqjkfdjqxszevtllew.supabase.co` | Supabase API URL (from Settings → API) |
| `VITE_SUPABASE_ANON_KEY` | `sb_publishable_h-Qgxw2...` | Supabase Publishable Key (from Settings → API) |

**Verification:**
- ✅ `VITE_SUPABASE_URL` is a full URL ending in `.supabase.co`
- ✅ `VITE_SUPABASE_ANON_KEY` starts with `sb_publishable_` or similar
- ❌ Do NOT use the project ID as the URL
- ❌ Do NOT use the service role key in the frontend

### Backend (Local Development)

For running the refresh scripts locally:

```bash
export SUPABASE_URL="https://ocaqjkfdjqxszevtllew.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="sbpvt_..."
```

Get the **Service Role Key** from:
1. Supabase Dashboard → Settings → API
2. Scroll to **Secret Keys**
3. Click eye icon to reveal
4. Copy the full key (starts with `sbpvt_`)

---

## Part 3: Refresh System

The refresh system is now split into **two lightweight scripts**:

### Script 1: `refresh_odds.py` (Fast — ~30 seconds)

**Purpose:** Fetch PrizePicks odds only and publish to Supabase.  
**Frequency:** Every ~10 minutes (automated via cron/GitHub Actions)  
**Use case:** Real-time odds updates throughout the day

```bash
# Fetch and publish PrizePicks odds
python refresh_odds.py

# Fetch only (don't publish to Supabase)
python refresh_odds.py --skip-supabase

# Preview without writing (dry-run)
python refresh_odds.py --dry-run
```

### Script 2: `refresh_data.py` (Full — ~30 minutes)

**Purpose:** Full stats, projections, and rankings pipeline.  
**Frequency:** Once daily (during off-peak hours, e.g., 4 AM ET)  
**Use case:** Daily refresh of all derived data

```bash
# Run full pipeline
python refresh_data.py

# Skip game log scrapes (only generate projections)
python refresh_data.py --skip-logs

# Skip lineup scrape
python refresh_data.py --skip-lineups

# Skip Supabase publish (local testing)
python refresh_data.py --skip-supabase
```

### Script 3: `refresh.py` (Dispatcher — Backward Compatible)

**Purpose:** Route to appropriate refresh script.  
**Use case:** Legacy usage from CI/CD

```bash
# Default → runs full pipeline (refresh_data.py)
python refresh.py

# Quick mode → runs odds-only (refresh_odds.py)
python refresh.py --quick
```

---

## Part 4: Debugging Console Errors (401/404/486)

### Error: "Failed to load resource: 486 ()"

**Root causes:**
1. **Supabase tables don't exist** → Run SQL schema (Part 1, Step 1)
2. **Supabase URL is wrong** → Verify it's the project URL, not a key
3. **No data in tables** → Run refresh scripts to populate snapshots
4. **RLS policies too restrictive** → Use updated `supabase_schema.sql` with public read policy

### Error: "401 Unauthorized"

**Root causes:**
1. **Anon key is wrong** → Get from Settings → API → Publishable Key
2. **Frontend env var not set** → Redeploy Vercel after setting env vars
3. **Service role key used in frontend** → Frontend should only use anon key

### How to Verify Setup

**In browser DevTools (Console):**

```javascript
// Test 1: Check if Supabase client is initialized
console.log(supabaseClient); // should show API methods

// Test 2: Try a fetch manually
const { data, error } = await supabaseClient
  .from('prizepicks_props')
  .select('*');
console.log(data, error); // should return data or meaningful error
```

**In local terminal:**

```bash
# Test if tables exist and have data
curl -X GET "https://ocaqjkfdjqxszevtllew.supabase.co/rest/v1/prizepicks_props?id=eq.1" \
  -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY"

# Should return data, not 401/404
```

---

## Part 5: Full Setup Checklist

- [ ] SQL schema executed in Supabase (7 tables created)
- [ ] `VITE_SUPABASE_URL` set correctly in Vercel (project URL, not a key)
- [ ] `VITE_SUPABASE_ANON_KEY` set correctly in Vercel (publishable key)
- [ ] Vercel redeployed after env var changes
- [ ] `python refresh_data.py` run successfully locally with `SUPABASE_SERVICE_ROLE_KEY` set
- [ ] Supabase tables populated with data (check Table Editor)
- [ ] Console errors gone from mykboprops.com
- [ ] Landing page shows "Live data updated X minutes ago" (freshness badge)
- [ ] Props cards display data (not 0 values)

---

## Part 6: Production CI/CD Setup

### GitHub Actions Workflow

Create `.github/workflows/refresh.yml`:

```yaml
name: KBO Refresh Pipeline

on:
  schedule:
    # Odds every 10 minutes (during game hours)
    - cron: '*/10 6-23 * * *'  # 6 AM - 11 PM ET daily
    # Full data once daily at 4 AM ET
    - cron: '0 4 * * *'

jobs:
  refresh-odds:
    runs-on: ubuntu-latest
    if: github.event.schedule == '*/10 6-23 * * *'
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - run: pip install -q supabase
      - run: python refresh_odds.py
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}

  refresh-data:
    runs-on: ubuntu-latest
    if: github.event.schedule == '0 4 * * *'
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      - run: pip install -q supabase
      - run: python refresh_data.py
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
```

### Vercel Deployment

After SQL schema and env vars are set:

1. Go to Vercel Dashboard
2. Trigger a redeploy:
   - Click **Deployments**
   - Find the latest deployment
   - Click **...** → **Redeploy**
3. Wait for build to complete
4. Visit mykboprops.com and verify data loads

---

## Troubleshooting

| Issue | Diagnosis | Fix |
|-------|-----------|-----|
| "Freshness unavailable" on landing page | Supabase returns null or error | Run `refresh_data.py` to populate tables |
| Props show 0 values | Tables exist but no data | Run `refresh_data.py` with correct env vars |
| 401 errors in console | Anon key wrong or frontend not redeployed | Re-check anon key, redeploy Vercel |
| 404 errors in console | Tables don't exist | Run SQL schema (Part 1, Step 1) |
| Odds not updating | `refresh_odds.py` not running | Check GitHub Actions logs or manual run |

---

## Next Steps

1. **Execute SQL schema** → Part 1, Step 1
2. **Verify env vars** → Part 2
3. **Redeploy Vercel** → Trigger new deployment
4. **Run `refresh_data.py` locally**:
   ```bash
  export SUPABASE_URL="https://ocaqjkfdjqxszevtllew.supabase.co"
   export SUPABASE_SERVICE_ROLE_KEY="sbpvt_..."
   python refresh_data.py
   ```
5. **Check mykboprops.com** → Console should have no errors, landing page should show data
6. **Set up CI/CD** → GitHub Actions workflows for automatic refreshes
