# AGENTS Guidelines for auth-federation

This repository hosts a monorepo used for demonstrating authentication and authorization across multiple services on a local Kubernetes cluster. Contributors should follow these guidelines when updating the repository.

## Scope

All directories in this repository are covered by these guidelines. They describe project structure expectations, commit conventions and recommendations for keeping configurations consistent.

## Project Structure

- **apps/** contains application source code:
- `frontend/` – Next.js frontend.
- `backend/` – AdonisJS backend written in TypeScript.
- `java-service/` – Java resource server secured by Zitadel.

The frontend uses Tailwind CSS with shadcn UI components. Keep UI code minimal and style via Tailwind classes.
- **gateway/** holds configuration for Gloo API Gateway.
- **iac/** provides infrastructure as code, including Kubernetes manifests.
- **ops/** stores operational configurations such as Flux and Istio setup.

Each directory should contain a `README.md` explaining its purpose and usage.

## Contribution Rules

1. Keep Kubernetes manifests and configuration files in YAML format with two-space indentation.
2. Use clear, descriptive commit messages in the present tense (e.g., "Add Zitadel manifest").
3. Provide placeholder code where full implementations are not yet available, but mark them with comments or TODOs.
4. When adding new applications or services, include minimal instructions in the corresponding `README.md`.
5. Run available lint or unit tests for the component you modify. If no tests exist, note this in the PR description.
6. Ensure `git status` shows a clean working tree before committing.

## Testing

At this stage the repository does not contain automated tests. Future contributions may introduce testing commands (e.g., `npm test` or `mvn test`). When they exist, run them before submitting a pull request.

