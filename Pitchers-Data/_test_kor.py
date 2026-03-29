from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup

with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    page = br.new_page()
    page.goto('https://www.koreabaseball.com/Record/Player/PitcherDetail/Daily.aspx?playerId=54640', wait_until='domcontentloaded', timeout=15000)
    page.wait_for_timeout(2000)

    # Select 2025 from year dropdown
    page.select_option('#cphContents_cphContents_cphContents_ddlYear', '2025')
    page.wait_for_timeout(2000)
    # Select regular season
    # Select regular season via __doPostBack
    page.evaluate("""
        var dd = document.querySelector('#cphContents_cphContents_cphContents_ddlSeries');
        dd.value = '0';
        __doPostBack('ctl00$ctl00$ctl00$cphContents$cphContents$cphContents$ddlSeries', '');
    """)
    page.wait_for_timeout(3000)

    # Check series options value attributes
    opts = page.eval_on_selector_all('#cphContents_cphContents_cphContents_ddlSeries option', 'els => els.map(e => JSON.stringify({value: e.value, text: e.textContent, selected: e.selected}))')
    for o in opts:
        print('  Option:', o)

    soup = BeautifulSoup(page.content(), 'html.parser')
    # Search all tables
    tables = soup.select('table')
    print(f'Found {len(tables)} tables total')
    for i, t in enumerate(tables):
        rows = t.select('tbody tr')
        headers = [th.get_text(strip=True) for th in t.select('thead th')]
        print(f'  Table {i}: {len(rows)} rows, headers={headers[:5]}')
        if rows:
            cells = [td.get_text(strip=True) for td in rows[0].select('td')]
            print(f'    First row: {cells}')

    # Check for "no data" message
    no_data = soup.select_one('.no-data, .tbl-no-data, .nodata')
    if no_data:
        print(f'No data msg: {no_data.get_text(strip=True)}')

    # Check the update panel content
    udp = soup.select_one('#cphContents_cphContents_cphContents_udpRecord')
    if udp:
        print(f'UDP text: {udp.get_text(" ", strip=True)[:300]}')
    br.close()
