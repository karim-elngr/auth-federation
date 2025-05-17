# Infrastructure as Code (IAC)

This directory contains manifests and configuration files for provisioning the Kubernetes environment and core services used by the demo. The workflow below uses [`kubectl`](https://kubernetes.io/docs/tasks/tools/) along with either [`kind`](https://kind.sigs.k8s.io/) or [`minikube`](https://minikube.sigs.k8s.io/).

## Quickstart

1. Install `kubectl` and your preferred local Kubernetes distribution.
2. Create a cluster:
   - **Kind**:
     ```bash
     kind create cluster --name auth-demo --config clusters/kind-cluster.yaml
     ```
   - **Minikube**:
     ```bash
     minikube start
     ```
3. Deploy core services using the manifests in this directory:
   ```bash
   kubectl apply -f zitadel/
   kubectl apply -f permitio/
   kubectl apply -f monitoring/
   ```
4. Continue with the application deployments as described under `ops/`.

Terraform modules live under `terraform/` for provisioning additional
resources such as Zitadel entities.

Refer to each subdirectory `README.md` for additional options and configuration details.
