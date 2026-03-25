#!/bin/sh
# Create separate database for LiteLLM
# (crucible_agent is created automatically via POSTGRES_DB)
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" <<-EOSQL
    CREATE DATABASE litellm;
EOSQL
