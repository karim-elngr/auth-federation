variable "zitadel_domain" {
  description = "Domain of the Zitadel instance"
  type        = string
}

variable "zitadel_token" {
  description = "Personal access token for API calls"
  type        = string
  sensitive   = true
}

provider "zitadel" {
  domain                = var.zitadel_domain
  personal_access_token = var.zitadel_token
}

# Placeholder resources for the demo environment
resource "zitadel_org" "demo" {
  name = "demo-org"
}

resource "zitadel_project" "demo" {
  org_id = zitadel_org.demo.id
  name   = "demo-project"
}

resource "zitadel_service_user" "backend" {
  org_id   = zitadel_org.demo.id
  username = "backend-service"
}
