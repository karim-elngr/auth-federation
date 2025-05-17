#!/usr/bin/env bash
set -euo pipefail

# Create a local Kind cluster for development
cluster_name="demo-cluster"

kind create cluster --name "$cluster_name" "$@"
