#!/bin/bash
# Usage: ./deploy_props.sh
# This script copies the latest prizepicks_props.json to your repo, commits, and pushes to trigger a redeploy.

set -e

# Path to your local data file
DATA_FILE="kbo-props-ui/public/data/prizepicks_props.json"

# Check if the file exists
if [ ! -f "$DATA_FILE" ]; then
  echo "Error: $DATA_FILE does not exist."
  exit 1
fi

echo "Adding $DATA_FILE to git..."
git add "$DATA_FILE"

echo "Committing changes..."
git commit -m "Update prizepicks_props.json with latest props"

echo "Pushing to remote..."
git push

echo "Done! Triggered redeploy. Check your site and /data/prizepicks_props.json after deploy."
