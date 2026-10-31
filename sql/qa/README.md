# qa_pick_ledger SQL (not applied)

These files are the Board QA snapshot and the internal all-lines read after
the demon/goblin under fix. Nothing in this directory is applied by CI, a
build, or a cloud agent. Do not run them against Supabase project KBO_2026
(`ocaqjkfdjqxszevtllew`) until Code Green says CLEAR.

`unapplied/snapshot.sql` and the other snapshot files replace the copies
Board QA runs. They still insert pre-lock rows only (`ON CONFLICT DO
NOTHING`). They do not `UPDATE` or `DELETE`, and they create no function,
grant, table, or RLS policy. `side` is not part of the unique key, so an
old demon under stays in the table.

`unapplied/all_lines_record.sql` is a read-only query. It keeps the latest
pre-lock row per sport, date, player, stat, line, and odds type (the same
rule as `board_reader_results_rows()`), then drops demon and goblin unders.
Standard lines and demon/goblin overs stay. The public results function and
the free top 3 are unchanged.

A CG below 50 on an over-only demon or goblin is stored as `side` null, not
as an over. Null is not a pick. Logging it as over would grade a line the
model did not take.
