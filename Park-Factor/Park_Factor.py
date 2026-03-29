from playwright.sync_api import sync_playwright
from bs4 import BeautifulSoup
import pandas as pd

url = "https://mykbostats.com/stats/park_splits/2025"

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False)  # Use headless mode for automation
    page = browser.new_page()
    page.goto(url)
    page.wait_for_selector('table.ui.compact.very.basic.sortable.unstackable.hsticky.table')  # Wait for the table to load
    html = page.content()  # Get the full page content
    soup = BeautifulSoup(html, 'html.parser')  # Parse the page content with BeautifulSoup
    
    # Locate the table
    table = soup.find('table', {'class': 'ui compact very basic sortable unstackable hsticky table'})
    if not table:
        raise ValueError("Table not found. Check the selector or ensure the page is fully loaded.")
    
    # Extract the first row with merged cells (categories like "Season," "Home Team," etc.)
    header_rows = table.find_all('tr')
    merged_headers = [th.text.strip() for th in header_rows[0].find_all('th')]
    
    # Extract the second row as the actual headers
    actual_headers = [th.text.strip() for th in header_rows[1].find_all('th') if th.text.strip()]
    
    # Combine merged headers and actual headers
    combined_headers = []
    for i, header in enumerate(actual_headers):
        category = merged_headers[i] if i < len(merged_headers) and merged_headers[i] else ""
        combined_headers.append(f"{category} {header}".strip())
    
    # Add "Team Name" and "Stadium" to the headers
    combined_headers = ["Team Name", "Stadium"] + combined_headers
    
    # Extract rows and split team name and stadium
    rows = []
    for row in header_rows[2:]:  # Start from the third row to skip the first two header rows
        cells = [td.text.strip() for td in row.find_all('td')]
        if cells:
            # Split the first column into Team Name and Stadium
            if "–" in cells[0]:
                team_name, stadium = cells[0].split("–")
                cells = [team_name.strip(), stadium.strip()] + cells[1:]
            else:
                cells = [cells[0], ""] + cells[1:]  # Handle cases without a stadium
            # Adjust row length to match headers
            if len(cells) < len(combined_headers):
                cells.extend([''] * (len(combined_headers) - len(cells)))  # Pad with empty strings
            elif len(cells) > len(combined_headers):
                cells = cells[:len(combined_headers)]  # Truncate extra columns
            rows.append(cells)
    
    # Ensure headers and rows align
    rows = [row + [''] * (len(combined_headers) - len(row)) for row in rows]
    combined_headers = combined_headers[:len(rows[0])]
    
    print("Headers:", combined_headers)
    print("First row:", rows[0] if rows else "No rows found")
    
    # Convert to DataFrame and save as CSV
    pd.DataFrame(rows, columns=combined_headers).to_csv('park_factor.csv', index=False)
    print("Data saved to park_factor.csv")
    
    browser.close()