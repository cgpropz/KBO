import json

# Load matchup data which has team batting stats from mykbostats
with open('kbo-props-ui/public/data/matchup_data.json', 'r') as f:
    matchup_data = json.load(f)

# Build team opponent stats from matchup data
# Key insight: Each matchup has both home_batting and away_batting stats
team_stats = {}

for matchup in matchup_data.get('matchups', []):
    away_team = matchup.get('away')
    home_team = matchup.get('home')
    
    # Process home team batting stats (used by away pitchers)
    if home_team and matchup.get('home_batting'):
        hb = matchup['home_batting']
        so = hb.get('so', 0)
        games = hb.get('games', 1)
        
        # K% = (Strikeouts / Games / 9) * 100 = strikeouts per plate appearance average
        # Actually K% for a team is usually SO/AB * 100, but we can estimate from SO/G
        # Better: K% ≈ (SO / (AB based on games)) * 100
        # From the data: games and AB should give us PA info
        # Let's use: K% = SO / (SO + (H from batting)) * 100 - NO, that's not right
        # Standard K% = Strikeouts / Total Plate Appearances * 100
        # Approximation: K% ≈ SO_per_game / 3.5 * 100 = strikeouts per AB (rough)
        # Better approach: if so_per_g = 8.55, then K% ≈ (8.55 / 9) * 100 ≈ 95% - too high
        # The so_per_g is strikeouts per game, not per PA
        # Real K% for pitchers facing this team: SO / (AB + BB + HBP)
        # Let's estimate: if avg team gets ~3.5 AB per game, then K% ≈ so_per_g / 3.5 * 100
        
        h = hb.get('h', 0)
        ba_str = hb.get('ba', '.000')
        ba = float(ba_str) if isinstance(ba_str, str) else ba_str
        
        # Better calculation: from BA and H, estimate AB
        # BA = H / AB, so AB ≈ H / BA
        ab = h / ba if ba > 0 else 1
        k_pct = (so / ab * 100) if ab > 0 else 0
        
        team_stats[home_team] = {
            'ba': round(ba, 3),
            'k_pct': round(k_pct, 1),
            'so': so,
            'h': h,
            'games': games
        }
    
    # Process away team batting stats (used by home pitchers)
    if away_team and matchup.get('away_batting'):
        ab = matchup['away_batting']
        so = ab.get('so', 0)
        games = ab.get('games', 1)
        h = ab.get('h', 0)
        ba_str = ab.get('ba', '.000')
        ba = float(ba_str) if isinstance(ba_str, str) else ba_str
        
        ab_calc = h / ba if ba > 0 else 1
        k_pct = (so / ab_calc * 100) if ab_calc > 0 else 0
        
        team_stats[away_team] = {
            'ba': round(ba, 3),
            'k_pct': round(k_pct, 1),
            'so': so,
            'h': h,
            'games': games
        }

print("Team Opponent Batting Stats (2026):")
print(f"{'Team':<12} {'BA':<8} {'K%':<8} {'SO':<6} {'H':<6} {'Games':<6}")
print("-" * 50)
for team in sorted(team_stats.keys()):
    stats = team_stats[team]
    print(f"{team:<12} {stats['ba']:<8.3f} {stats['k_pct']:<8.1f} {stats['so']:<6} {stats['h']:<6} {stats['games']:<6}")

# Write to JSON for the React component
with open('kbo-props-ui/public/data/team_opponent_stats_2026.json', 'w') as f:
    json.dump(team_stats, f, indent=2)

print("\nWrote team opponent stats to kbo-props-ui/public/data/team_opponent_stats_2026.json")
