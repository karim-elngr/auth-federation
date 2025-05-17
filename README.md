# Auth Federation Monorepo

This repository provides a basic structure for a local Kubernetes demo that integrates the following components:

- **Zitadel** for authentication and identity management.
- **Permit.io** as a Policy Decision Point (PDP) for authorization.
- **PostgreSQL** database backing Zitadel.
- **Caddy** web server in front of a Next.js frontend and an AdonisJS backend written in TypeScript.
- **Gloo API Gateway** for exposing services and validating tokens.
- **Flux**, **Flagger**, and **Istio** for GitOps driven deployment and progressive delivery of services.
- A sample **Java** resource server protected by Zitadel, connected with Gloo and Permit.io.

The goal is to run the entire stack locally using Kubernetes (e.g., with [Kind](https://kind.sigs.k8s.io/) or [Minikube](https://minikube.sigs.k8s.io/)).

## Repository Layout

```
├── iac/                # Infrastructure as Code for deploying core services
│   ├── clusters/       # Kubernetes cluster configuration
│   ├── zitadel/        # Helm charts or manifests for Zitadel and PostgreSQL
│   ├── permitio/       # Permit.io deployment manifests
│   └── monitoring/     # Prometheus/Grafana manifests and dashboards
├── gateway/            # Gloo API Gateway configuration
├── apps/
│   ├── frontend/       # Next.js application
│   ├── backend/        # AdonisJS API server (TypeScript)
│   └── java-service/   # Sample Java resource server
└── ops/
    ├── flux/           # Flux GitOps configuration
    └── istio/          # Istio and Flagger setup
```

Each directory contains a `README.md` explaining how to deploy the component.

## Getting Started

1. Install Docker and a local Kubernetes distribution (Kind or Minikube).
2. Clone this repository and navigate to the `iac/clusters` directory to bootstrap the cluster.
3. Apply the manifests in `iac/zitadel` to deploy Zitadel with PostgreSQL.
4. Deploy Permit.io from `iac/permitio`.
5. Deploy monitoring components from `iac/monitoring`.
6. Deploy the applications under `apps/` using the GitOps configuration in `ops/flux`.

This project is a work in progress and serves as a starting point. Contributions are welcome!

For contribution guidelines, see [AGENTS.md](AGENTS.md).