# Deployment runbook

Cloud deployment is intentionally manual.

1. Authenticate the AWS CLI and select a dedicated region.
2. Create and confirm an AWS cost budget before provisioning compute.
3. Create the production MongoDB Atlas project and private network policy.
4. Configure GitHub Actions OIDC with least-privilege deployment permissions.
5. Store provider keys and session secrets in AWS Secrets Manager.
6. Synthesize and review the CDK change set.
7. Deploy the infrastructure and image digests from a semantic-version tag.
8. Run health, authentication, evaluation, and sandbox smoke tests.

The deployment workflow must stop when required billing, secret, or network settings are absent.
