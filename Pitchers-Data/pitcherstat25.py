import requests
from bs4 import BeautifulSoup
import csv
import time
from requests.adapters import HTTPAdapter
from requests.packages.urllib3.util.retry import Retry

# Full list of player URLs (same as provided previously)
player_urls = [
    "https://mykbostats.com/players/1862",  # William Cuevas
    "https://mykbostats.com/players/2402",  # Wes Benjamin
    "https://mykbostats.com/players/2620",  # Enmanuel De Jesus
    "https://mykbostats.com/players/396",   # Kim Kwang-hyun
    "https://mykbostats.com/players/2260",  # Charlie Barnes
    "https://mykbostats.com/players/2606",  # Kyle Hart
    "https://mykbostats.com/players/2558",  # Ricardo Sánchez
    "https://mykbostats.com/players/2597",  # Dietrich Enns
    "https://mykbostats.com/players/1628",  # Gwak Been
    "https://mykbostats.com/players/2590",  # James Naile
    "https://mykbostats.com/players/2593",  # William Crowe
    "https://mykbostats.com/players/1096",  # Choi Won-tae
    "https://mykbostats.com/players/2474",  # Ariel Jurado
    "https://mykbostats.com/players/2564",  # Aaron Wilkerson
    "https://mykbostats.com/players/2605",  # Daniel Castano
    "https://mykbostats.com/players/1183",  # Um Sang-back
    "https://mykbostats.com/players/2626",  # Ryu Hyun-jin
    "https://mykbostats.com/players/2583",  # Connor Seabold
    "https://mykbostats.com/players/1802",  # Won Tae-in
    "https://mykbostats.com/players/1506",  # Na Gyun-an
    "https://mykbostats.com/players/2578",  # Denyi Reyes
    "https://mykbostats.com/players/561",   # Lee Jae-hak
    "https://mykbostats.com/players/372",   # Im Chan-kyu
    "https://mykbostats.com/players/1976",  # Oh Won-seok
    "https://mykbostats.com/players/1830",  # Casey Kelly
    "https://mykbostats.com/players/298",   # Yang Hyeon-jong
    "https://mykbostats.com/players/1166",  # Park Se-woong
    "https://mykbostats.com/players/2411",  # Brandon Waddell
    "https://mykbostats.com/players/2559",  # Roenis Elías
    "https://mykbostats.com/players/1060",  # Park Jong-hun
    "https://mykbostats.com/players/1761",  # Shin Min-hyeok
    "https://mykbostats.com/players/2405",  # Félix Peña
    "https://mykbostats.com/players/2444",  # Yoon Young-cheol
    "https://mykbostats.com/players/2575",  # Jeon Mi-r
    "https://mykbostats.com/players/2610",  # Weon Sang-hyun
    "https://mykbostats.com/players/2275",  # Moon Dong-ju
    "https://mykbostats.com/players/712",   # Ha Yeong-min
    "https://mykbostats.com/players/900",   # Ko Hyo-jun
    "https://mykbostats.com/players/1501",  # Son Ju-young
    "https://mykbostats.com/players/2049",  # You Young-chan
    "https://mykbostats.com/players/2302",  # Park Yeong-hyun
    "https://mykbostats.com/players/572",   # Jang Hyun-sik
    "https://mykbostats.com/players/2439",  # Kwak Do-gyu
    "https://mykbostats.com/players/2588",  # Hwang Jun-seo
    "https://mykbostats.com/players/2621",  # Robert Dugger
    "https://mykbostats.com/players/2151",  # Jo Byeong-hyeon
    "https://mykbostats.com/players/1241",  # Kim Won-jung
    "https://mykbostats.com/players/1545",  # Choi Won-joon
    "https://mykbostats.com/players/2122",  # Lee Seung-hyun
    "https://mykbostats.com/players/2323",  # Lee Byeong-heon
    "https://mykbostats.com/players/2108",  # Kim Dong-ju
    "https://mykbostats.com/players/1685",  # Kim Si-hoon
    "https://mykbostats.com/players/44",    # Lee Yong-chan
    "https://mykbostats.com/players/2159",  # Han Jae-seung
    "https://mykbostats.com/players/1147",  # Kim Min-su
    "https://mykbostats.com/players/1856",  # Raul Alcántara
    "https://mykbostats.com/players/2326",  # Choi Ji-kang
    "https://mykbostats.com/players/512",   # Cho Sang-woo
    "https://mykbostats.com/players/1676",  # Choi Min-jun
    "https://mykbostats.com/players/673",   # Lee In-bok
    "https://mykbostats.com/players/990",   # Kim Beom-su
    "https://mykbostats.com/players/529",   # Kim Jin-sung
    "https://mykbostats.com/players/2420",  # Choi Jun-ho
    "https://mykbostats.com/players/671",   # Lee Woo-chan
    "https://mykbostats.com/players/1017",  # Park Jung-soo
    "https://mykbostats.com/players/1773",  # Han Doo-sol
    "https://mykbostats.com/players/2567",  # Kim Taek-yeon
    "https://mykbostats.com/players/2479",  # Song Young-jin
    "https://mykbostats.com/players/2140",  # Lee Eui-lee
    "https://mykbostats.com/players/167",   # Oh Seung-hwan
    "https://mykbostats.com/players/570",   # Lim Chang-min
    "https://mykbostats.com/players/989",   # Kim Min-woo
    "https://mykbostats.com/players/327",   # Han Seung-hyuk
    "https://mykbostats.com/players/1125",  # Joo Hyun-sang
    "https://mykbostats.com/players/603",   # Kim Yu-yeong
    "https://mykbostats.com/players/406",   # Moon Seung-won
    "https://mykbostats.com/players/1967",  # Jung Hai-young
    "https://mykbostats.com/players/610",   # Kim Jae-yeol
    "https://mykbostats.com/players/1638",  # Jeong Cheol-won
    "https://mykbostats.com/players/1155",  # Kim Jae-yoon
    "https://mykbostats.com/players/2481",  # Lee Ro-un
    "https://mykbostats.com/players/2311",  # Ju Seung-woo
    "https://mykbostats.com/players/1211",  # Ju Kwon
    "https://mykbostats.com/players/462",   # Kim Tae-hoon
    "https://mykbostats.com/players/17",    # Noh Kyung-eun
    "https://mykbostats.com/players/1714",  # Choi Ha-neul
    "https://mykbostats.com/players/1590",  # Kim Jae-woong
    "https://mykbostats.com/players/477",   # Moon Sung-hyun
    "https://mykbostats.com/players/2431",  # Lee Ho-sung
    "https://mykbostats.com/players/467",   # Kim Sang-su
    "https://mykbostats.com/players/1956",  # Lee Seung-min
    "https://mykbostats.com/players/2287",  # Choi Ji-min
    "https://mykbostats.com/players/1024",  # Lee Min-woo
    "https://mykbostats.com/players/1473",  # Park Chi-guk
    "https://mykbostats.com/players/569",   # Lim Jung-ho
    "https://mykbostats.com/players/2396",  # Lee Ki-soon
    "https://mykbostats.com/players/1374",  # Jeon Sang-hyun
    "https://mykbostats.com/players/1316",  # Choi Sung-young
    "https://mykbostats.com/players/1143",  # Kim Keon-kuk
    "https://mykbostats.com/players/1858",  # Lee Sang-dong
    "https://mykbostats.com/players/2616",  # Son Hyeon-gi
    "https://mykbostats.com/players/2459",  # Lee Jun-ho
    "https://mykbostats.com/players/1346",  # Lee Young-ha
    "https://mykbostats.com/players/2196",  # Kim Kyu-yeon
    "https://mykbostats.com/players/1686",  # Kim Young-kyu
    "https://mykbostats.com/players/387",   # Choi Sung-hoon
    "https://mykbostats.com/players/1297",  # Kim Dae-hyun
    "https://mykbostats.com/players/1468",  # Kim Myeong-sin
    "https://mykbostats.com/players/1951",  # Choi Jun-yong
    "https://mykbostats.com/players/2614",  # Kim Yun-ha
    "https://mykbostats.com/players/606",   # Kim Sa-yun
    "https://mykbostats.com/players/1028",  # Lee Jun-young
    "https://mykbostats.com/players/1850",  # Song Myung-gi
    "https://mykbostats.com/players/508",   # Jang Si-hwan
    "https://mykbostats.com/players/2611",  # Yook Chung-myoung
    "https://mykbostats.com/players/1678",  # Kim Seon-gi
    "https://mykbostats.com/players/1142",  # Ko Young-pyo
    "https://mykbostats.com/players/386",   # Choi Dong-hwan
    "https://mykbostats.com/players/31",    # Yang Hyun
    "https://mykbostats.com/players/2450",  # Park Myung-geun
    "https://mykbostats.com/players/1548",  # Park Sang-won
    "https://mykbostats.com/players/1252",  # Lee Geun-wook
    "https://mykbostats.com/players/2619",  # Jhun Jun-pyo
    "https://mykbostats.com/players/1130",  # Hong Geon-hui
    "https://mykbostats.com/players/356",   # Woo Kyu-min
    "https://mykbostats.com/players/2068",  # Lee Jong-jun
    "https://mykbostats.com/players/1708",  # Kim Ho-jun
    "https://mykbostats.com/players/1925",  # Kim In-beom
    "https://mykbostats.com/players/1902",  # Lee Ji-gang
    "https://mykbostats.com/players/1599",  # Mon Yong-ik
    "https://mykbostats.com/players/2362",  # Hwang Dong-ha
    "https://mykbostats.com/players/1696",  # Kim Min
    "https://mykbostats.com/players/587",   # Koo Seung-min
    "https://mykbostats.com/players/554",   # Yoon Ho-sol
    "https://mykbostats.com/players/4",     # Kim Kang-ryul
    "https://mykbostats.com/players/1534",  # Kim Seong-min
    "https://mykbostats.com/players/703",   # Jo Yi-hyeon
    "https://mykbostats.com/players/2414",  # Kim Yu-seong
    "https://mykbostats.com/players/87",    # Park Si-young
    "https://mykbostats.com/players/1820",  # Jang Ji-su
    "https://mykbostats.com/players/1861",  # Jeon Yong-ju
    "https://mykbostats.com/players/1859",  # Lee Sun-woo
    "https://mykbostats.com/players/2084",  # Kim Dong-hyeok
    "https://mykbostats.com/players/1855",  # Son Dong-hyun
    "https://mykbostats.com/players/1427",  # Park Seung-joo
    "https://mykbostats.com/players/517",   # Han Hyun-hee
    "https://mykbostats.com/players/629",   # Park Jin-hyung
    "https://mykbostats.com/players/2009",  # Choi Jong-in
    "https://mykbostats.com/players/1103",  # Ryu Jin-wook
    "https://mykbostats.com/players/596",   # Kim Dae-woo
    "https://mykbostats.com/players/461",   # Kim Dae-yu
    "https://mykbostats.com/players/1790",  # Kim Hyeon-su
    "https://mykbostats.com/players/1226",  # Jang Min-je
    "https://mykbostats.com/players/2599",  # Jin Woo-young
    "https://mykbostats.com/players/1958",  # Hong Won-pyo
    "https://mykbostats.com/players/1700",  # Choi E-jun
    "https://mykbostats.com/players/2433",  # Kim Seo-hyeon
    "https://mykbostats.com/players/2185",  # Woo Kang-hoon
    "https://mykbostats.com/players/158",   # Baek Jung-hyun
    "https://mykbostats.com/players/1632",  # Park Shin-zi
    "https://mykbostats.com/players/239",   # Lee Tae-yang
    "https://mykbostats.com/players/557",   # Lee Sang-min
    "https://mykbostats.com/players/281",   # Park Jun-pyo
    "https://mykbostats.com/players/620",   # Park Min-ho
    "https://mykbostats.com/players/627",   # Park So-jun
    "https://mykbostats.com/players/2535",  # Kang Geon
    "https://mykbostats.com/players/1294",  # Seo Eui-tae
    "https://mykbostats.com/players/242",   # Im Gi-yeong
    "https://mykbostats.com/players/1673",  # Lee Chae-ho
    "https://mykbostats.com/players/1640",  # Kim Do-gyu
    "https://mykbostats.com/players/1630",  # Kim Min-gyu
    "https://mykbostats.com/players/317",   # Im Jun-seob
    "https://mykbostats.com/players/2224",  # Kim Young-hyun
    "https://mykbostats.com/players/1063",  # Seo Jin-yong
    "https://mykbostats.com/players/2127",  # Kim Ki-jung
    "https://mykbostats.com/players/1792",  # Park Jin
    "https://mykbostats.com/players/567",   # Lee Hyeong-beom
    "https://mykbostats.com/players/1124",  # Hong Joung-woo
    "https://mykbostats.com/players/2119",  # Jeong Woo-jun
    "https://mykbostats.com/players/1969",  # Kim Yun-sik
    "https://mykbostats.com/players/2545",  # Park Yun-sung
    "https://mykbostats.com/players/933",   # Chae Won-hoo
    "https://mykbostats.com/players/1828",  # Jung Woo-young
    "https://mykbostats.com/players/2048",  # Seong Jae-heon
    "https://mykbostats.com/players/1847",  # Bae Min-seo
    "https://mykbostats.com/players/2613",  # Kim Yeon-ju
    "https://mykbostats.com/players/2390",  # Yun Seok-won
    "https://mykbostats.com/players/1043",  # Baek Seung-hyeon
    "https://mykbostats.com/players/1487",  # Yoo Seung-cheol
    "https://mykbostats.com/players/1736",  # Yoon Joong-hyun
    "https://mykbostats.com/players/2729",  # Andrew Anderson
    "https://mykbostats.com/players/2732",  # Allred Cam
    "https://mykbostats.com/players/2114",  # Kim Jin-uk
    "https://mykbostats.com/players/2731",  # Jaime Barría Jaime Barría
    "https://mykbostats.com/players/2732",  # Cam Alldred
    "https://mykbostats.com/players/2018",  # Hwang Seong-bin
    "https://mykbostats.com/players/2733",  # Ryan Weiss
    "https://mykbostats.com/players/2734",  # Jordan Balazovic
    "https://mykbostats.com/players/2730",  # Shirakawa Keisho
    "https://mykbostats.com/players/1840",  # Eric Jokisch
    "https://mykbostats.com/players/2740",  # Eric Lauer
    "https://mykbostats.com/players/2737"   # Elieser Hernandez
]

# Set up a session with retry logic
session = requests.Session()
retries = Retry(total=3, backoff_factor=1, status_forcelist=[429, 500, 502, 503, 504])
session.mount('https://', HTTPAdapter(max_retries=retries))

# Headers to mimic a browser
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': 'https://mykbostats.com/'
}

# Output CSV file
with open('player_stats_2025.csv', 'w', newline='', encoding='utf-8') as csvfile:
    fieldnames = ['Player', 'URL', 'Year', 'Team', 'ERA', 'WHIP', 'W', 'L', 'SV', 'G', 'GS', 'CG', 'SHO', 'QS', 'IP', 'R', 'ER', 'H', '2B', '3B', 'HR', 'SO', 'BB', 'HB']
    writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
    writer.writeheader()

    for url in player_urls:
        try:
            response = session.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            soup = BeautifulSoup(response.content, 'html.parser')

            # Find the 2025 stats table (adjust selector based on actual HTML)
            stats_table = soup.find('table')  # Example selector
            if stats_table:
                rows = stats_table.find_all('tr')
                for row in rows:
                    cells = row.find_all('td')
                    if len(cells) > 0 and cells[0].text.strip() == '2025':
                        player_name = soup.find('h1').text.strip() if soup.find('h1') else 'Unknown'
                        stats = {
                            'Player': player_name,
                            'URL': url,
                            'Year': cells[0].text.strip(),
                            'Team': cells[1].text.strip(),
                            'ERA': cells[2].text.strip(),
                            'WHIP': cells[3].text.strip(),
                            'W': cells[4].text.strip(),
                            'L': cells[5].text.strip(),
                            'SV': cells[6].text.strip(),
                            'G': cells[7].text.strip(),
                            'GS': cells[8].text.strip(),
                            'CG': cells[9].text.strip().split('(')[0],
                            'SHO': cells[9].text.strip().split('(')[1].replace(')', '') if '(' in cells[9].text else '0',
                            'QS': cells[10].text.strip(),
                            'IP': cells[11].text.strip(),
                            'R': cells[12].text.strip(),
                            'ER': cells[13].text.strip(),
                            'H': cells[14].text.strip(),
                            '2B': cells[15].text.strip(),
                            '3B': cells[16].text.strip(),
                            'HR': cells[17].text.strip(),
                            'SO': cells[18].text.strip(),
                            'BB': cells[19].text.strip(),
                            'HB': cells[20].text.strip()
                        }
                        writer.writerow(stats)
                        break
                else:
                    # No 2025 stats found
                    player_name = soup.find('h1').text.strip() if soup.find('h1') else 'Unknown'
                    writer.writerow({'Player': player_name, 'URL': url, 'Year': 'N/A', 'Team': 'N/A', 'ERA': 'N/A'})
            else:
                player_name = soup.find('h1').text.strip() if soup.find('h1') else 'Unknown'
                writer.writerow({'Player': player_name, 'URL': url, 'Year': 'N/A', 'Team': 'N/A', 'ERA': 'N/ A'})
            
            # Add a delay to avoid rate limiting
            time.sleep(2)  # 2-second delay between requests

        except requests.RequestException as e:
            print(f"Failed to fetch {url}: {e}")
            writer.writerow({'Player': 'Unknown', 'URL': url, 'Year': 'N/A', 'Team': 'N/A', 'ERA': 'N/A'})