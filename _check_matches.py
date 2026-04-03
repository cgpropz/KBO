import json, unicodedata, csv

def norm(name):
    n = unicodedata.normalize('NFKD', name)
    return ''.join(c for c in n if not unicodedata.combining(c)).lower().replace('-',' ')

def parts(name):
    return frozenset(norm(name).split())

# PP data
with open('KBO-Odds/KBO_odds_2025.json') as f:
    pp = json.load(f)

pp_pitchers = {}
pp_batters = {}
for d in pp:
    if d['Stat'] == 'Pitcher Strikeouts' and d['Odds Type'] == 'standard':
        pp_pitchers[d['Name']] = d
    if d['Stat'] in ('Hits+Runs+RBIs', 'Total Bases') and d['Odds Type'] == 'standard':
        pp_batters.setdefault(d['Name'], []).append(d)

# Pitcher logs
with open('Pitchers-Data/pitcher_logs.json') as f:
    logs = json.load(f)
log_names = set(g['Name'] for g in logs)
log_parts = {parts(n): n for n in log_names}
log_norm = {norm(n): n for n in log_names}

# Also check pitcher_stats.csv (full 2025 season)
pstats_names = set()
with open('Pitchers-Data/pitcher_stats.csv') as f:
    for row in csv.DictReader(f):
        pstats_names.add(row['Player'])
pstats_norm = {norm(n): n for n in pstats_names}
pstats_parts = {parts(n): n for n in pstats_names}

print('=== PP PITCHERS -> Data Sources ===')
for pp_name in sorted(pp_pitchers.keys()):
    n = norm(pp_name)
    p = parts(pp_name)
    
    # Check pitcher_logs.json
    log_match = log_norm.get(n) or log_parts.get(p)
    if log_match:
        games = sum(1 for g in logs if g['Name'] == log_match)
        seasons = set(g.get('Season', '?') for g in logs if g['Name'] == log_match)
        print('  [logs] OK  %-25s -> %s (%d games, seasons=%s)' % (pp_name, log_match, games, seasons))
    else:
        print('  [logs] MISS %-25s' % pp_name)
        for ln in sorted(log_names):
            if any(w in norm(ln) for w in norm(pp_name).split() if len(w) > 2):
                print('         possible: %s' % ln)
    
    # Check pitcher_stats.csv
    ps_match = pstats_norm.get(n) or pstats_parts.get(p)
    if ps_match:
        print('  [stats] OK %-25s -> %s' % (pp_name, ps_match))
    else:
        print('  [stats] MISS %-25s' % pp_name)

# Starters
print('\n=== TODAY STARTERS (player_names.csv) ===')
with open('Pitchers-Data/player_names.csv') as f:
    for row in csv.DictReader(f):
        name = row['Player']
        team = row['Team']
        n = norm(name)
        p = parts(name)
        log_match = log_norm.get(n) or log_parts.get(p)
        if log_match:
            games = sum(1 for g in logs if g['Name'] == log_match)
            print('  OK  %-25s %-8s -> %s (%d games)' % (name, team, log_match, games))
        else:
            print('  MISS %-25s %-8s' % (name, team))

print('\n=== PP BATTERS -> Batter Logs ===')
# Check combined batting data
import os
combined = 'Batters-Data/KBO_daily_batting_stats_combined.csv'
batter_names = set()
if os.path.exists(combined):
    with open(combined) as f:
        for row in csv.DictReader(f):
            batter_names.add(row.get('Name', ''))
batter_norm = {norm(n): n for n in batter_names}
batter_parts = {parts(n): n for n in batter_names}

for pp_name in sorted(pp_batters.keys()):
    n = norm(pp_name)
    p = parts(pp_name)
    match = batter_norm.get(n) or batter_parts.get(p)
    if match:
        print('  OK  %-25s -> %s' % (pp_name, match))
    else:
        print('  MISS %-25s' % pp_name)
