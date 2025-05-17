# AGENTS.md – AI Agent Guidelines for Kubernetes Prototype

## Overview

This document provides clear instructions for an AI agent to generate a local Kubernetes-based prototype system following our defined technology stack and project structure. It includes infrastructure setup, application scaffolding, configuration management, observability, and frontend styling guidelines.

---

## Tech Stack

### Infrastructure

* **Cluster**: Kind (Kubernetes-in-Docker)
* **IaC**: Terraform
* **Secrets Management**: Vault
* **Database**: PostgreSQL

### Applications

* **Frontend**: Next.js (TypeScript)
* **Backend (BFF)**: AdonisJS (TypeScript)
* **Resource Server**: Java Spring Boot

### Authentication & Authorization

* **Identity Provider**: Zitadel
* **Policy Decision Point (PDP)**: Permit.io
* **API Gateway**: Gloo Edge

### Networking & Ingress

* **Service Mesh**: Istio
* **Web Server**: Caddy

### Observability

* **Metrics & Dashboards**: Prometheus, Grafana
* **Tracing**: OpenTelemetry Collector
* **Logging**: Structured JSON logs (Pino for Node.js, Logback for Java)

### CI/CD

* **GitOps Tool**: Argo CD
* **Configuration Management**: Kustomize (overlays per project)

### Frontend Styling

* **CSS Framework**: Tailwind CSS
* **UI Components**: [Shadcn UI](https://ui.shadcn.com/)

### Scripting

* **Shell Automation**: Bash scripts
* **Task Runner**: Makefiles

---

## Project Structure

```plaintext
my-k8s-demo/
├── terraform/
│   ├── modules/
│   │   ├── kind_cluster/
│   │   ├── postgres_db/
│   │   └── vault_server/
│   └── environments/
│       └── dev/
├── vault/
│   ├── policies/
│   └── secrets/
├── kubernetes/
│   ├── frontend/
│   │   ├── base/
│   │   └── overlays/dev/
│   ├── backend/
│   │   ├── base/
│   │   └── overlays/dev/
│   ├── zitadel/
│   │   ├── base/
│   │   └── overlays/dev/
│   ├── permit-io/
│   │   ├── base/
│   │   └── overlays/dev/
│   ├── gloo-gateway/
│   │   ├── base/
│   │   └── overlays/dev/
│   └── observability/
│       ├── base/
│       └── overlays/dev/
├── apps/
│   ├── frontend/
│   ├── backend/
│   └── resource-server/
├── scripts/
└── docs/
```

---

## Design & Implementation Guidelines

### Application Scaffolding

* **Frontend**:

  * Next.js with TypeScript (latest version)
  * Authentication with Zitadel via NextAuth.js (latest version)
  * Styling with Tailwind CSS (latest version)
  * UI components using [Shadcn UI](https://ui.shadcn.com/) (latest version)
  * Protected pages: Reports, Admin settings

* **Backend (BFF)**:

  * AdonisJS with TypeScript (latest version)
  * JWT validation (Zitadel tokens)
  * Authorization via Permit.io
  * Structured logging using Pino

* **Resource Server**:

  * Java Spring Boot (latest version)
  * Endpoints: `/api/report-data`, `/api/settings`
  * OpenTelemetry tracing
  * Structured logging using Logback (JSON)

### Infrastructure Setup

* Terraform modules for Kind, Vault, PostgreSQL
* Kubernetes manifests managed via Kustomize
* Vault secrets injected securely into Kubernetes manifests
* Gloo Edge API Gateway for JWT validation and routing
* Istio for inter-service communication (mTLS, observability)

### Observability

* Prometheus Operator for metrics
* Grafana dashboards (pre-configured)
* OpenTelemetry collector for tracing
* JSON structured logging

### GitOps and CI/CD

* Argo CD installed in Kind cluster
* Automated syncing of Kubernetes manifests

### Secrets Management

* Vault deployment in dev mode via Terraform
* Secrets setup script (`scripts/setup-vault.sh`)

---

## PoC Use Case

* **Login via frontend (Next.js)**: Users authenticate using Zitadel.
* **JWT validation**: Handled by Gloo API Gateway.
* **Authorization checks**: BFF queries Permit.io PDP.
* **Protected resources**:

  * Reports: Accessible by VIEWER and ADMIN roles.
  * Admin settings: Accessible only by ADMIN role.
* **End-to-end tracing and logging** for request visibility.

---

## Directory README Guidelines

Each directory (`terraform/`, `vault/`, `kubernetes/`, `apps/`, `scripts/`, `docs/`) must include a `README.md` with:

* A clear summary of the directory’s purpose.
* Usage instructions and commands (if applicable).
* References to key files and configuration parameters.
* Links to relevant documentation or external resources.

---

## Helper Scripts (Makefile Targets)

* `make setup`: Initializes Kind cluster, infrastructure, and Vault.
* `make deploy`: Deploys all components using Argo CD.
* `make teardown`: Tears down the entire setup.
* `make port-forward`: Exposes services locally for testing.

---

## Testing & Validation

* Manual steps provided for initial setup of users and roles in Zitadel and Permit.io.
* Example curl commands or scripts to verify protected endpoint access.
* Instruction to view structured logs, metrics, and traces in Grafana.

---

By following this structured approach, the agent ensures consistency, reliability, and clarity in the generated project prototype.
