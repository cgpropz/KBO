import pandas as pd

"""
Local team batting slice exporter.

Reads the full batting CSV and writes the same 11x50 slice this script
previously pushed to Google Sheets.
"""

CSV_PATH = 'league_batting_sorted.csv'
OUTPUT_PATH = 'league_batting_slice.csv'

df = pd.read_csv(CSV_PATH)
sliced = df.iloc[:11, :50]
sliced.to_csv(OUTPUT_PATH, index=False)

print(f"✅ Wrote local slice to {OUTPUT_PATH} ({len(sliced)} rows)")
