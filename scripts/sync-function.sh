#!/bin/sh
# The backend runs the same engine, brain and core as the app. Copy them in before deploying.
cd "$(dirname "$0")/.." && cp src/engine.js src/brain.js src/core.js supabase/functions/jarvis/ && echo "synced engine.js brain.js core.js → supabase/functions/jarvis/"
