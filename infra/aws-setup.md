# AWS Infrastructure Setup Guide — Quizmefy

> Complete step-by-step guide to provision all required AWS resources.
> Replace `ACCOUNT_ID`, `YOUR-REGION`, and other placeholders with your actual values.

---

## Prerequisites

- AWS CLI configured: `aws configure`
- Docker installed and running
- Node.js 20+ installed locally

---

## Step 1 — Create ECR Repository

```bash
aws ecr create-repository \
  --repository-name quizmefy-api \
  --region us-east-1 \
  --image-scanning-configuration scanOnPush=true

# Note the repositoryUri — add to GitHub secret ECR_REPOSITORY
```

---

## Step 2 — Create RDS PostgreSQL Instance

```bash
# Create a subnet group first (use your VPC subnets)
aws rds create-db-subnet-group \
  --db-subnet-group-name quizmefy-subnet-group \
  --db-subnet-group-description "Quizmefy DB Subnet Group" \
  --subnet-ids subnet-XXXXXX subnet-YYYYYY

# Create PostgreSQL RDS instance
aws rds create-db-instance \
  --db-instance-identifier quizmefy-postgres \
  --db-instance-class db.t3.micro \
  --engine postgres \
  --engine-version 16.3 \
  --master-username quizmefy \
  --master-user-password "YOUR_SECURE_PASSWORD" \
  --allocated-storage 20 \
  --vpc-security-group-ids sg-XXXXXX \
  --db-subnet-group-name quizmefy-subnet-group \
  --backup-retention-period 7 \
  --no-publicly-accessible \
  --deletion-protection

# Wait for it to be available (~5 minutes)
aws rds wait db-instance-available --db-instance-identifier quizmefy-postgres

# Get endpoint
aws rds describe-db-instances \
  --db-instance-identifier quizmefy-postgres \
  --query 'DBInstances[0].Endpoint.Address'
```

---

## Step 3 — Create ElastiCache Redis Cluster

```bash
aws elasticache create-cache-cluster \
  --cache-cluster-id quizmefy-redis \
  --cache-node-type cache.t3.micro \
  --engine redis \
  --engine-version 7.0 \
  --num-cache-nodes 1 \
  --security-group-ids sg-XXXXXX \
  --cache-subnet-group-name quizmefy-subnet-group

# Get endpoint after creation (~3 minutes)
aws elasticache describe-cache-clusters \
  --cache-cluster-id quizmefy-redis \
  --show-cache-node-info \
  --query 'CacheClusters[0].CacheNodes[0].Endpoint'
```

---

## Step 4 — Store Secrets in SSM Parameter Store

```bash
# Store all sensitive values in SSM (SecureString encrypted with KMS)
aws ssm put-parameter --name "/quizmefy/DATABASE_URL" \
  --value "postgresql://quizmefy:PASSWORD@RDS_ENDPOINT:5432/quizmefy_db" \
  --type SecureString --overwrite

aws ssm put-parameter --name "/quizmefy/REDIS_URL" \
  --value "redis://ELASTICACHE_ENDPOINT:6379" \
  --type SecureString --overwrite

aws ssm put-parameter --name "/quizmefy/JWT_SECRET" \
  --value "$(openssl rand -hex 64)" \
  --type SecureString --overwrite

aws ssm put-parameter --name "/quizmefy/JWT_REFRESH_SECRET" \
  --value "$(openssl rand -hex 64)" \
  --type SecureString --overwrite

aws ssm put-parameter --name "/quizmefy/OPENAI_API_KEYS" \
  --value "sk-your-openai-key" \
  --type SecureString --overwrite

aws ssm put-parameter --name "/quizmefy/ANTHROPIC_API_KEYS" \
  --value "sk-ant-your-anthropic-key" \
  --type SecureString --overwrite
```

---

## Step 5 — Create ECS Cluster & Service

```bash
# Create ECS cluster
aws ecs create-cluster \
  --cluster-name quizmefy-cluster \
  --capacity-providers FARGATE \
  --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1

# Create CloudWatch log group
aws logs create-log-group --log-group-name /ecs/quizmefy-api

# Register task definition (update infra/ecs-task-definition.json with real values first)
aws ecs register-task-definition \
  --cli-input-json file://infra/ecs-task-definition.json

# Create ECS service
aws ecs create-service \
  --cluster quizmefy-cluster \
  --service-name quizmefy-api \
  --task-definition quizmefy-api \
  --desired-count 2 \
  --launch-type FARGATE \
  --network-configuration "awsvpcConfiguration={subnets=[subnet-XXXXXX,subnet-YYYYYY],securityGroups=[sg-XXXXXX],assignPublicIp=DISABLED}" \
  --load-balancers "targetGroupArn=arn:aws:elasticloadbalancing:...,containerName=quizmefy-api,containerPort=3000" \
  --deployment-configuration "minimumHealthyPercent=50,maximumPercent=200"
```

---

## Step 6 — S3 Bucket + CloudFront Distribution

```bash
# Create S3 bucket
aws s3api create-bucket \
  --bucket quizmefy-frontend-ACCOUNT_ID \
  --region us-east-1

# Block all public access (served via CloudFront only)
aws s3api put-public-access-block \
  --bucket quizmefy-frontend-ACCOUNT_ID \
  --public-access-block-configuration "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

# Create CloudFront OAC (Origin Access Control)
aws cloudfront create-origin-access-control \
  --origin-access-control-config '{
    "Name": "quizmefy-oac",
    "OriginAccessControlOriginType": "s3",
    "SigningBehavior": "always",
    "SigningProtocol": "sigv4"
  }'

# Create CloudFront distribution (see AWS console for full config)
# Then apply the bucket policy from infra/cloudfront-policy.json
aws s3api put-bucket-policy \
  --bucket quizmefy-frontend-ACCOUNT_ID \
  --policy file://infra/cloudfront-policy.json
```

---

## Step 7 — Add GitHub Repository Secrets

Go to **GitHub → Repository → Settings → Secrets and variables → Actions** and add:

| Secret | Value |
|--------|-------|
| `AWS_ACCESS_KEY_ID` | IAM user access key (CI deploy role) |
| `AWS_SECRET_ACCESS_KEY` | IAM user secret key |
| `ECR_REPOSITORY` | ECR repository name (e.g. `quizmefy-api`) |
| `ECS_CLUSTER` | `quizmefy-cluster` |
| `ECS_SERVICE` | `quizmefy-api` |
| `S3_FRONTEND_BUCKET` | `quizmefy-frontend-ACCOUNT_ID` |
| `CLOUDFRONT_DISTRIBUTION_ID` | Distribution ID from Step 6 |
| `OPENAI_API_KEYS` | Your OpenAI key(s) |
| `CODECOV_TOKEN` | (Optional) Codecov.io token |

---

## Step 8 — IAM Policy for CI/CD User

Create a dedicated IAM user for CI/CD with only these permissions:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["ecr:*"], "Resource": "arn:aws:ecr:us-east-1:ACCOUNT_ID:repository/quizmefy-api" },
    { "Effect": "Allow", "Action": ["ecr:GetAuthorizationToken"], "Resource": "*" },
    { "Effect": "Allow", "Action": ["ecs:UpdateService", "ecs:DescribeServices", "ecs:RegisterTaskDefinition", "ecs:DescribeTaskDefinition", "ecs:DeregisterTaskDefinition"], "Resource": "*" },
    { "Effect": "Allow", "Action": ["iam:PassRole"], "Resource": "arn:aws:iam::ACCOUNT_ID:role/ecsTaskExecutionRole" },
    { "Effect": "Allow", "Action": ["s3:PutObject", "s3:DeleteObject", "s3:ListBucket"], "Resource": ["arn:aws:s3:::quizmefy-frontend-ACCOUNT_ID", "arn:aws:s3:::quizmefy-frontend-ACCOUNT_ID/*"] },
    { "Effect": "Allow", "Action": ["cloudfront:CreateInvalidation"], "Resource": "arn:aws:cloudfront::ACCOUNT_ID:distribution/YOUR_DISTRIBUTION_ID" }
  ]
}
```

---

## Verification

```bash
# Check ECS service is running
aws ecs describe-services --cluster quizmefy-cluster --services quizmefy-api

# Check health endpoint (via ALB DNS)
curl https://api.yourdomain.com/health

# Check frontend via CloudFront
curl https://yourdomain.com
```
