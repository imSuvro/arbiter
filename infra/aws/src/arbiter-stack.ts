import * as cdk from 'aws-cdk-lib';
import {
  aws_ec2 as ec2,
  aws_ecr as ecr,
  aws_ecs as ecs,
  aws_iam as iam,
  aws_logs as logs,
  aws_s3 as s3,
  aws_secretsmanager as secrets,
  aws_sqs as sqs,
} from 'aws-cdk-lib';
import type { Construct } from 'constructs';

export class ArbiterStack extends cdk.Stack {
  public constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const budgetEmail = process.env.BUDGET_ALERT_EMAIL;
    if (!budgetEmail)
      throw new Error(
        'BUDGET_ALERT_EMAIL is required before synthesizing production infrastructure.',
      );
    const imageTag = process.env.ARBITER_IMAGE_TAG ?? 'v0.1.0';
    const tags = { Product: 'Arbiter', Environment: 'production', ManagedBy: 'cdk' };
    for (const [key, value] of Object.entries(tags)) cdk.Tags.of(this).add(key, value);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
      restrictDefaultSecurityGroup: true,
    });
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });
    const apiRepo = new ecr.Repository(this, 'ApiRepository', {
      repositoryName: 'arbiter/api',
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      encryption: ecr.RepositoryEncryption.AES_256,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const webRepo = new ecr.Repository(this, 'WebRepository', {
      repositoryName: 'arbiter/web',
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      encryption: ecr.RepositoryEncryption.AES_256,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const workerRepo = new ecr.Repository(this, 'WorkerRepository', {
      repositoryName: 'arbiter/worker',
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      encryption: ecr.RepositoryEncryption.AES_256,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const sandboxRepo = new ecr.Repository(this, 'SandboxRepository', {
      repositoryName: 'arbiter/sandbox',
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      encryption: ecr.RepositoryEncryption.AES_256,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const queueDlq = new sqs.Queue(this, 'EvaluationDeadLetterQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(14),
    });
    const queue = new sqs.Queue(this, 'EvaluationQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: cdk.Duration.minutes(15),
      deadLetterQueue: { queue: queueDlq, maxReceiveCount: 3 },
    });
    const artifacts = new s3.Bucket(this, 'Artifacts', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      lifecycleRules: [{ expiration: cdk.Duration.days(30) }],
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const runtimeSecret = new secrets.Secret(this, 'RuntimeSecret', {
      secretName: 'arbiter/production/runtime',
      description:
        'Populate MongoDB URI, session secret, operator credentials, and optional provider key before service deployment.',
      generateSecretString: {
        secretStringTemplate: '{}',
        generateStringKey: 'bootstrap',
        excludePunctuation: true,
      },
    });
    const executionRole = new iam.Role(this, 'EcsExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy'),
      ],
    });
    const apiRole = new iam.Role(this, 'ApiTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    const workerRole = new iam.Role(this, 'WorkerTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    const webTaskRole = new iam.Role(this, 'WebTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    runtimeSecret.grantRead(apiRole);
    artifacts.grantReadWrite(apiRole);
    runtimeSecret.grantRead(workerRole);
    artifacts.grantReadWrite(workerRole);

    const logGroup = new logs.LogGroup(this, 'ServiceLogs', {
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });
    const apiTask = new ecs.FargateTaskDefinition(this, 'ApiTask', {
      cpu: 512,
      memoryLimitMiB: 1024,
      executionRole,
      taskRole: apiRole,
      runtimePlatform: {
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.X86_64,
      },
    });
    apiTask.addContainer('Api', {
      image: ecs.ContainerImage.fromEcrRepository(apiRepo, imageTag),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'api' }),
      portMappings: [{ containerPort: 4000 }],
      environment: {
        NODE_ENV: 'production',
        API_PORT: '4000',
        MONGODB_DB_NAME: 'arbiter',
        QUEUE_BACKEND: 'sqs',
        QUEUE_URL: queue.queueUrl,
        AWS_REGION: this.region,
        SANDBOX_BACKEND: 'docker',
      },
      secrets: {
        SESSION_SECRET: ecs.Secret.fromSecretsManager(runtimeSecret, 'SESSION_SECRET'),
        ARBITER_OPERATOR_EMAIL: ecs.Secret.fromSecretsManager(
          runtimeSecret,
          'ARBITER_OPERATOR_EMAIL',
        ),
        ARBITER_OPERATOR_PASSWORD: ecs.Secret.fromSecretsManager(
          runtimeSecret,
          'ARBITER_OPERATOR_PASSWORD',
        ),
        MONGODB_URI: ecs.Secret.fromSecretsManager(runtimeSecret, 'MONGODB_URI'),
        GOOGLE_GEMINI_API_KEY: ecs.Secret.fromSecretsManager(
          runtimeSecret,
          'GOOGLE_GEMINI_API_KEY',
        ),
      },
      readonlyRootFilesystem: true,
      user: '10001',
    });
    new ecs.FargateService(this, 'ApiService', {
      cluster,
      taskDefinition: apiTask,
      desiredCount: 1,
      minHealthyPercent: 100,
      assignPublicIp: false,
      circuitBreaker: { rollback: true },
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    const webTask = new ecs.FargateTaskDefinition(this, 'WebTask', {
      cpu: 512,
      memoryLimitMiB: 1024,
      executionRole,
      taskRole: webTaskRole,
    });
    webTask.addContainer('Web', {
      image: ecs.ContainerImage.fromEcrRepository(webRepo, imageTag),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'web' }),
      portMappings: [{ containerPort: 3000 }],
      environment: {
        NODE_ENV: 'production',
        NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? '',
      },
      readonlyRootFilesystem: true,
      user: '10001',
    });
    new ecs.FargateService(this, 'WebService', {
      cluster,
      taskDefinition: webTask,
      desiredCount: 1,
      minHealthyPercent: 100,
      assignPublicIp: false,
      circuitBreaker: { rollback: true },
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    const workerTask = new ecs.FargateTaskDefinition(this, 'WorkerTask', {
      cpu: 1024,
      memoryLimitMiB: 2048,
      executionRole,
      taskRole: workerRole,
    });
    workerTask.addContainer('Worker', {
      image: ecs.ContainerImage.fromEcrRepository(workerRepo, imageTag),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'worker' }),
      environment: {
        NODE_ENV: 'production',
        QUEUE_URL: queue.queueUrl,
        MONGODB_DB_NAME: 'arbiter',
        AWS_REGION: this.region,
        SANDBOX_BACKEND: 'docker',
      },
      secrets: {
        MONGODB_URI: ecs.Secret.fromSecretsManager(runtimeSecret, 'MONGODB_URI'),
        SESSION_SECRET: ecs.Secret.fromSecretsManager(runtimeSecret, 'SESSION_SECRET'),
        GOOGLE_GEMINI_API_KEY: ecs.Secret.fromSecretsManager(
          runtimeSecret,
          'GOOGLE_GEMINI_API_KEY',
        ),
      },
      readonlyRootFilesystem: true,
      user: '10001',
    });
    new ecs.FargateService(this, 'WorkerService', {
      cluster,
      taskDefinition: workerTask,
      desiredCount: 1,
      minHealthyPercent: 100,
      assignPublicIp: false,
      circuitBreaker: { rollback: true },
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
    });

    const sandboxTaskRole = new iam.Role(this, 'SandboxTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    const sandboxTask = new ecs.FargateTaskDefinition(this, 'SandboxTask', {
      cpu: 512,
      memoryLimitMiB: 1024,
      executionRole,
      taskRole: sandboxTaskRole,
      ephemeralStorageGiB: 21,
    });
    sandboxTask.addContainer('Sandbox', {
      image: ecs.ContainerImage.fromEcrRepository(sandboxRepo, imageTag),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'sandbox' }),
      readonlyRootFilesystem: true,
      user: '10001',
      linuxParameters: new ecs.LinuxParameters(this, 'SandboxLinuxParameters', {
        initProcessEnabled: true,
      }),
    });
    workerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['ecs:RunTask'],
        resources: [sandboxTask.taskDefinitionArn],
      }),
    );
    workerRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ['iam:PassRole'],
        resources: [executionRole.roleArn, sandboxTaskRole.roleArn],
        conditions: {
          StringEquals: {
            'iam:PassedToService': 'ecs-tasks.amazonaws.com',
          },
        },
      }),
    );
    queue.grantSendMessages(apiRole);
    queue.grantConsumeMessages(workerRole);

    new cdk.CfnResource(this, 'MonthlyBudget', {
      type: 'AWS::Budgets::Budget',
      properties: {
        Budget: {
          BudgetName: 'arbiter-production-monthly',
          BudgetLimit: { Amount: 50, Unit: 'USD' },
          TimeUnit: 'MONTHLY',
          BudgetType: 'COST',
          CostFilters: { TagKeyValue: ['user:Product$Arbiter'] },
        },
        NotificationsWithSubscribers: [
          {
            Notification: {
              NotificationType: 'ACTUAL',
              ComparisonOperator: 'GREATER_THAN',
              Threshold: 50,
              ThresholdType: 'PERCENTAGE',
            },
            Subscribers: [{ Address: budgetEmail, SubscriptionType: 'EMAIL' }],
          },
          {
            Notification: {
              NotificationType: 'FORECASTED',
              ComparisonOperator: 'GREATER_THAN',
              Threshold: 80,
              ThresholdType: 'PERCENTAGE',
            },
            Subscribers: [{ Address: budgetEmail, SubscriptionType: 'EMAIL' }],
          },
        ],
      },
    });
    new cdk.CfnOutput(this, 'EvaluationQueueUrl', { value: queue.queueUrl });
    new cdk.CfnOutput(this, 'ArtifactBucketName', { value: artifacts.bucketName });
    new cdk.CfnOutput(this, 'RuntimeSecretArn', { value: runtimeSecret.secretArn });
  }
}
