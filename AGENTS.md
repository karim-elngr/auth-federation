# AGENTS Guidelines for auth-federation

This repository was reset to begin a new implementation from scratch. As the
project evolves, contributors should follow these guidelines.

## Scope

Future directories in this repository are covered by these guidelines. They
describe project structure expectations, commit conventions, and recommendations
for keeping configurations consistent.

## Project Structure

When new components are added, organize them under directories such as:

- **apps/** for application source code.
- **gateway/** for API Gateway configuration.
- **iac/** for infrastructure as code.
- **ops/** for operational configurations like GitOps and Istio.

Each directory must contain a `README.md` explaining its purpose and usage.

## Contribution Rules

1. Keep Kubernetes manifests and configuration files in YAML format with
   two-space indentation.
2. Use clear, descriptive commit messages in the present tense (e.g., "Add
   Zitadel manifest").
3. Provide placeholder code where full implementations are not yet available,
   marking them with comments or TODOs.
4. When adding new applications or services, include minimal instructions in the
   corresponding `README.md`.
5. Run available lint or unit tests for the component you modify. If no tests
   exist, note this in the PR description.
6. Ensure `git status` shows a clean working tree before committing.

## Testing

At this stage the repository does not contain automated tests. When they exist,
run them before submitting a pull request.
