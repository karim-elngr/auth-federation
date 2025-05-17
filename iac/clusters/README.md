# Cluster Setup

This directory provides configuration files for creating the local Kubernetes cluster used by the demo. A minimal `kind-cluster.yaml` is included and can be used with the `kind` tool. Alternatively you can start a Minikube cluster.

## Using Kind

1. Install [`kind`](https://kind.sigs.k8s.io/docs/user/quick-start/).
2. Run the following command from the repository root:
   ```bash
   kind create cluster --name auth-demo --config iac/clusters/kind-cluster.yaml
   ```
3. Verify the cluster is running:
   ```bash
   kubectl get nodes
   ```

## Using Minikube

1. Install [`minikube`](https://minikube.sigs.k8s.io/docs/start/).
2. Start a cluster:
   ```bash
   minikube start
   ```

Both approaches produce a Kubernetes environment ready for applying the manifests in the other `iac` directories.
