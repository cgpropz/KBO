-- Public board clocks for /status.json.
-- One row, no prop lines. The site reads it with the service-role key.
-- Anonymous visitors cannot select this table. Apply once in the KBO project.
-- Re-running does not overwrite a newer publish.

begin;

create table if not exists public.board_status (
  id bigint primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.board_status enable row level security;

revoke all on table public.board_status from anon, authenticated, public;

-- Last clocks already on the site. A later publish replaces this row.
insert into public.board_status (id, data)
values (
  1,
  $status$
  {
    "boards": [
      {"sport": "kbo", "board_updated_at": "2026-10-11T20:38:12-04:00", "injuries_checked_at": null, "prop_count": 9, "stale": false},
      {"sport": "wnba", "board_updated_at": "2026-10-11T20:45:38-04:00", "injuries_checked_at": null, "prop_count": 64, "stale": false},
      {"sport": "nfl", "board_updated_at": "2026-10-11T20:44:30-04:00", "injuries_checked_at": null, "prop_count": 54, "stale": false},
      {"sport": "nba", "board_updated_at": "2026-10-11T20:46:21-04:00", "injuries_checked_at": null, "prop_count": 33, "stale": false},
      {"sport": "nhl", "board_updated_at": "2026-10-11T20:48:11-04:00", "injuries_checked_at": null, "prop_count": 88, "stale": false}
    ]
  }
  $status$::jsonb
)
on conflict (id) do nothing;

commit;
