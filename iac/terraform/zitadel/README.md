# Zitadel Terraform Module

This module demonstrates how to provision Zitadel resources with Terraform. It creates an organization, a project, and a service user as a placeholder for the applications in this repository.

Before running Terraform, export a personal access token:

```bash
export ZITADEL_TOKEN="<your-pat>"
```

Copy `terraform.tfvars.example` to `terraform.tfvars` and update the domain if needed.

Initialize and apply the module:

```bash
terraform init
terraform apply
```
