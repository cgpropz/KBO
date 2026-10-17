-- ============================================================================
-- Security · Migration 06 — postgres may SET ROLE board_reader
-- ============================================================================
-- Applied by hand Oct 17, 2026 6:50 PM ET (migration board_reader_set_option_for_postgres).
-- PG16+ needs SET on the membership so postgres sessions (agent connectors) can
-- `set role board_reader`. Read-only role; grants no table access.
-- ============================================================================

grant board_reader to postgres with set true, inherit false;
