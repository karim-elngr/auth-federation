# DESIGN.md – Local Kubernetes Prototype Implementation Guide

## Overview

This guide describes a comprehensive plan for an AI agent (or developer) to generate a full local Kubernetes prototype project. The project integrates **authentication, authorization, microservices, and DevOps tooling** into a cohesive proof-of-concept. We will use a local Kind Kubernetes cluster to deploy all components, demonstrating how a modern cloud architecture can be assembled on a developer machine. Key technologies include **Zitadel** for identity (authn), **Permit.io** for policy-based authorization (PDP), **PostgreSQL** (as Zitadel’s database), **Vault** for secrets management, a Next.js frontend (FE), an AdonisJS backend (BFF), a Java Spring Boot resource service, **Caddy** as a web server, **Gloo API Gateway** for ingress and JWT validation, **Istio** for service mesh, **Argo CD** for GitOps CI/CD, and **Prometheus/Grafana/OpenTelemetry** for observability. We will use **Kustomize** for managing Kubernetes manifest overlays (with a focus on a development overlay) and provide **Bash/Makefile** scripts to automate setup and teardown.

This document is formatted as an `DESIGN.md` guide, meaning it lays out step-by-step instructions and a project plan with detailed task breakdowns and interdependencies. The AI agent following this guide will be able to scaffold all necessary code, configuration, and infrastructure-as-code to build the prototype. **Short summary**: the end result will allow a user to log in via the web frontend (using Zitadel for authentication), call protected APIs via the BFF (which checks authorization with Permit.io), and conditionally invoke the resource microservice based on roles (e.g. ADMIN vs VIEWER), all running on a local Kubernetes cluster.

## Architecture Overview

* **Zitadel (Auth)** – Open-source identity provider for authentication (like an open-source Auth0). It manages users and credentials, issuing JWTs (ID & access tokens) via OIDC flows. We will deploy Zitadel in the cluster with a Postgres DB for storage. For local simplicity, we will use an “insecure” dev setup of Zitadel with a basic Postgres instance. This will allow quick testing without full production hardening (e.g. disabled TLS, simple configuration). Zitadel will provide a **hosted login page** (or API) for the Next.js app to redirect users for sign-in and then return OIDC tokens.

* **PostgreSQL (Zitadel DB)** – A Postgres database to persist Zitadel data (users, sessions, etc.). We will provision this via Terraform (running either a container or a Kind node container running Postgres). The Terraform module will set up Postgres in the cluster or as an external container accessible to Zitadel. The simplest route is deploying a Postgres container **inside K8s** (using a StatefulSet or a lightweight helm chart) with known credentials, since it’s local. (Terraform could also run a Docker container for Postgres on the host if desired, but in-cluster is simpler for a self-contained Kind environment.)

* **Vault (Secrets)** – HashiCorp Vault for centralized secrets management. Vault will run in dev mode or a single-server mode in the cluster (non-HA). We’ll use it to store sensitive configuration like the Permit.io API key, database credentials, etc. We will demonstrate integration by pulling secrets from Vault and injecting them into the Kubernetes apps. For example, we might use Vault’s **Kubernetes injector** to auto-insert secrets into pod environments, or a Kustomize plugin/secret generator to fetch secrets at deploy time. This ensures we don’t hard-code secrets in our manifests. (In a simple dev setup, an alternative is retrieving secrets via a script and creating K8s secrets with Kustomize’s `secretGenerator` before deployment.)

* **Next.js Frontend (TypeScript)** – A React-based web front-end application. It will provide a UI with a login page and a couple of stub pages (e.g. a “Reports” page and an “Admin Settings” page). The Next.js app will **authenticate users via Zitadel** using OIDC. We can leverage NextAuth.js with a ZITADEL provider for simplicity. The Next.js app will initiate an OIDC Authorization Code + PKCE flow with Zitadel (redirecting to Zitadel’s hosted login, then receiving callback with tokens). Upon login, Next.js will have the user’s ID token/JWT and possibly a refresh token. It will then call the backend BFF for data. Protected pages in Next.js will only render if the user is authenticated (and possibly has a certain role, which we’ll get via the BFF or token claims). Next.js can store the ID token in memory or HttpOnly cookie and attach it in API calls to the BFF.

* **AdonisJS Backend (BFF, TypeScript)** – An AdonisJS server acting as a Backend-For-Frontend (BFF). This service will receive requests from the Next.js frontend (e.g., requests to view a report or modify a setting). The BFF will **validate the user’s JWT** (to ensure the request is authenticated – although Gloo will also handle JWT verification at the gateway level). After basic authn, the BFF will perform **authorization** checks by querying Permit.io. The BFF uses Permit.io’s Node SDK: the agent will integrate the `permitio` NPM package. A Permit **PDP (Policy Decision Point)** container will be running (in-cluster) to answer authz queries. The BFF will be configured with a Permit **API Key** and PDP address. We will store the API key in Vault and supply it as an environment variable. The Permit SDK will be initialized with our API key and the PDP URL (e.g. `http://permit-pdp:7766` if the PDP container is a K8s Service). Then, for each incoming request that needs authorization, the BFF calls `permit.check(user, action, resource)` to see if the current user can perform that action on that resource. For example:

  * For a GET `/reports` request, check if user is permitted to `"view"` the `"report"` resource.
  * For a POST `/admin/settings` request, check if user can `"modify"` the `"settings"` resource.
    The Permit PDP will have been pre-configured (via the Permit.io dashboard or API) with roles (e.g. ADMIN, VIEWER) and policies that grant those roles permission to certain actions. The check returns true/false. If permitted, the BFF then calls the downstream resource service (or returns the data if it’s stored in BFF). If not, the BFF returns a 403 Forbidden to the frontend.

  The BFF thus acts as a gatekeeper and orchestrator: clients only see the BFF’s API, and the BFF uses Permit.io to enforce role-based access. We will implement structured logging in the BFF (using a library like **Pino** for JSON logs). Pino is a fast Node.js logger that outputs structured JSON, which is ideal for parsing in production. This will ensure our logs can be correlated (and potentially include trace IDs from OpenTelemetry).

* **Java Spring Boot Microservice (Resource Server)** – A simple Spring Boot service that represents a protected resource or backend microservice. It will expose a few endpoints (e.g., `/api/report-data` and `/api/settings`) that the BFF calls. In a real system, this might query a database or perform business logic; in our prototype it can return static or stubbed data (like a fake financial report or an acknowledgment of a settings change). This service will trust that calls come from the BFF (within the cluster) and can also verify JWTs if needed. However, since BFF already checks auth and it’s internal, we may consider the BFF as the only entry point. If we want defense in depth, the resource service could also validate the JWT or require an internal service account token via Istio mTLS.

  We will add **OpenTelemetry instrumentation** to this service (using the OpenTelemetry Java Agent or SDK) so that traces are generated for requests. The service will also use **Logback** (the default Spring Boot logger) configured to JSON format (via a logback encoder like Logstash Encoder) so that logs are structured. Structured logging in Spring can be achieved by configuring a JSON encoder in `logback-spring.xml`, using libraries like `logstash-logback-encoder` (this is not strictly required for the PoC, but we include it to align with best practices in observability).

* **Caddy Web Server** – Caddy is a lightweight web server that can be used as a reverse proxy or static file server with automatic HTTPS (via Let’s Encrypt or local CA). In our architecture, Caddy will serve two purposes:

  1. Serve the Next.js frontend (if we build the Next.js app as static files or need an edge reverse proxy). For example, Next.js could be exported to static HTML/JS and Caddy can serve it, or Next.js could run as a Node server and Caddy reverse-proxies to it. For simplicity, we might run Next.js in Node mode (using `next start`) and let Caddy reverse proxy to that and also handle TLS termination.
  2. Potentially route API calls to the appropriate backend. We could configure Caddy to forward `/api/*` requests to the Gloo Gateway, while serving other paths from the Next.js frontend. This way, from the user’s perspective, there’s a single host (e.g. `localhost`) for the web UI and its APIs. Caddy excels at this kind of flexible routing and can also provide local HTTPS with self-signed certs if needed (useful if testing OIDC which might require https redirect URIs).

  However, since Gloo Gateway can also serve as an ingress, one could alternatively expose the Next.js service via Gloo as well. Our plan uses Caddy mainly for simplicity in serving the UI and consolidating traffic.

* **Gloo API Gateway** – Gloo (by Solo.io) is an Envoy-based Kubernetes API Gateway. It will be our **ingress gateway** for API traffic and will perform **JWT validation** on incoming requests. We will deploy Gloo’s open-source edition (which includes the Gloo Gateway and Envoy proxy). Gloo will be configured with a **JWT security policy** that uses Zitadel’s public keys to verify tokens. Specifically, we’ll add a JWT provider in Gloo, pointing to Zitadel’s JWKS endpoint (public key URL), and requiring tokens with the expected issuer (Zitadel) and audience. Gloo supports verifying JWTs via its JWT Auth extension, where you specify the JWKS URI and claims to check. By doing this at the gateway, any request without a valid JWT will be rejected (HTTP 401/403) **before** reaching the BFF service. This offloads authn verification from our services. Gloo will route traffic to the backend services based on the request paths/hosts:

  * `/api/bff/*` -> routes to AdonisJS BFF service
  * (Optionally, `/api/resource/*` -> could route to the Spring service if the BFF simply proxies, but in our case BFF will call the resource internally)
  * We may not route frontend through Gloo (if using Caddy for that), or we could also have Gloo serve the frontend on a separate virtual host. In this PoC, splitting responsibilities (Caddy for UI, Gloo for APIs) is straightforward.

  Gloo will be deployed in the cluster (in namespace `gloo-system`). We'll create a **VirtualService** manifest for our API routes. The VirtualService will also include the JWT authentication config (issuer, JWKS, etc.) so that Gloo enforces token verification. We will enable Gloo’s **external auth** if needed to integrate with Permit.io or other checks at the gateway (though in this architecture, we rely on the BFF + Permit for authz, rather than at gateway).

* **Istio Service Mesh** – Istio will provide a service mesh for our microservices, primarily for internal traffic management and observability. By deploying Istio, we get sidecar proxies (Envoy) in each pod for consistent telemetry and mTLS between services. Istio can also enforce policies and handle traffic shaping if needed. In this PoC, Istio’s features include:

  * **Traffic encryption**: By default, enable mTLS so that service-to-service communication inside the cluster is secure.
  * **Observability**: Istio will generate metrics and traces for service calls automatically (which Prometheus can scrape, and Kiali or Jaeger could visualize, though we only explicitly include Prom/Grafana/OTel).
  * We will deploy the Istio control plane (istiod) in the cluster, and label our application namespaces for automatic sidecar injection. This means after Istio is up, when we deploy the BFF, resource service, etc., each pod will get a sidecar.
  * Note: Gloo Edge can operate with or without Istio. We need to ensure Gloo’s proxy either bypasses Istio sidecar or works in tandem. One way is to not inject sidecar into Gloo’s namespace or use Istio’s IngressGateway instead of Gloo. In our case, we use Gloo Edge’s own proxy for external ingress, and that proxy will forward into the mesh. We might disable sidecar injection on Gloo pods, and allow Gloo to call the services directly (which have sidecars, accepting mTLS from Gloo if configured with a TLS origination or simply in plaintext if we allow it). This detail can be complex; for the PoC we can simplify by having Istio handle internal service calls and treat Gloo as an edge that speaks to services on their cluster IPs (possibly through a headless service or by calling through Istio ingress gateway – but let's avoid over-complicating: Gloo can call services via cluster IP and Istio sidecars will handle the incoming call as external traffic).

* **Argo CD (GitOps)** – Argo CD will manage continuous deployment of our manifests via a GitOps approach. We will define Argo CD Applications for each major component or grouping. The AI agent will generate the YAML manifests for Argo CD installation itself (or use the official Argo CD helm chart). After installing Argo CD in the cluster (likely in `argocd` namespace), we will create several `Application` resources (Argo CD CRs) pointing to the Git repository (which contains all our config/manifests) and specific paths. Auto-sync will be enabled on these applications so that Argo continuously ensures the cluster state matches the git state. Each Application will have `spec.syncPolicy.automated: { prune: true, selfHeal: true }` so that new changes sync and any drift is corrected. For our project, we can define Argo Applications like:

  * **infrastructure-app**: encompasses infrastructure components (Zitadel, Postgres, Vault, Istio, Gloo, maybe Argo itself if we wanted bootstrap).
  * **frontend-app**: deploys the Next.js frontend (perhaps as a Deployment and Service).
  * **bff-app**: deploys the AdonisJS BFF.
  * **resource-app**: deploys the Spring Boot service.
  * **observability-app**: deploy Prometheus, Grafana, OTel collector, etc.

  Alternatively, we might group some of these logically. The key is to structure the git repo so that each app’s manifests are in its own folder, and Argo CD is pointed to those. For example, Argo Application `frontend-app` will reference the repo path `k8s/apps/frontend` and target namespace `frontend`. Auto-sync ensures if the AI agent (or a developer) updates the manifests and pushes to git, the cluster will pull the changes. This simulates a real CI/CD pipeline where code and config changes are reflected in the cluster without manual kubectl.

* **Prometheus & Grafana (Monitoring)** – We will include a basic observability stack:

  * **Prometheus** will be deployed to scrape metrics from the cluster. Istio exports metrics (via Envoy sidecars and Mixer telemetry if enabled), and our apps can also expose metrics (e.g., Spring Boot can expose Micrometer metrics, and AdonisJS can use an Express middleware for metrics). For simplicity, we might rely on Istio’s metrics. We can use the **kube-prometheus stack** or a simple Prometheus deployment. The choice for a PoC is to use the Prometheus Operator (which the kube-prometheus stack uses) to simplify setup, along with ServiceMonitors for Istio and perhaps PodMonitors for our apps. Grafana will be set up with some dashboards (for cluster stats, and possibly an Istio dashboard). We can pre-load Grafana with dashboards for Istio or use its built-in Istio dashboard if available.
  * **OpenTelemetry Collector** – We will deploy an OTel Collector as a central point to receive traces and metrics. Our instrumented applications (the BFF and resource service) will be configured to send traces to the collector (e.g., using environment variables or config for OTel SDK/agent, pointing at the collector’s address). The collector can then log traces or export to a Jaeger backend. For brevity, we might not deploy a full Jaeger UI; instead, the collector can print traces to stdout or store them in memory. Since this is a PoC, demonstrating the instrumentation is more important than fully visualizing traces. However, if desired, we could include **Grafana Tempo** or **Jaeger** to view traces. (We will note it as an optional addition.)
  * Grafana will visualize metrics from Prometheus. We can also configure Grafana's **OpenTelemetry data source** (Tempo or trace data) if we had one. But likely we stick to metrics. Grafana could be exposed via a NodePort or port-forward for viewing.

* **Kustomize Base & Overlays** – All Kubernetes manifests will be organized with Kustomize. We will have a *base* set of manifests for each component (defining Deployments, Services, ConfigMaps, etc. with generic settings), and an overlay for the development environment. The **dev overlay** will tailor the base manifests for local use. For example, in dev we might reduce replicas to 1, use local Docker images (maybe built by the agent), use NodePort services for external access (if not using ingress), enable insecure configurations (such as Zitadel in insecure mode, Vault in dev mode), etc. We may also include some configuration specifically for demo convenience (like a pre-created default admin user or client in Zitadel using init scripts, if possible).

  The overlays allow easy future extension: e.g., one could add a “prod” overlay later with high-availability settings, but for now we focus on “dev”. Kustomize overlays provide a clean way to apply environment-specific patches on top of the base manifests. Our dev overlay might include:

  * Patching Service types to NodePort (for Grafana or other UIs, if not using ingress).
  * Adjusting resource limits downwards.
  * Using a different configuration (like enabling debug logs on apps).
  * Generator for secrets: In the dev overlay, we could use Kustomize’s `secretGenerator` to create K8s Secrets from literal values or environment files. We will tie this with Vault by running a script that fetches the actual secret values from Vault and writes them to a `.env` file which Kustomize then reads. This way, the actual secrets never live in git – only references. (In a real setup, one might use the Argo CD Vault Plugin or an External Secrets Operator, but for our scope, a manual step or script is fine.)

* **Scripts (Bash & Makefiles)** – To glue everything together, we will provide automation scripts:

  * **Terraform**: The agent will generate Terraform configuration for provisioning the local Kind cluster, Vault, and Postgres. This likely means using the Terraform **Kubernetes provider** (for resources inside the cluster), or using the **kind provider** (if one exists) to create a kind cluster. Since Kind can be created with a simple CLI, Terraform might shell out to do it (using null\_resource + local-exec). Alternatively, we can use Terraform to define a local Docker network and containers for Vault/Postgres, but running Vault/Postgres inside K8s may be simpler. We will however include Terraform configs as an exercise to manage parts of the infra declaratively:

    * A Terraform module to create a Kind cluster (if not feasible, instruct the agent to use a bash script fallback).
    * Terraform to deploy a Postgres container (maybe via Kubernetes resources or via Docker provider).
    * Terraform to deploy Vault (could use the official Vault Helm chart through Terraform’s Helm provider).
    * The Terraform could also apply some Kubernetes manifests (though mixing Terraform with Argo CD/GitOps is not typical; instead, we might restrict Terraform to infra outside of Argo’s scope).
    * Likely, we use Terraform for things that are not easily managed via Argo when bootstrapping, such as the initial cluster and perhaps installing Argo CD itself (Terraform could run `kubectl apply -n kube-system ...` or use helm provider to install Argo CD).
    * For simplicity, we might decide: **Terraform stands up Kind and maybe configures a local storage class, etc., plus optionally installs Argo CD.** Argo CD then handles the rest of deployments. Vault and Postgres can actually be deployed via Argo as normal K8s apps (no strong need for Terraform unless we wanted to show multi-tool usage). But the requirement explicitly says Terraform for local Kind, Vault, and PostgreSQL – so we will do that: Terraform config will:

      * Use the Terraform Helm provider to deploy the official **Postgres Helm chart** (e.g., Bitnami PostgreSQL) into the cluster for Zitadel’s use.
      * Use Terraform Helm provider to install Vault (Hashicorp official chart) in dev mode.
      * Possibly also use Terraform Helm to install Kind? (Not typical; might better to run Kind manually or via script, since Terraform doesn't naturally interface with Kind).
      * Alternatively, run a **null\_resource** in Terraform that calls `kind create cluster` (with a specified name and config).
    * The agent’s `AGENTS.md` will instruct how these Terraform modules are structured and when to run them.
  * **Makefile**: A top-level Makefile will provide convenient commands to run the various steps. Examples:

    * `make setup` – initialize everything (call Terraform init/apply, set up cluster).
    * `make deploy` – deploy the applications (maybe by triggering Argo sync or applying Kustomize directly if not using Argo).
    * `make port-forward` – open any necessary ports (e.g., Grafana on localhost, or Next.js if needed).
    * `make reset` or `make teardown` – destroy the Kind cluster and clean up local resources.
    * `make logs` – perhaps tail logs from all app pods (to see the structured logs).
    * `make test` – run a basic test of the flow (could be a curl script that hits an endpoint).
  * **Bash scripts**: Some logic might be easier in bash, which can be called from the Makefile. For instance:

    * `scripts/kind-create.sh` – creates the Kind cluster (if not using Terraform for that).
    * `scripts/setup-vault.sh` – after Vault is running, initialize and unseal Vault (in dev mode Vault auto-unseals) and put initial secrets (e.g., put the Permit API key into Vault KV store, put a dummy Zitadel admin password or keys).
    * `scripts/setup-zitadel.sh` – possibly use Zitadel’s CLI or API to create an OIDC client for our Next.js app and create some test users/roles. (If Zitadel has an admin API, we could automate creating an initial user “[admin@demo.com](mailto:admin@demo.com)” with password and an OAuth2 app client ID/secret that Next.js will use. This may be complex, so at least document steps required. We might for now assume a default admin user is created by Zitadel’s init container with known credentials printed in logs – need to check Zitadel’s behavior on first startup).
    * `scripts/dev-data.sh` – maybe to populate the resource service with dummy data if it had a DB (we likely skip a DB for resource service, just stub).
    * These scripts ensure that after the agent generates everything, the user can run a couple commands to bring the whole system up.

## Project Plan and Task Breakdown

Below is a breakdown of the tasks to be accomplished, in a logical order. Each task specifies its purpose, the files or configurations to be generated, and dependencies between tasks. The AI agent should follow this sequence, as many later steps rely on earlier ones being in place. Short, incremental generation of config and code for each step is encouraged to verify correctness at each stage.

### 1. Project Repository Structure

**Task**: Set up the foundational repository structure for the project. This helps organize components and separates concerns (infrastructure vs apps vs k8s manifests).

* **Description**: Create a clear directory layout in which the agent will place all generated content. A suggested structure:

  * `/infra/` – Terraform modules and scripts for infrastructure (Kind cluster, Vault, Postgres).

    * `/infra/kind/` – Terraform module or script to create Kind cluster.
    * `/infra/postgres/` – Terraform module for Postgres DB (if using K8s, could be just a Helm release via Terraform).
    * `/infra/vault/` – Terraform module for Vault (or Helm via Terraform).
    * (Optionally a single Terraform project combining these as one, with proper ordering).
  * `/k8s/` – Kubernetes manifests (organized by base and overlays):

    * `/k8s/base/` – base manifests for all components (could further split into subdirectories by component).

      * e.g., `k8s/base/zitadel/`, `k8s/base/permit-pdp/`, `k8s/base/frontend/`, `k8s/base/bff/`, `k8s/base/resource/`, `k8s/base/gateway/`, `k8s/base/istio/`, `k8s/base/observability/`, etc.
    * `/k8s/overlays/dev/` – dev overlay customization for each component. We could mirror subdirs inside dev overlay or use Kustomize’s layering with one overlay that patches multiple components.
    * Possibly `/k8s/overlays/prod/` placeholder for future.
  * `/apps/` – Source code for the applications:

    * `/apps/frontend/` – Next.js app (with a typical Next.js project structure).
    * `/apps/bff/` – AdonisJS app (Adonis has its own structure, the agent can initialize an Adonis project).
    * `/apps/resource/` – Spring Boot app (likely a Maven or Gradle project with src directories).
  * `/scripts/` – Bash scripts for automation (cluster setup, vault init, data seeding).
  * `Makefile` – at repository root for orchestration commands.
  * `AGENTS.md` – this guide (can be placed at root as documentation).

* **Deliverables**: Create an empty directory structure (as above) and possibly placeholder README files in each, so that Git picks them up. The agent should note this structure in documentation as well. No specific dependency (can be done first).

* **Dependencies**: None (foundational).

### 2. Provision Kind Cluster (Terraform & Scripts)

**Task**: Provide a means to create a local Kubernetes cluster using Kind.

* **Description**: We need a Kubernetes cluster running to deploy all services. We choose Kind (Kubernetes-in-Docker) for local environment. The agent will produce either:

  * A Terraform configuration that shells out to create a Kind cluster, or
  * A Bash script (called via Makefile) to create and configure the Kind cluster.

  Using Terraform for Kind is not straightforward via providers, so a simpler approach:

  * Use a Bash script `scripts/kind-create.sh` that calls `kind create cluster --name demo-cluster --config=...`.
  * The config file (YAML) for Kind can specify things like ingress rules or port mappings if needed. We may not need any special config aside from enabling ingress ports (but Gloo can use NodePorts or just cluster networking).
  * The script should also handle loading Docker images into Kind if the apps are built locally (so images can be pulled by cluster). e.g., after building Docker images for the apps, use `kind load docker-image`.
  * If using Argo CD, ensure the cluster’s kubeconfig is available (Kind usually auto-configures kubeconfig).

* **Terraform Alternative**: If we opt to still integrate Terraform:

  * Write a Terraform file (e.g., `infra/kind/main.tf`) that uses a Null Provider or local-exec to run the `kind` command. It can be something like:

    ```hcl
    resource "null_resource" "kind_cluster" {
      provisioner "local-exec" {
        command = "kind create cluster --name demo-cluster"
      }
    }
    ```

    This is a bit of a hack but achieves infra-as-code feel.
  * The Terraform can be triggered via `make setup` (which does `terraform -chdir=infra/kind init && terraform apply`).

* **Deliverables**:

  * `infra/kind/kind.tf` (optional): Terraform config to run Kind (with any needed provider setup).
  * `scripts/kind-create.sh`: Shell script to create the cluster (if not purely Terraform).
  * `Makefile` target `kind-create` or `setup` that calls the above.
  * Documentation in this guide on how to run it.

* **Dependencies**: None on K8s resources, but should be done before deploying any k8s manifests. (Precedes Argo, Istio, etc.)

### 3. Install Argo CD (GitOps Bootstrapping)

**Task**: Deploy Argo CD into the cluster to enable GitOps for subsequent components.

* **Description**: Use Terraform (Helm provider) or direct kubectl to install Argo CD. Argo CD’s own manifests or Helm chart can be applied. The agent should generate:

  * Either a Terraform config in `infra/argocd/` that uses the official Argo CD Helm chart (pointing to latest version).
  * Or include Argo CD’s YAML manifests (from official release) in `k8s/base/argocd/`.

  The advantage of Terraform here is that Argo CD can be considered an infrastructure component. However, including it in GitOps is also common (installing Argo CD via a lightweight `kubectl apply` then Argo takes over managing itself).

  Simpler route: The agent can provide a `kubectl apply -n argocd` command via script or Makefile using Argo CD’s official install manifest (which is often available at a static URL). Alternatively, use Helm chart via Terraform.

  Once Argo CD is installed:

  * Expose the Argo CD Server for access (in dev, we can use `kubectl port-forward` or NodePort).
  * But we will mainly interact with Argo via CLI or let it sync automatically, so UI access is optional.
  * Set Argo CD to auto-sync our applications: Actually, we will create Argo Application CRs next to tell Argo what to sync.
  * The Argo CD admin password by default is randomized; we can include a step to retrieve it (or set it to a known value via Helm values if desired for convenience).

* **Deliverables**:

  * Terraform files (e.g., `infra/argocd/main.tf`) using helm provider:

    ```hcl
    resource "helm_release" "argo_cd" {
      name       = "argocd"
      repository = "https://argoproj.github.io/argo-helm"
      chart      = "argo-cd"
      namespace  = "argocd"
      values     = [file("values.yaml")] # if needed to set service type NodePort, etc.
    }
    ```

    With minimal values enabling auto-sync (though auto-sync is per Application, configured in Application manifests, not at Argo CD install).
  * Or `k8s/base/argocd/` manifest files (like `install.yaml`).
  * A Kustomize overlay might not change anything for dev here.
  * `Makefile`: ensure `setup` runs `terraform apply` for Argo if using Terraform.

* **Dependencies**: Requires cluster (Task 2). Should be done before deploying other apps via GitOps.

### 4. Define Argo CD Applications (GitOps config)

**Task**: Create Argo CD `Application` manifest(s) to declaratively tell Argo what to deploy.

* **Description**: Now that Argo CD is running, we configure it to track the rest of our manifests. The agent will generate YAML for one or multiple Argo CD Application resources. Each Application will point to the git repo (e.g., could use a placeholder like “local-git” if not pushing to remote – but typically Argo needs a repo URL. We might assume the user will push this project to a GitHub repository and update the Application spec accordingly). For now, in the plan, mention using a repo URL or path.

  Key fields for an ArgoCD Application:

  ```yaml
  apiVersion: argoproj.io/v1alpha1
  kind: Application
  metadata:
    name: frontend-app   # unique app name
    namespace: argocd    # Argo CD's namespace
  spec:
    project: default
    source:
      repoURL: <git_repo_url>
      targetRevision: HEAD   # or main
      path: k8s/overlays/dev/frontend   # path within repo to kustomize overlay
    destination:
      server: https://kubernetes.default.svc
      namespace: frontend    # namespace in cluster to deploy to
    syncPolicy:
      automated:
        prune: true
        selfHeal: true
  ```

  We will have similar definitions for bff, resource, infrastructure, etc. Alternatively, we can have a single `Application` that references the `dev` overlay top folder to deploy everything in one go. But separating is cleaner to see each component’s status in Argo UI.

  We also include `spec.syncPolicy.automated` to enable auto-sync, and possibly `spec.syncPolicy.automated.prune: true` so Argo prunes deleted resources, and `selfHeal: true` so it auto-corrects drift. This fulfills the auto-sync requirement.

* **Interdependencies**: The Argo Application manifests should be applied after Argo CD is up (Argo will then pick them up, either by auto-discovery if we `kubectl apply` them to `argocd` namespace, or by Argo monitoring its own namespace). We might just apply these manually via kubectl (could automate in Terraform or script) to bootstrap Argo’s knowledge.

* **Deliverables**:

  * `k8s/base/argocd/applications/` – YAML files for each Application CR.
  * Optionally, if Argo CD itself is installed via Kustomize (less likely), include them in overlay so they get applied by Argo itself in a chicken-egg scenario. More straightforward: after Argo installed, run a one-time `kubectl apply` of these App CRs (could be in Makefile).
  * Ensure that the paths in spec.source.path correspond to our actual repository structure.

* **Dependencies**: Argo CD installed (Task 3). The actual app manifests (tasks below) need to exist in repo so that Argo can sync them; however, we can create Applications now and they’ll sync once manifests appear (Argo might show missing manifests until then). It might be better to have at least stub manifests for each component ready by this point. Alternatively, generate everything first then apply to Argo in one shot. For planning, we can proceed to create manifests in parallel and then apply them.

### 5. Deploy Core Infrastructure: PostgreSQL Database

**Task**: Set up the PostgreSQL database for Zitadel using Terraform (and Helm).

* **Description**: Zitadel requires a Postgres database. We'll deploy one in the cluster for convenience. The agent uses Terraform’s Helm provider to deploy a Postgres chart (e.g., Bitnami’s PostgreSQL). This will create a `StatefulSet` for Postgres and a `Service`. Key configuration:

  * Set a database name (e.g., "zitadel"), user, and password. Use values in Terraform to set these (or accept Bitnami defaults and retrieve them).
  * For dev, use a simple configuration (single replica, no persistence or ephemeral storage).
  * Terraform can output the connection info or credentials. We should store the password in Vault (Terraform can provision it then put into Vault via Vault provider or via scripts).
  * Alternatively, we can skip Helm and directly deploy a minimal Postgres using a container image with a PersistentVolumeClaim. But the Helm chart is quicker.

* **Integration**: Zitadel will need to know the DB connection (host, port, user, pass). These will be provided as env vars or config map to Zitadel deployment. We’ll supply those via Kustomize secretGenerators from Vault or Terraform output. Possibly:

  * Terraform generates the password and stores it in Vault KV.
  * The Zitadel Kustomize overlay has a generator that fetches from Vault (if plugin) or we run a script to fetch and patch it in.

* **Deliverables**:

  * Terraform files in `infra/postgres/` (maybe integrated in one main Terraform with Vault).
  * For instance, `postgres.tf` with:

    ```hcl
    resource "helm_release" "postgres" {
      name       = "postgres"
      repository = "https://charts.bitnami.com/bitnami"
      chart      = "postgresql"
      namespace  = "zitadel-db"
      values = [ templatefile("${path.module}/values.yaml", { db_name = "zitadel", ... }) ]
    }
    ```
  * A Terraform `output` for the DB credentials (or store in Vault).
  * If not using Terraform for DB, then K8s manifests for Postgres (StatefulSet, Service, Secret).

* **Dependencies**: Kind cluster up (Task 2). Could be deployed via Argo if we treat it as part of infra manifests; but the problem is circular if Zitadel needs DB ready. In practice, it’s fine if we apply all together, but to ensure ordering, we might deploy Postgres first. Possibly keep Postgres as part of the "infrastructure-app" Argo application that includes Zitadel – then we rely on k8s scheduling (Zitadel container will crash-loop until DB is ready). Alternatively, use an initContainer in Zitadel to wait for DB.

### 6. Deploy Core Infrastructure: Zitadel (Identity Provider)

**Task**: Deploy the Zitadel identity service onto the cluster.

* **Description**: We will run Zitadel as a container (from ZITADEL’s Docker image). The official method is via their Helm chart, but we can also manually create a Deployment and Service using the image. However, using their Helm might simplify config (they might have multiple components). If we use Helm, we can include it in Terraform or just reference the output manifests. For the sake of learning, let’s outline manual K8s specs:

  * **Deployment**: run one replica of `zitadel` container. It likely needs several environment variables or a config file to point to Postgres. According to Zitadel docs, you provide DB connection, etc., and they have an init job to setup the DB schema.
  * Possibly mount a volume for persistent state (but mostly DB covers state; maybe key material could be ephemeral if not using KMS).
  * For dev insecure mode, we might need to set environment like `ZITADEL_OPENSSL_SKIP_VERIFY=true` or similar, and perhaps disable TLS.
  * Check Zitadel charts for required values: e.g., database DSN, an admin password, etc.
  * If complexity is high, we could lean on the example: *Insecure Postgres Example* from Zitadel’s charts. That suggests a straightforward local setup. Perhaps that example values file could be translated to env vars.
  * **Service**: expose Zitadel (it has a UI for login). We'll likely need to access Zitadel’s endpoint from the Next.js app for OIDC (redirect URI). Zitadel typically runs on HTTPS. For dev, we can use HTTP if easier. Possibly better to stick to HTTP on local. We might route to it via Caddy or just use NodePort for direct access.
  * The Next.js app will redirect to Zitadel’s issuer URL (which in cloud would be something like `https://<tenant>.zitadel.cloud`). Here it might be `http://zitadel.zitadel-ns.svc.cluster.local:8080`, which is not accessible from browser. We need Zitadel accessible to the browser for auth. Maybe easiest: run Caddy as a reverse proxy for Zitadel too on localhost (or simply expose Zitadel on localhost:8080). Alternatively, skip custom domain and access by NodePort `localhost:<port>`; then configure that as OIDC issuer in Zitadel.
  * We will have to **configure Zitadel** (create an instance, a project, an OAuth2 app for our frontend). Possibly, the Zitadel deployment in insecure mode auto-creates a default instance and admin. The operator (us) then can use CLI or API to create the app client. This might be too deep to fully automate; we can document manual steps or have a script using Zitadel’s `zitadelctl` or `zita CLI`.
  * For this PoC, we can simplify: assume a default OIDC client and user exist for demo, or instruct the user to create them via Zitadel UI.

* **Deliverables**:

  * `k8s/base/zitadel/deployment.yaml` and `service.yaml` (or one Kustomize manifest).
  * ConfigMap/Secret for Zitadel config (with DB credentials, etc.).
  * In dev overlay, patch to ensure insecure mode and set any dev secrets (like putting DB password from Vault).
  * Possibly a note in documentation referencing Zitadel’s insecure setup guide.

* **Dependencies**: Postgres (Task 5) should be available. Vault (Task 7) if we fetch DB creds from Vault for Zitadel.

### 7. Deploy Core Infrastructure: Vault (Secrets Manager)

**Task**: Deploy HashiCorp Vault to the cluster (dev mode or single-node).

* **Description**: Use Terraform Helm to deploy Vault (official chart). Configure it in **dev mode** for simplicity (no unseal keys needed, runs in-memory).

  * Dev mode will store secrets in memory; on restart, secrets are lost – acceptable for local testing.
  * Alternatively, use file storage or a PVC to preserve secrets across restarts.
  * Enable the Kubernetes auth backend if we planned to use Vault injector (not strictly needed if we just CLI in).
  * For now, simpler: we will interact with Vault via CLI/API from host (using `vault` CLI port-forwarded to dev server).
  * Once Vault is running, the agent will need to **seed required secrets**:

    * A Permit.io API Key: The user must obtain this from Permit.io dashboard for their environment. We will instruct to set it as an environment variable or put it into Vault manually (the agent could generate a dummy placeholder).
    * Possibly Zitadel DB password (Terraform might know it if random, so Terraform could directly put it into Vault via a provider).
    * Possibly credentials for any other service (but likely just these two for now).
  * We will create a KV store in Vault (e.g., path `secret/data/permit` with key=API\_KEY, or using Vault’s KV v2).
  * The Vault root token (dev mode) will be known (printed in logs). Our script can use it to login and put secrets.

* **Deliverables**:

  * Terraform in `infra/vault/` to install Vault via helm.
  * Or K8s manifest for Vault (Deployment/StatefulSet, Service).
  * Script `scripts/setup-vault.sh`: after Vault pod is ready, do:

    ```bash
    export VAULT_ADDR=http://localhost:8200
    kubectl port-forward svc/vault 8200 &
    vault login token=<dev-root-token>
    vault kv put secret/permit API_KEY=<PermitEnvAPIKey>
    vault kv put secret/zitadel DB_PASSWORD=<postgres-password>
    ```

    etc. The script can either accept env vars or read from a local file the actual secrets (to avoid hardcoding in repo).
  * The Kustomize secretGenerators: In `k8s/overlays/dev/`, include a generator that pulls these values. If not using a plugin, an alternative:

    * Have the vault setup script output a `.env` file like `secrets.env` with lines `PERMIT_API_KEY=...` and `ZITADEL_DB_PASSWORD=...`.
    * In kustomization.yaml for dev, do:

      ```yaml
      secretGenerator:
      - name: permit-secret
        envs: ["secrets.env"]
      ```

      This will create a K8s Secret with those keys for use by BFF (for Permit) and Zitadel (for DB) respectively.
    * Mark `secrets.env` in .gitignore since it contains sensitive data.
  * Update Deployment manifests for BFF and Zitadel to reference those secrets (e.g., envFrom or specific env var from secret).

* **Dependencies**: Cluster up (Task 2). Should ideally be available before deploying apps that need secrets. But since we are doing GitOps, we might deploy Vault alongside others. However, to avoid race conditions (apps starting without secrets), one strategy is to not start BFF until Vault secrets are populated. But our approach using secretGenerator will create the secrets in manifests, so as long as those secret values are present at kubectl apply time, pods will have them. Thus, ensure `secrets.env` is present before Argo applies manifests (meaning run Vault setup script before Argo sync or as part of cluster bootstrap).

### 8. Develop and Containerize Frontend (Next.js) Application

**Task**: Scaffold the Next.js application, implement authentication flow with Zitadel, and create a Docker image for it.

* **Description**: Use a Next.js TypeScript template (e.g., `npx create-next-app`) to scaffold the project in `/apps/frontend`. Key implementation details:

  * Install and configure **NextAuth.js** (a popular auth library for Next.js) with a Zitadel provider. Zitadel is OIDC-compliant, so NextAuth can use the generic OAuth provider or a custom one if provided by Zitadel docs. The provider will need:

    * `clientId` and `clientSecret` of the OAuth app registered in Zitadel.
    * `issuer` URL (Zitadel’s OIDC issuer, e.g., `http://<zitadel-domain>/oauth/v2` or similar).
    * If using Zitadel Cloud, it’s something like `https://<tenant>.zitadel.<region>.apps`. For self-hosted, likely `http://<zitadel-service>` if accessible.
    * For now, if we haven't created an OAuth client manually, we might run Zitadel in a default config that allows password grant or some insecure flow – but better to simulate a real OIDC code flow.
    * Possibly we can use Zitadel’s default login page by redirecting to it (NextAuth takes care of that).
  * Create a basic UI:

    * **Home page**: with a “Login” button. If user not logged in, show login. If logged in, show a welcome and maybe user info from JWT.
    * **Reports page** (`/reports`): Protected page that calls the BFF’s `/api/reports` endpoint to fetch some report data (which the BFF, if authorized, will get from resource service). This page should only be accessible if the user has VIEWER or ADMIN role. We can enforce that by checking a user’s role (which we might store in the JWT or fetch from BFF).

      * Simpler: front-end trusts the BFF to deny if no access. So just show an error if API call returns 403. Alternatively, the frontend might have a user profile that includes roles and can hide the link if not admin. As a stub, we assume roles are in JWT (Zitadel can include roles via custom claims or via groups membership).
    * **Admin page** (`/admin`): Protected page for ADMIN role. Allows an admin to click a button “Modify Settings” which triggers a POST `/api/settings` to BFF. The BFF will allow only admin via Permit.
  * Next.js will use SSR or CSR? We might keep it mostly client-side rendering with API routes for NextAuth (which need a server component).

    * NextAuth requires an API route (`/api/auth/[...nextauth].js`) to handle callbacks.
    * That means the Next.js app cannot be purely static – it needs to run as a Node server to handle OIDC callbacks and sessions.
    * So our container will run `npm run build && npm run start`.
    * Caddy can still front it for proxy.
  * Environment configuration:

    * The Next.js server needs the NextAuth config: which includes clientSecret, etc. We should not expose clientSecret to browser, but server side needs it to exchange code for tokens.
    * These can be provided as env vars to the container (NEXTAUTH\_URL, NEXTAUTH\_SECRET for session encryption, and provider details).
    * We will store those in Vault as well (like a Zitadel client secret). But if not automating creation, we could set up an dummy environment if using some dev trick. Alternatively, maybe skip NextAuth and do implicit flow to skip needing client secret (not recommended normally, but for dev we could treat the Next.js as a public client with PKCE and no secret). Actually, PKCE with no secret is typical for SPA, but NextAuth by default expects a secret for server-side flow. It might allow PKCE only flows if configured as public client.
    * For now, let's assume we have a client ID and secret from Zitadel. We'll put them in Vault and then secret env.
  * Logging: add a middleware or use Next.js built-in logging. Not as crucial on frontend, but we can add some console logs or use Next.js’ logger. The main structured logging focus is on backend services.
  * **Dockerization**: Create a Dockerfile for the Next.js app (`apps/frontend/Dockerfile`).

    * Use Node 18 base image, copy code, `RUN npm install && npm run build`.
    * Set entrypoint to `npm run start`.
    * In K8s, this will be a Deployment with container exposing port 3000.
    * For dev, we can either use NodePorts or have Caddy route to this service.
  * K8s manifests: in `k8s/base/frontend/`:

    * Deployment (image will be something like `frontend:dev` tag if built locally, or the agent might push to an image registry accessible to cluster. Simpler: use Kind’s ability to load local images).
    * Service (ClusterIP, maybe called `frontend`).
    * In dev overlay: no changes unless needed to set NodePort or adjust image tag.
    * We may not directly expose the frontend service outside cluster if using Caddy or Argo CD. But we could define an Ingress or route through Caddy container.
  * Interdependency: The frontend depends on Zitadel (for OIDC) and on BFF API to be functioning. But it can be developed independently and show errors if those are down. In terms of deployment order, no strict requirement as long as all come up eventually.

* **Deliverables**:

  * Next.js project files under `/apps/frontend` (e.g., `pages/index.tsx`, `pages/reports.tsx`, `pages/admin.tsx`, `pages/api/auth/[...nextauth].ts` for NextAuth callbacks).
  * NextAuth configuration to use Zitadel (likely in `[...nextauth].ts` or in a NextAuth config file).
  * Dockerfile for frontend.
  * Kubernetes manifests for deployment and service.
  * Env var placeholders for client ID/secret etc., which will be wired to secrets (from Vault).
  * Documentation in code or here on how to set redirect URIs in Zitadel (should match where NextAuth is running, e.g., `http://localhost:3000/api/auth/callback/zitadel`).

* **Dependencies**: Zitadel must be accessible (the OIDC endpoints) and configured with an OAuth client that matches our Next app. We assume by the time of testing, Zitadel is configured. Development of Next.js itself can proceed without the cluster up (just hitting a dummy auth if needed), but integrated testing requires Zitadel running. For deployment, depends on Argo (if using Argo to deploy it) or at least cluster available. In plan, it’s fine to scaffold anytime before final deployment.

### 9. Develop and Containerize Backend BFF (AdonisJS) Application

**Task**: Scaffold the AdonisJS backend, implement protected endpoints and Permit.io integration, and containerize it.

* **Description**: Use AdonisJS (a Node.js MVC framework) to create the BFF project in `/apps/bff`. Steps:

  * Initialize an AdonisJS app (they have a CLI like `npm init adonis-ts app`).
  * Set up routing/controllers:

    * `GET /api/reports` – Controller action that:

      * Extracts user identity from request. Since we have JWTs, options:

        * Rely on Gloo to verify JWT and maybe propagate user info in headers (some gateways forward JWT claims).
        * Or simply decode JWT in the BFF. The BFF can decode the JWT (using a library or the Permit SDK might parse it).
        * At minimum, get the user’s unique ID (sub or email) and any claim like roles or permissions (though roles might be managed in Permit, not in the token).
      * Call Permit SDK’s `check` method to verify if user is allowed "view" on "report".
      * If permitted, forward the request to the resource service. This can be done via an HTTP call from the BFF to the resource service’s endpoint (e.g., GET `http://resource-service.default.svc.cluster.local:8080/api/report-data`). In a real scenario, one might use an internal service client or gRPC; we can use simple `axios` or `node-fetch`.
      * Get the data (stubbed) and return to frontend. If not permitted, return 403.
    * `POST /api/settings` – Controller that checks if user can "modify" "settings":

      * If yes, call resource service’s settings endpoint (or just simulate a change and respond with success).
      * If not, 403.
    * Potentially, a `GET /api/user` that returns some profile info or roles for the frontend to display (though the frontend could parse JWT itself, but having an API ensures the FE doesn’t need to decode JWT).
  * Permit.io setup:

    * Install `permitio` NPM package.
    * Initialize Permit in AdonisJS. Possibly in a global middleware or in the controller constructor:

      ```ts
      import { Permit } from 'permitio';
      const permit = new Permit({
        token: process.env.PERMIT_API_KEY,
        pdp: process.env.PERMIT_PDP_URL || "http://permit-pdp.default.svc.cluster.local:7766",
      });
      ```

      This uses the Permit PDP container’s URL (if running in same cluster, use service discovery).
      Use the API key from env (which we will set from Vault secret).
    * Use `await permit.check(userId, action, resource)` to decide.
    * Note: We should ensure the Permit PDP is deployed (we will do that in a later task, but logically it's part of "authorization infra").
  * Logging: integrate Pino for JSON logging. In Adonis, perhaps use a global middleware to log each request with Pino, or configure Adonis logger to use Pino transport. If time, just use Pino standalone.
  * Containerization:

    * Dockerfile for BFF (similar to frontend: Node image, install deps, build (if Adonis uses compile step), then start).
    * Expose port (say 3333 if Adonis default, or 3001).
  * K8s:

    * Deployment and Service for BFF.
    * Environment variables:

      * `PERMIT_API_KEY` – from secret.
      * `PERMIT_PDP_URL` – the URL or service address of the PDP. If using a K8s Service for PDP (we will run PDP as deployment, likely name `permit-pdp`), we can set `http://permit-pdp:7000` (depending on port).
      * Possibly `ZITADEL_ISSUER` or `JWKS_URL` if BFF wants to double-verify JWTs. Could incorporate JWT verification by pulling Zitadel’s JWKS. But since Gloo is verifying, we might skip BFF JWT verify to avoid duplication. Maybe just trust that if request hit BFF, it’s authenticated.
      * Still, grabbing user identity from JWT requires decoding it. We can either:

        * Accept a header from Gloo (some gateways forward an authenticated user header or the entire token).
        * Or read the `Authorization: Bearer <token>` header (which Gloo will pass along) and decode. Using a library like `jsonwebtoken` with Zitadel’s public key. But to simplify, since Permit needs the user ID, we might just take the JWT’s sub claim. We can decode without verify (since Gloo did verify).
        * Implementation detail: likely okay to decode without verifying signature again.
  * Permit PDP (Permit.io container):

    * The BFF expects a PDP running. We should deploy Permit’s PDP as part of our infrastructure:

      * It’s a Docker image `permitio/pdp-v2:latest`.
      * We run it in K8s as a Deployment (one replica is fine).
      * Set env `PDP_API_KEY=<Permit API Key>` inside the container. (This API key is the same one BFF uses – it authenticates the PDP to Permit cloud to fetch policies.)
      * The PDP by default listens on port 7000 internally; we can map that to service port 7766 as in docs.
      * The BFF will call it at `permit-pdp:7000` (if within cluster).
      * If we want PDP logs, we can set `PDP_DEBUG=true` as env as well.
      * The PDP container doesn’t need to be exposed outside cluster.
      * We'll include this in the "authorization infrastructure" deployment.
  * The Permit PDP should start before BFF tries to use it, but if not, BFF should handle failures gracefully (Permit SDK by default might just return false if PDP unreachable, unless `throwOnError` set).
* **Deliverables**:

  * AdonisJS project files in `/apps/bff`.
  * Routes/controllers for reports and settings.
  * Permit integration code.
  * Dockerfile for BFF.
  * K8s manifests for BFF Deployment/Service, including necessary env vars and secret mounts.
  * K8s manifests for Permit PDP Deployment/Service as part of base (could be in a `permit/` or `authz/` subfolder).
  * Secret and config wiring for Permit (via Vault as done).
* **Dependencies**:

  * Vault (for API key secret).
  * Permit.io account (for actual API key and an existing policy configuration with roles/resources).
  * Permit PDP container deployed in cluster (to be done, likely concurrently in infra).
  * Zitadel for user IDs (though BFF can run without Zitadel up, but to complete auth flow needs real users & tokens).
  * For sequencing, ensure Permit PDP (infra) is deployed by Argo before or alongside BFF. Typically, if both are in Argo, not guaranteed order but usually fine. Could add an initContainer in BFF to wait for PDP service to be up by pinging it.

### 10. Develop and Containerize Resource Service (Spring Boot)

**Task**: Implement the Java Spring Boot microservice and containerize it.

* **Description**: Use Spring Initializer to scaffold a basic Spring Boot project in `/apps/resource`. Key aspects:

  * Dependencies: Spring Web (for REST), possibly Spring Security (if we wanted JWT validation here too), Micrometer (for metrics), Logback/Logstash encoder (for JSON logging), OpenTelemetry instrumentation.
  * Controllers:

    * `GET /api/report-data`: returns some dummy data, e.g., a JSON object or list representing a report (like a list of financial metrics). This will be called by BFF if user has view permission.
    * `POST /api/settings`: accepts some input (or not) and returns success. This simulates changing a setting. Called by BFF if user has modify permission. Could just log that setting was changed.
  * Security:

    * We can keep this open to internal calls. Optionally, to illustrate trust boundaries, we could secure it so only requests with a valid JWT from BFF are accepted. If BFF forwards the user’s JWT, the service could validate it as an extra layer:

      * If we do so, we’d configure Spring Security with a JWT filter using Zitadel’s public keys (JWKS). However, since BFF might not forward the token if it’s doing a server-to-server call as itself, an easier internal trust is to have BFF call with its own service account token or basic auth. This might overcomplicate. Likely skip additional auth on this service for now or just restrict network via cluster (which is fine in a mesh environment).
    * The service is internal, so relying on network isolation and the BFF’s checks is acceptable for a prototype.
  * Observability:

    * Add OpenTelemetry instrumentation. Two ways: use the OpenTelemetry Java Agent (which can be added at runtime by adding `-javaagent:opentelemetry-javaagent.jar` to JVM, and configuring OTEL exporter env vars) or use the Spring Boot OTel Starter. For simplicity, agent approach:

      * Include the opentelemetry agent JAR in the image (or download it in Dockerfile).
      * Set env `OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4317` (if we deploy a collector).
      * This will capture incoming HTTP requests and outgoing (if any) automatically.
    * Alternatively, integrate manually with the OpenTelemetry API to create spans when processing requests. Possibly overkill; agent auto-instrumentation is fine.
  * Logging:

    * Configure Logback to JSON. One quick method: include `net.logstash.logback:logstash-logback-encoder` dependency and add a snippet in `logback-spring.xml`:

      ```xml
      <appender name="STDOUT" class="ch.qos.logback.core.ConsoleAppender">
          <encoder class="net.logstash.logback.encoder.LogstashEncoder"/>
      </appender>
      <root level="INFO">
          <appender-ref ref="STDOUT"/>
      </root>
      ```

      This outputs pure JSON for each log line, which can be parsed by tools.
    * Also ensure log lines include trace ID from OTel (there’s MDC integration possible).
  * Dockerization:

    * Dockerfile using a Java 17 image. Could use Maven to build the jar, then a slim Java runtime image to run it.
    * Expose port 8080.
  * K8s:

    * Deployment (with perhaps readiness probe on the health endpoint).
    * Service (ClusterIP).
    * Possibly label it such that Istio sidecar is injected (if we labeled namespace, it's automatic).
    * Environment:

      * If the service was to verify JWTs, we’d need Zitadel JWKS URL (which is something like `http(s)://<zitadel>/oauth/v2/keys`). If doing this, put that in config. If not, no special env.
      * OTel collector address (if using agent, configured via env).
      * We might set `SPRING_PROFILES_ACTIVE=dev` to use any dev configs.
  * This service doesn’t depend on external systems except possibly a database if we wanted to simulate data storage. We can skip a database; the data can be static in memory or generated.

* **Deliverables**:

  * Spring Boot project files in `/apps/resource` (including `pom.xml/gradle.build`, source files under `src/main/java`).
  * Controller classes for endpoints.
  * Config files (application.yaml for any configs like log format if needed).
  * Logback config with JSON encoding.
  * Dockerfile.
  * K8s manifest for deployment and service.
  * Possibly a ConfigMap for OTel or other configs.

* **Dependencies**:

  * None major at development time, but at runtime the BFF should be up to call it. The service itself just starts. It may benefit from Istio (if OTel agent uses OTLP, ensure collector is up to receive traces).
  * Prometheus scraping: If using Prom, include actuator metrics or add an annotation so Prom operator picks it up.

### 11. Deploy Istio Service Mesh

**Task**: Install Istio into the cluster and enable sidecar injection.

* **Description**: Use Istio’s installation (likely via `istioctl` or Helm). Simplest for an agent:

  * Terraform using Helm chart for Istio base and Istio discovery.
  * Or include Istio’s operator manifest in K8s base.
  * Possibly use the minimal profile to reduce resource usage.
  * We want the Istio control plane (istiod) and default ingress gateway (though we might not use Istio ingress because we have Gloo).
  * Sidecar injection: label the namespaces of our apps (e.g., `frontend`, `backend`, `resource`) with `istio-injection=enabled`.
  * If Gloo Edge is in place, we might exclude it from mesh (do not label `gloo-system`).
  * Confirm that inter-service calls (BFF -> resource) go through sidecars for trace capturing.
  * Configure global mTLS (can use default which usually is PERMISSIVE in demo, we can set STRICT if everything supports it).
  * We might not need custom VirtualServices or DestinationRules on Istio because Gloo is handling external routes. But internally, Istio will handle service-to-service. If needed, add an `AuthenticationPolicy` to require JWT for resource service if we wanted; but we won't complicate that now.
  * Ensure Prometheus can scrape Envoy metrics (if we deploy Prom after Istio, and if using Prom operator, the Istio chart might deploy an operator or config to support scraping).
  * The Istio installation should ideally be done before apps deploy (so sidecars inject at app startup).

* **Deliverables**:

  * Terraform or K8s manifests for Istio:

    * Could use IstioOperator CR via `istioctl manifest generate` output.
    * Or use Helm chart `istiod`.
  * Namespace labeling as part of Kustomize overlay or a k8s manifest (Namespace manifests with label).
  * Documentation about sidecar injection.

* **Dependencies**: Cluster up (Task 2). If using Argo, ensure Argo doesn’t try to deploy apps before Istio is ready, or else first attempt will have no sidecars (not fatal, but to fully mesh, better if Istio is in place). We could include Istio in infra-app Argo application so it syncs early.

### 12. Deploy Gloo API Gateway

**Task**: Install Gloo Edge (open source) and configure routing and JWT auth.

* **Description**: Use Helm or manifests to install Gloo components:

  * Typically, Gloo consists of a `gloo` deployment (control plane) and an `envoy` deployment (data plane proxy), plus perhaps discovery.
  * Use their Helm chart for Gloo Edge (which sets up in `gloo-system` namespace).
  * After installation, configure our API routes:

    * Create a `VirtualService` in `gloo-system` (or another ns that Gloo watches). The VirtualService:

      * `domains: ["*"]` (for simplicity, since we might not have DNS for localhost).
      * route prefix `/api/` (or specifically `/api/` to BFF, we might just route all `/api` to BFF upstream).
      * Upstream in Gloo terms could be auto-discovered cluster service. Gloo typically discovers services; we can refer to the BFF service by name.
      * If needed, we could set up two routes: `/api/resource` to resource service, but since BFF will call resource internally, maybe not expose resource at gateway at all.
      * We might route everything under `/api/` to BFF, and BFF internally splits or forwards appropriately.
    * JWT verification config:

      * Add `options: jwt:` section with `providers:` in the VirtualService or a separate `AuthConfig` depending on Gloo version. Provide:

        * issuer URL (Zitadel issuer, which is something like `http://zitadel.default.svc.cluster.local:80` or if accessible externally via Caddy at `http://localhost:8080`).
        * JWKS endpoint (Zitadel’s JWKS JSON URL, perhaps `http://zitadel/oauth/v2/keys` if available internally).
        * Audiences (the client ID or allowed audiences).
      * This will make Envoy verify the token on each request to that VirtualService.
    * Possibly we enable OIDC flow in Gloo (it can act as OIDC client too) but that's not needed here since Next.js handles login.
  * Exposing Gloo:

    * On local, Gloo by default might expose Envoy via a LoadBalancer service that remains pending. We'll change it to NodePort for kind.
    * Helm values can set gateway proxy service type NodePort and specify the port (e.g., 80 -> NodePort 32000, 443->32001).
    * Then Caddy could forward or we can directly hit NodePort for /api. If using Caddy, we might not need NodePort, since Caddy can proxy to the Envoy ClusterIP if Caddy runs in cluster. But Caddy likely runs in cluster too, then it can directly call Envoy’s cluster IP\:port. Actually, an idea:

      * Run Caddy as a sidecar with Next.js? Or separate Deployment. Possibly separate because Next.js is SSR needing Node.
      * If separate, how does Caddy talk to Envoy? If in cluster, via service. Or we expose Envoy at NodePort and Caddy (in cluster) could call host.docker.internal or something – messy.
      * Better, run Caddy outside cluster as a local reverse proxy? But then not managed by k8s.
      * Simpler: just have Next.js call Envoy’s NodePort directly (like `http://localhost:32000/api/...`). Then you don’t need Caddy to proxy /api, Next.js can call that. Next.js runs in browser making requests to NodePort – that’s fine as long as we configure CORs or same origin issues. If Next.js is served on say [http://localhost](http://localhost) (maybe via Caddy on 80) and API is on another port, you get a different origin, but you can manage with appropriate CORS headers from BFF.
      * Actually, easiest: serve Next.js on say [http://localhost:3000](http://localhost:3000) (via Node), and have Gloo on [http://localhost:32000](http://localhost:32000). Next.js calling 32000 is cross-origin. We should enable CORS on BFF or at Gloo to allow that. Or align origins by putting everything under one domain via proxy.
      * Possibly incorporate Caddy to unify, but let's not overcomplicate. We can allow CORS in BFF for dev.
  * Summation: Use NodePort for Gloo Proxy, document that as API base URL for frontend (set e.g. NEXT\_PUBLIC\_API\_URL).
  * Deploy any custom config (VirtualService YAML) via Argo as part of Gloo or infra.

* **Deliverables**:

  * Terraform/Helm config for Gloo installation.
  * VirtualService manifest (with routes and JWT config).
  * Helm values override to use NodePorts.
  * Kustomize overlay patch to adjust Gloo service type if needed.
  * Possibly an `Upstream` custom resource if needed (but likely not, Gloo autodetects Kubernetes services by labels).
  * Documentation snippet that JWT verification is in place (so only valid tokens get through).

* **Dependencies**: Istio (if it impacted networking, but Gloo should work independently). Arguably, Gloo could be installed after or before Istio. It has its own proxy separate from Istio’s. There’s no strong dependency order aside from cluster readiness. VirtualService references BFF service, which Argo may apply even if BFF not there yet (it will route when it appears). That’s fine.

### 13. Deploy Observability Stack (Prometheus, Grafana, OTel Collector)

**Task**: Install monitoring and tracing components.

* **Description**:

  * **Prometheus**:

    * Use kube-prometheus-stack (includes Prom + Grafana) via Helm, or separate.
    * Terraform helm\_release for kube-prom-stack in `monitoring` namespace. This gives Prom, Grafana, Alertmanager, etc. We might simplify by just Prom and Grafana individually if needed.
    * If using kube-prom-stack, it will set up ServiceMonitors etc. Might conflict if Istio also tries to install Prom. Ensure we don't double install Prom (Istio has optional telemetry). Possibly disable Istio's built-in Prom.
    * We can configure Grafana with some dashboards (if using stack, some dashboards come by default for K8s).
    * After deployment, port-forward Grafana (e.g., `kubectl port-forward svc/…/grafana 3000` or use NodePort).
    * Alternatively, configure Grafana Service as NodePort via values.
    * Not mandatory to create custom dashboards for this PoC, but could mention viewing Istio or container metrics.
  * **OpenTelemetry Collector**:

    * Deploy collector as a Deployment or DaemonSet. A simple config: receive OTLP on grpc (4317) and log to stdout or export to Jaeger (we could include a Jaeger all-in-one if we want UI).
    * Possibly use OpenTelemetry Operator (if wanting to auto-instrument, but might be heavy for PoC).
    * We'll do static config: e.g., in `k8s/base/otel-collector/collector.yaml` with a ConfigMap for pipeline:

      ```yaml
      receivers:
        otlp:
          protocols:
            grpc:
      exporters:
        logging:
          verbosity: normal
        # optionally jaeger or zipkin
      processors:
        batch:
      service:
        pipelines:
          traces:
            receivers: [otlp]
            processors: [batch]
            exporters: [logging]
      ```

      This just logs traces to collector logs.
    * This way, when our apps emit traces, we can see them in collector logs or later replace logging exporter with something persistent.
    * OTel Collector Service (ClusterIP) so apps can send to it. We'll name it `otel-collector:4317` as used in env.
  * **Grafana**:

    * If not using stack, deploy Grafana standalone. Preconfigure data source for Prom by environment or default (Prom is usually at `http://prometheus:9090` clusterIP).
    * If also wanting traces UI, could deploy Grafana Tempo (lightweight trace store) and add Tempo data source to Grafana. But due to time, we'll skip Tempo/Jaeger UI. The presence of traces can be inferred from logs or metrics.

* **Deliverables**:

  * Terraform config or K8s manifests for Prometheus (and Grafana).
  * Kustomize overlay adjustments (NodePort services for Grafana UI in dev).
  * K8s manifest for OTel collector (Deployment + ConfigMap).
  * Environment var in BFF and Resource service deployments:

    * For BFF Node, we can use OpenTelemetry JS SDK or just rely on Istio trace (since BFF is a Node service, we can add manual instrumentation if desired, but to keep it shorter, rely on Istio generating spans for inbound/outbound? However, since BFF->Resource is HTTP, if both have sidecars, Istio could generate trace spans. But to link with user trace from frontend, the frontend would need to propagate trace context. That’s advanced; maybe mention future possibility.
    * Alternatively, use OTel SDK for Node: add `@opentelemetry/sdk-node` and instrument HTTP. Could be heavy detail. Might skip, focusing on Java service instrumentation which we did.
    * Summation: We mention the presence of OTel, but actual implementation minimal.)
  * Prom/Grafana integration with Istio:

    * If Istio installed, it usually comes with its own Prom (unless disabled). We ensure our Prom can scrape Istio by including Istio's ServiceMonitors from the stack.
    * Possibly include an annotation on OTel collector to be scraped for metrics (not necessary).

* **Dependencies**: Ideally done after apps are deployed (or concurrently). But to see metrics, Prom must be up while apps run. Tracing requires collector up when apps send spans. So ensure collector deployment is applied before or same time as apps (we can include collector in infra-app Argo).

### 14. Automation and Helper Scripts (Makefile targets)

**Task**: Finalize the Makefile and scripts to streamline project usage.

* **Description**: Compile earlier scripts and commands into Makefile targets for user convenience:

  * `make setup`: (Or `make infra`)

    * Runs Kind cluster creation (if not up).
    * Runs `terraform init && terraform apply` in infra/ (for vault, postgres, etc.).
    * Runs vault setup script to populate secrets.
    * Possibly runs `kubectl apply` for Argo Application manifests if Argo is up (bootstrapping Argo apps).
    * Essentially one command to go from zero to all infra deployed. However, might need to wait between steps (e.g., wait for Vault pod ready).
    * Might break into sub-targets: `infra`, `vault-secrets`, `argocd-apps`.
  * `make deploy`:

    * If using Argo CD only, this might just ensure Argo is syncing (Argo does automatically). Or could run `kubectl apply -k k8s/overlays/dev` to deploy everything without Argo (an alternative path).
    * Or trigger a sync via Argo CLI (`argocd app sync` for each app if CLI is installed and logged in).
    * Could also depend on build (below).
  * `make build`:

    * Build Docker images for frontend, bff, resource.
    * Use `docker build` commands, tag them.
    * Then `kind load docker-image` for each to push into cluster (since not using external registry).
    * This should be done before Argo (or kustomize apply) creates pods, otherwise pods will ErrImagePull (if images not found).
    * Alternatively, use a local registry container and configure Kind to use it – but that’s extra complexity. Loading images is fine.
    * So `make build` might actually be part of `make setup` if fully automated, or separate to run whenever code changes.
  * `make teardown`:

    * Destroy everything. Could simply be `kind delete cluster`.
    * If wanting Terraform cleanup: `terraform destroy` (but if cluster is gone, the K8s resources (Vault, Postgres) will anyway be gone).
    * Remove any leftover files (like secrets.env).
  * `make port-forward`:

    * Start background port-forwards for useful services:

      * Grafana on localhost:3000
      * Argo CD on localhost:8080 (if wanted to use UI)
      * Possibly Next.js or Caddy if needed (but Next.js likely NodePort or directly accessible).
      * Vault (though not needed beyond script).
      * Or print instructions for user to access NodePorts.
  * `make test`:

    * Optionally, run a quick test: for example, use curl to log in or hit an endpoint. But since login is OIDC (hard to test via curl easily).
    * Could test that the BFF’s permit check works by calling BFF internal endpoint with a token. Might skip automated test, instead outline manual test steps:

      1. Open browser to Next.js app (e.g., [http://localhost](http://localhost)).
      2. Click login, go through Zitadel (user must have been created; if we have default admin user, use those credentials).
      3. Upon login, see home page with user info.
      4. Navigate to Reports page, see report data (if role allowed).
      5. Navigate to Admin page (if logged in user is admin).
      6. If user lacks role, should get error on those pages (the BFF returning 403).
      7. Check logs in BFF to see permit decisions and in resource service to see that requests came through (if permitted).
      8. Check Grafana for metrics or the OTel collector logs for trace spans (if configured).
  * Provide user with default credentials info:

    * Zitadel admin default (maybe email `admin@zitadel.local` and password printed in logs).
    * If we created a demo user manually, share those credentials.
    * Permit.io setup: might not have an interactive part, but we should mention that in Permit dashboard, a policy should be configured such that the test user (by some identifier) has the appropriate roles and permissions. E.g., user with email X is ADMIN for resource "settings", etc. This configuration is outside the code; the agent cannot do it automatically (since Permit is SaaS). We'll instruct the user to configure Permit roles/policies to match the permit.check calls used. Perhaps in the PoC, define resource "report", action "view", role "Viewer" gives that; and resource "settings", action "modify", role "Admin" gives that; and assign roles to users accordingly in Permit UI.

* **Deliverables**:

  * Completed `Makefile` with described targets.
  * Scripts:

    * `scripts/setup-vault.sh` as earlier.
    * `scripts/setup-zitadel.sh` if possible (for creating OIDC client: could use Zitadel CLI in a container to create an OAuth client and a test user).
    * These could be invoked in Makefile.
  * Documentation (in this guide or a README) for any manual steps the user must do (like configuring Zitadel or Permit).

* **Dependencies**: All previous tasks should be completed. This is assembling and ensuring proper order execution.

## Interdependencies and Execution Order

The tasks above are organized in a reasonable execution order for building the project. Below is a summary of major dependencies and sequencing:

1. **Repo Structure** – No dependencies; do first.
2. **Cluster Provisioning (Kind)** – Must be done before any K8s deployments (tasks 3 onward).
3. **Argo CD Installation** – Requires cluster. Do early to enable GitOps. Alternatively, can deploy components without Argo in dev, but we include it for completeness.
4. **Argo Applications** – Define after Argo is up; depends on manifests for apps being available in repo (so generate manifests along with or before this).
5. **Postgres DB** – Deploy before Zitadel; Zitadel will connect to it. Can be done via Terraform concurrently with Vault.
6. **Zitadel** – Depends on Postgres (DB connection) and ideally Vault (for DB creds if not in manifest directly). Should start after DB is running.
7. **Vault** – Can be installed alongside Postgres (both are infra). Vault should be initialized and secrets populated before apps (BFF, Zitadel) need those secrets. So ensure vault secrets are set before deploying BFF (Permit API key) and Zitadel (DB password).
8. **Frontend (Next.js)** – Can be developed anytime, but for deployment, it depends on Zitadel (for OIDC config) and ideally requires Zitadel configured with an OAuth client. In runtime, Next.js can come up even if Zitadel not ready, but login attempts would fail until Zitadel ready. So no hard dependency, but logically deploy Zitadel slightly before or together.
9. **BFF (AdonisJS)** – Depends on Permit PDP (for checks) and on Vault secret (Permit API key). Also expects Zitadel’s JWTs on requests (so indirectly depends on users being able to login via Zitadel and obtain tokens). At runtime, BFF should start after Permit PDP is available to avoid check timeouts (though it can retry).
10. **Permit PDP** – Should be deployed before or with BFF. Depends on Vault (API key) for config. No other dependency (except internet access to Permit SaaS to fetch policies).
11. **Resource Service (Spring)** – No external dependencies except it might log traces to collector. It should be up for BFF to call, so BFF expects it. We can deploy BFF and resource together; if BFF calls it and it's not up, will retry or fail. Ideally ensure resource service is deployed before BFF or simultaneously. We can mark BFF depends on resource in Argo by ordering in one app, but in separate Argo apps it's parallel. It's fine.
12. **Istio** – Should be installed **before** deploying BFF and resource if we want sidecars from the start. If not, we can deploy Istio later but then have to restart pods to get sidecars. Best to do Istio right after cluster creation and before apps. Mark that in sequence.
13. **Gloo** – Can be installed after Istio. It doesn't depend on apps, but we need to configure it to route to BFF service. Can be done before or after BFF deployment; if before, it will route traffic as soon as BFF appears. That’s okay.
14. **Prom/Grafana/Otel** – These can be deployed towards the end. Prom can scrape existing pods even if started later. Grafana is independent. OTel collector should ideally start before or at same time as resource (so that if resource sends traces immediately on startup, the collector is there). We can deploy OTel collector just before apps or concurrently. Not critical if some early traces are lost.
15. **Scripts/Makefile** – This ties it all; the final execution should follow: cluster -> core infra (DB, Vault, Istio, Gloo, Argo) -> secrets setup -> build images -> Argo deploy apps -> verify.

Each of these tasks produces artifacts that interconnect. By following this plan, an AI agent or developer will generate a local Kubernetes environment where all these components work together to demonstrate **authentication, authorization, and role-based access control** in a microservices architecture. The use of GitOps with Argo CD ensures that the config is declarative and the cluster state is self-healing. Observability via logging, metrics, and tracing provides insight into the system’s behavior.

## Conclusion

With this `AGENTS.md` guide and the associated project plan, an AI agent can programmatically scaffold the entire project – from infrastructure code to application source – and deploy a working prototype. The prototype will allow a user to authenticate through Zitadel, obtain a JWT, have that token validated by Gloo Edge at the gateway, then be authorized by Permit.io in the BFF, and access a protected resource in the Spring Boot service. All secrets are managed through Vault and injected into the system securely, and all components produce structured logs (JSON) for easy analysis. Metrics and traces are collected to monitor system health and performance. The project is modular, making it possible to extend to production-grade with additional overlays and configuration changes in the future.

**Sources:**

* ZITADEL Kubernetes setup (insecure Postgres example)
* Permit.io Policy Decision Point (PDP) usage and Node.js SDK
* Next.js integration with Zitadel (OIDC PKCE flow example)
* Gloo Edge JWT verification support
* Kustomize secret generation and Vault integration concepts
* Argo CD auto-sync policy for GitOps deployments
* Pino logger for structured JSON logs in Node.js
