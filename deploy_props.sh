#!/bin/bash
# DEPRECATED: prizepicks_props.json is paid data and is no longer committed to
# git or deployed as a static file (it is git-ignored). The board is published
# to Supabase by the pipeline (refresh_odds.py / publish_supabase.py) and served
# to the site through the server-gated /api/data endpoint.
#
# To push a fresh board manually, publish it to Supabase instead:
#   python publish_supabase.py
set -e
echo "deploy_props.sh is deprecated: run 'python publish_supabase.py' to publish the board to Supabase." >&2
exit 1
