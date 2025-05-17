#!/usr/bin/env bash
set -euo pipefail

# Example vault setup script for dev mode
VAULT_ADDR=${VAULT_ADDR:-"http://localhost:8200"}

kubectl port-forward svc/vault 8200 &
VAULT_PID=$!

sleep 5
vault login token=root

# Populate placeholder secrets
vault kv put secret/permit API_KEY="changeme"
vault kv put secret/zitadel DB_PASSWORD="changeme"

kill $VAULT_PID
