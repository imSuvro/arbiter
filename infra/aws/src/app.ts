import * as cdk from 'aws-cdk-lib';
import { ArbiterStack } from './arbiter-stack.js';

const app = new cdk.App();
new ArbiterStack(app, 'ArbiterProduction', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? process.env.AWS_REGION ?? 'ap-south-1',
  },
  description: 'Opt-in production topology for Arbiter evaluation services.',
});
