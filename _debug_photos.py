import json, pathlib, re

BASE = pathlib.Path(__file__).parent
bp = json.loads((BASE / 'Batters/players.json').read_text())
fu = json.loads((BASE / 'foreign_urls.json').read_text())

pcode_by_name = {d['name']: d['pcode'] for d in bp}

check_names = ['Adam Oller', 'Anders Tolhurst', "Jack O'Loughlin",
               'Toda Natsuki', 'Natsuki Toda', 'Victor Reyes', 'Anthony Veneziano',
               'Caleb Boushley', 'Nathan Wiles', 'Zach Logue']
print('In players.json:')
for nm in check_names:
    print(f'  {nm}: {pcode_by_name.get(nm, "MISSING")}')

print('\nForeign URL slugs for target players:')
for url in fu:
    m = re.search(r'/players/(\d+)-([^/]+)$', url)
    if not m:
        continue
    mid, slug = m.group(1), m.group(2)
    parts = slug.split('-')
    if len(parts) < 2:
        continue
    last, first = parts[0], parts[1]
    name_cand = f"{first} {last}"
    keywords = ['oller','tolhurst','loughlin','toda','reyes','veneziano','boushley','wiles','logue','hilliard','brooks','cameron']
    if any(x in name_cand.lower() or x in url.lower() for x in keywords):
        in_pcodes = name_cand in pcode_by_name
        print(f'  mykbo={mid}  slug={slug}  candidate="{name_cand}"  pcode_match={in_pcodes}')
        if not in_pcodes:
            # Show fuzzy matches
            fl, ll = first.lower(), last.lower()
            matches = [nm for nm in pcode_by_name if fl in nm.lower() and ll in nm.lower()]
            print(f'    fuzzy matches: {matches}')
