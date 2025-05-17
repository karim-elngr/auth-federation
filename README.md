# Auth Federation Monorepo

This repository implements the initial scaffolding for the authentication federation prototype described in [AGENTS.md](AGENTS.md).

## Repository Structure

- `infra/` – Terraform modules and scripts for infrastructure such as the Kind cluster, Postgres, and Vault.
- `k8s/` – Kubernetes manifests organized into `base` and overlay directories.
- `apps/` – Application source code for the frontend, BFF, and resource service.
- `scripts/` – Helper scripts for cluster setup and seeding secrets.

This skeleton provides a starting point for completing the full workflow outlined in `AGENTS.md`.
