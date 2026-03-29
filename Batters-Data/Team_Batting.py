import pandas as pd
import gspread
from google.oauth2.service_account import Credentials

# === CONFIGURATION ===
SPREADSHEET_ID = '10QaTjfuRoKfc6rO12YOTuoYqOU90NbaD19bhjW7lymI'
RANGE_NAME = 'BW4:CW13'  # Adjust if your sheet has a different name
CSV_PATH = 'league_batting_sorted.csv'
CREDENTIALS_FILE = 'kbo-ui/credentials2.json'  # Your downloaded service account credentials

# === AUTHENTICATE ===
SCOPES = ['https://www.googleapis.com/auth/spreadsheets']
creds = Credentials.from_service_account_file(CREDENTIALS_FILE, scopes=SCOPES)
client = gspread.authorize(creds)

# === LOAD SHEET ===
sheet = client.open_by_key(SPREADSHEET_ID)
worksheet = sheet.worksheet('KBO pitcher stats')

# === READ CSV & SLICE DATA ===
df = pd.read_csv(CSV_PATH)
sliced = df.iloc[:11, :50]  # 11 rows, 50 columns = BW3:CW13
values = sliced.fillna('').values.tolist()

# === CLEAR RANGE ===
worksheet.batch_clear([RANGE_NAME])

# === UPDATE CELLS ===
worksheet.update(RANGE_NAME, values)

print("✅ Sheet updated: BW3:CW13 replaced with CSV content.")
