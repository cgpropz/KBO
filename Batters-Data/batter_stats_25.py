from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from bs4 import BeautifulSoup
import pandas as pd
import time

def get_driver():
    options = Options()
    options.add_argument("--start-maximized")
    return webdriver.Chrome(options=options)

def smooth_scroll(driver):
    for y in range(0, 6000, 500):
        driver.execute_script(f"window.scrollTo(0, {y});")
        time.sleep(0.3)

def extract_table(html):
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table")
    headers = [th.text.strip() for th in table.find_all("th")]
    rows = [[td.text.strip() for td in tr.find_all("td")] for tr in table.find_all("tr") if tr.find_all("td")]
    return pd.DataFrame(rows, columns=headers)

def scrape_kbo():
    url = "https://www.fangraphs.com/leaders/international/kbo?qual=10"
    driver = get_driver()
    driver.get(url)
    smooth_scroll(driver)
    df = extract_table(driver.page_source)
    driver.quit()
    return df

if __name__ == "__main__":
    df = scrape_kbo()
    df.to_csv("kbo_leaderboard.csv", index=False)
    print("[+] Data saved to kbo_leaderboard.csv")
