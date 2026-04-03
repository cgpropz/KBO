import requests
from bs4 import BeautifulSoup

missing = [
    'Choi Min-seok',
    'Kim Tae-hyeong',
    'Lachlan Wells',
    'Drew Verhagen',
    'Choi Min-jun',
]

for name in missing:
    query = name.replace('-', ' ')
    url = 'https://mykbostats.com/search?q=' + '+'.join(query.split())
    print('Searching: %s' % url)
    try:
        r = requests.get(url, timeout=15)
        soup = BeautifulSoup(r.text, 'html.parser')
        links = soup.find_all('a', href=True)
        found = False
        for link in links:
            href = link.get('href', '')
            if '/players/' in href:
                pid = href.split('/players/')[-1].split('/')[0]
                text = link.get_text(strip=True)
                print('  %s -> %s (id=%s) %s' % (name, text, pid, href))
                found = True
        if not found:
            print('  %s -> NOT FOUND on site' % name)
    except Exception as e:
        print('  %s -> ERROR: %s' % (name, e))
