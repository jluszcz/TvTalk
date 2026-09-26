-- Optional local dev seed: sample "watched" state so the board isn't empty.
-- Apply with:
--   npx wrangler d1 execute tvtalk --local --file=seed.sql
--
-- Shows and seasons come from migration 0002 or from the board, and the
-- roster (users + emails) lives in roster.sql, so all of it is already
-- present before this runs — do not duplicate it here. Apply roster.sql first
-- so these user ids exist. Do NOT run this against production; it inserts
-- fake watched rows.

-- Season id 1 (The Great British Bake Off Season 14) fully watched (grays out,
-- sinks to the bottom); a partial on season id 2 (Lanterns Season 1).
INSERT OR IGNORE INTO watched (user_id, season_id, created_at) VALUES
    ('user-1', 1, '2026-01-01T00:00:00Z'),
    ('user-2', 1, '2026-01-01T00:00:00Z'),
    ('user-3', 1, '2026-01-01T00:00:00Z'),
    ('user-1', 2, '2026-01-02T00:00:00Z');
