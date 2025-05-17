.PHONY: kind-create vault-setup

kind-create:
./scripts/kind-create.sh

vault-setup:
./scripts/setup-vault.sh
