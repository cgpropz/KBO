-- ============================================================
-- saved_slips: per-subscriber slip tracking with grading
-- Run this in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS saved_slips (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  game_date   date NOT NULL,                  -- date the props are for
  confidence  numeric,
  avg_edge    numeric,
  total_edge  numeric,
  unique_games int,
  legs        jsonb NOT NULL DEFAULT '[]',    -- array of leg objects
  graded      boolean DEFAULT false,          -- true once results are in
  result      text DEFAULT 'pending',         -- 'pending' | 'hit' | 'miss' | 'push' | 'partial'
  hits        int DEFAULT 0,                  -- count of legs that hit
  misses      int DEFAULT 0,                  -- count of legs that missed
  pushes      int DEFAULT 0                   -- count of legs that pushed
);

-- Index for fast per-user lookups
CREATE INDEX IF NOT EXISTS idx_saved_slips_user ON saved_slips(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_slips_grading ON saved_slips(graded, game_date);

-- ── Row Level Security ──────────────────────────────────────
ALTER TABLE saved_slips ENABLE ROW LEVEL SECURITY;

-- Users can read only their own slips
CREATE POLICY "Users read own slips"
  ON saved_slips FOR SELECT
  USING (auth.uid() = user_id);

-- Users can insert only their own slips
CREATE POLICY "Users insert own slips"
  ON saved_slips FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Users can delete only their own slips
CREATE POLICY "Users delete own slips"
  ON saved_slips FOR DELETE
  USING (auth.uid() = user_id);

-- Service role can update grading results (no user-facing updates needed)
CREATE POLICY "Service role updates grading"
  ON saved_slips FOR UPDATE
  USING (true)
  WITH CHECK (true);
