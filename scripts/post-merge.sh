#!/bin/bash
set -e
pnpm install --frozen-lockfile
# --force auto-approves schema suggestions; without it, incremental changes
# (constraint swaps, new indexes) prompt for confirmation and hang on deploy.
pnpm --filter db run push-force
