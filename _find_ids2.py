import requests
from bs4 import BeautifulSoup
import time

# Try different name variations
searches = [
    ('Choi Min-seok', ['Choi Minseok', 'Min-seok Choi', 'Choi Min Seok']),
    ('Kim Tae-hyeong', ['Kim Taehyeong', 'Tae-hyeong Kim', 'Kim Tae Hyeong']),
    ('Lachlan Wells', ['Wells Lachlan', 'Lachlan Wells']),
    ('Drew Verhagen', ['Verhagen Drew', 'Drew Verhagen']),
    ('Choi Min-jun', ['Choi Minjun', 'Min-jun Choi', 'Choi Min Jun']),
]

for name, variants in searches:
    print('=== %s ===' % name)
    for v in variants:
        query = v.replace('-', ' ')
        url = 'https://mykbostats.com/search?q=' + '+'.join(query.split())
        try:
            r = requests.get(url, timeout=15)
            soup = BeautifulSoup(r.text, 'html.parser')
            links = soup.find_all('a', href=True)
            for link in links:
                href = link.get('href', '')
                if '/players/' in href:
                    pid = href.split('/players/')[-1].split('/')[0]
                    text = link.get_text(strip=True)
                    print('  %s -> %s (id=%s)' % (v, text, pid))
        except Exception as e:
            print('  ERROR: %s' % e)
        time.sleep(0.5)
    print()

# Also try last-name-only searches
print('=== LAST NAME SEARCHES ===')
for last in ['Verhagen', 'Wells', 'Minseok', 'Taehyeong', 'Minjun']:
    url = 'https://mykbostats.com/search?q=' + last
    try:
        r = requests.get(url, timeout=15)
        soup = BeautifulSoup(r.text, 'html.parser')
        links = soup.find_all('a', href=True)
        for link in links:
            href = link.get('href', '')
            if '/players/' in href:
                pid = href.split('/players/')[-1].split('/')[0]
                text = link.get_text(strip=True)
                print('  %s -> %s (id=%s)' % (last, text, pid))
    except Exception as e:
        print('  ERROR: %s' % e)
    time.sleep(0.5)
