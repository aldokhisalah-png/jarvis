#!/bin/sh
# The backend runs the same scheduler as the app. Copy it in before deploying.
cd "$(dirname "$0")/.." && cp src/scheduler.js supabase/functions/jarvis/ && echo "synced scheduler.js → supabase/functions/jarvis/"
