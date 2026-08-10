# Deployment runbook

Cloud deployment is intentionally manual. The CDK app fails synthesis unless `BUDGET_ALERT_EMAIL` is present, and no workflow in this repository runs `cdk deploy` automatically.

1. Authenticate the AWS CLI and select a dedicated region.
2. Create and confirm an AWS cost budget before provisioning compute.
3. Create the production MongoDB Atlas project and private network policy.
4. Configure GitHub Actions OIDC with least-privilege deployment permissions.
5. Store provider keys and session secrets in AWS Secrets Manager.
6. Export `BUDGET_ALERT_EMAIL`, `ARBITER_IMAGE_TAG=v0.1.0` (or the approved tag), and the CDK account/region, then run `pnpm --filter @arbiter/infra-aws synth` and review the generated template.
7. Populate the Secrets Manager JSON at the emitted runtime secret ARN with `MONGODB_URI`, `SESSION_SECRET`, `ARBITER_OPERATOR_EMAIL`, `ARBITER_OPERATOR_PASSWORD`, and the optional `GOOGLE_GEMINI_API_KEY`.
8. Deploy the infrastructure and image digests from a semantic-version tag only after billing and security approval.
9. Run health, authentication, evaluation, and sandbox smoke tests before exposing a public endpoint.

The CDK stack creates the queue, dead-letter queue, artifact bucket, ECS services, ECR repositories, a restricted sandbox task definition, and a monthly budget notification. The sandbox task definition is intentionally separate from the API and worker services. A production task bridge must launch that task per evaluation and pass only immutable task inputs and bounded action messages; do not mount the Docker socket into Fargate and do not enable arbitrary public task execution until that bridge has passed security review.

Use the image digest printed by ECR rather than a mutable `latest` tag. Keep the public API behind a private load balancer or service mesh until TLS, authentication, origin policy, and rate limiting have been verified.

The deployment workflow must stop when required billing, secret, or network settings are absent.
