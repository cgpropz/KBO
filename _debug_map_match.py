import json
from build_mykbo_maps import parse_url_candidates, pick_best

urls = json.load(open('foreign_urls.json'))
cands = parse_url_candidates(urls)
print('candidates', len(cands))
for c in cands[:5]:
    print(c)

target = {'name': 'Harold Castro', 'team': 'KIA', 'existing_kbo_id': ''}
best, score = pick_best(target, cands)
print('best', best)
print('score', score)
