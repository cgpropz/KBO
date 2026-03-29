import requests

response = requests.get('https://partner-api.prizepicks.com/projections?per_page=1000')
print(f"Status: {response.status_code}, Length: {len(response.text)}")
if response.status_code != 200 or len(response.text) < 10:
    print("Response:", response.text[:500])
    exit(1)
pp = response.json()

library = {}
for inc in pp['included']:
    if 'attributes' in inc and 'name' in inc['attributes']:
        library[inc['id']] = {
            'name': inc['attributes']['name'],
            'team': inc['attributes'].get('team', 'N/A'),
            'league': inc['attributes'].get('league', 'N/A')
        }

rows = []
for d in pp['data']:
    pid = d.get('relationships', {}).get('new_player', {}).get('data', {}).get('id', 'N/A')
    pinfo = library.get(pid, {'name': 'Unknown', 'team': 'N/A', 'league': 'N/A'})
    if pinfo['league'] != 'KBO':
        continue
    stat = d['attributes'].get('stat_type', 'N/A')
    if stat != 'Pitcher Strikeouts':
        continue
    rows.append({
        'Name': pinfo['name'],
        'Team': pinfo['team'],
        'Stat': stat,
        'Versus': d['attributes'].get('description', 'N/A'),
        'Line': d['attributes'].get('line_score', 'N/A'),
        'Odds Type': d['attributes'].get('odds_type', 'N/A')
    })

print(f"Found {len(rows)} Pitcher Strikeouts lines:")
for r in rows:
    print(f"  {r['Name']:25s} {r['Team']:10s} vs {str(r['Versus']):20s} Line={str(r['Line']):>5s}  {r['Odds Type']}")
