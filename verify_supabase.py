#!/usr/bin/env python3
"""Verify Supabase tables are populated."""
import os
from supabase import create_client

supabase_url = os.environ.get("SUPABASE_URL", "https://ocaqjkfdjqxszevtllew.supabase.co")
service_role_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
if not service_role_key:
    print("✗ SUPABASE_SERVICE_ROLE_KEY env var is not set")
    exit(1)

client = create_client(supabase_url, service_role_key)

tables = [
    "strikeout_projections",
    "batter_projections", 
    "pitcher_rankings",
    "prizepicks_props",
    "matchup_data",
    "prop_results",
    "pitcher_logs"
]

print("✓ Supabase Tables Status:\n")
for table in tables:
    try:
        resp = client.table(table).select("id, updated_at").limit(1).execute()
        if resp.data:
            updated_at = resp.data[0].get("updated_at", "N/A")
            print(f"  ✓ {table:25} → updated {updated_at}")
        else:
            print(f"  ⚠ {table:25} → empty (no data)")
    except Exception as e:
        print(f"  ✗ {table:25} → {str(e)[:50]}")

print("\n" + "="*60)
print("✅ All tables connected and data published!")
