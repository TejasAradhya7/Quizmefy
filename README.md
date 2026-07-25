# ⚡ Quizmefy — AI-Powered Quiz Generation Platform

> A full-stack, production-grade AI quiz generation platform featuring multi-provider AI proxying (OpenAI & Anthropic), sub-millisecond Redis caching, PostgreSQL via Prisma ORM, Docker containerization, and an automated AWS CI/CD deployment pipeline via GitHub Actions.

![License](https://img.shields.io/badge/license-MIT-violet)
![Node.js](https://img.shields.io/badge/Node.js-v20+-green)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)
![Docker](https://img.shields.io/badge/Docker-Ready-2496ED)
![Redis](https://img.shields.io/badge/Redis-Cache-DC382D)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-336791)
![AWS](https://img.shields.io/badge/AWS-ECS%20%7C%20S3%20%7C%20CloudFront-FF9900)

---

## 🌟 Features

- 🧠 **Dual AI Proxying**: Integrated with **OpenAI (GPT-4o)** and **Anthropic (Claude 3.5 Sonnet)** with round-robin key rotation and exponential backoff retries.
- ⚡ **Sub-Millisecond Caching**: Redis-backed caching using deterministic SHA-256 prompt hashing. Includes an automatic in-memory (NodeCache) fallback.
- 🔒 **Enterprise-Grade Auth & Security**: JWT access & refresh token rotation, bcrypt password hashing, helmet security headers, and rate limiting (Global, AI, and Auth tiers).
- 🗄️ **Robust Database Layer**: PostgreSQL managed via **Prisma ORM** with structured schema indexing and atomic transaction processing.
- 🐳 **Containerized Architecture**: Multi-stage Docker builds running as non-root users for production security with `docker-compose` for local development.
- 🚀 **Automated CI/CD Pipeline**: GitHub Actions workflows for strict quality gates (ESLint, TypeScript type safety, Jest unit tests, TruffleHog secret scanning) and automated deployment to AWS ECR, ECS Fargate, S3, and CloudFront.
- 🎨 **Glassmorphism UI**: Responsive dark-mode interface built with modern vanilla CSS, dynamic micro-animations, SVG progress rings, and accessible keyboard navigation.

---

## 📐 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│ 1. CLIENT REQUEST (Frontend UI / Client)                    │
│    User inputs topic, difficulty, and clicks generate.       │
│    The browser sends an HTTP POST request to API endpoint.  │
└──────────────────────────────┬──────────────────────────────┘
                               │ JSON Payload + JWT Token
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. INGRESS & SECURITY (Node.js / Express)                   │
│    • Auth Middleware: Verifies the JWT signature.           │
│    • Rate Limiter: Ensures IP/User isn't spamming API.       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. CACHE EVALUATION (Redis)                                 │
│    Server generates SHA-256 hash of prompt parameters.      │
└──────┬───────────────────────────────────────────────┬──────┘
       │                                               │
       ▼ [CACHE HIT]                                   ▼ [CACHE MISS]
┌───────────────────────┐               ┌──────────────────────────────┐
│ Skips to Step 7.      │               │ 4. AI GENERATION (Proxy)     │
│ Returns in < 10ms.    │               │ Queries OpenAI/Anthropic API │
│                       │               │ using secure server-side keys│
└───────────────────────┘               └──────────────┬───────────────┘
                                                       │ Raw JSON String
                                                       ▼
                                        ┌──────────────────────────────┐
                                        │ 5. FAULT-TOLERANT VALIDATION │
                                        │ Zod parses the AI output to  │
                                        │ guarantee it matches the     │
                                        │ strict Quiz schema.          │
                                        └──────────────┬───────────────┘
                                                       │ Validated Object
                                                       ▼
                                        ┌──────────────────────────────┐
                                        │ 6. DATABASE PERSISTENCE      │
                                        │ Prisma ORM saves the user    │
                                        │ request & quiz to PostgreSQL.│
                                        │ Copies result back to Redis. │
                                        └──────────────┬───────────────┘
                                                       │
┌──────────────────────────────────────────────────────┴──────┐
│ 7. CLIENT RENDERING (Interactive UI)                        │
│    The clean, validated JSON is sent back to the browser    │
│    where the UI renders the interactive quiz components.    │
└─────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Technology Stack

| Component | Technologies Used |
|---|---|
| **Backend API** | Node.js (v20), Express, TypeScript, Winston Logger |
| **AI Integration** | OpenAI SDK (`gpt-4o`), Anthropic SDK (`claude-3-5-sonnet`) |
| **Database & ORM** | PostgreSQL 16, Prisma ORM (Client v5) |
| **Caching Layer** | Redis 7 (`ioredis`), NodeCache (in-memory fallback) |
| **Security & Auth** | JWT (`jsonwebtoken`), `bcryptjs`, `helmet`, `cors`, `express-rate-limit`, `zod` |
| **Frontend** | Vanilla HTML5, CSS Custom Properties (Glassmorphism), JavaScript (ES6+) |
| **DevOps & Cloud** | Docker, Docker Compose, Nginx, GitHub Actions, AWS (ECR, ECS Fargate, S3, CloudFront) |

---

## 🚀 Quick Start (Local Development)

### Prerequisites
- [Docker Desktop](https://www.docker.com/products/docker-desktop) installed & running
- [Node.js 20+](https://nodejs.org/) installed

### 1. Clone the Repository
```bash
git clone https://github.com/TejasAradhya7/Quizmefy.git
cd Quizmefy
```

### 2. Configure Environment Variables
Copy the example environment file:
```bash
cp .env.example .env
```
Open `.env` and add your OpenAI API Key:
```env
OPENAI_API_KEYS=sk-your-openai-api-key-here
```

### 3. Spin Up Containers
Run Docker Compose to build and start PostgreSQL, Redis, Node.js API, and Nginx frontend:
```bash
docker compose up --build
```

### 4. Access the Application
- 🌐 **Frontend UI**: [http://localhost:8080](http://localhost:8080)
- ⚡ **Backend API**: [http://localhost:3000](http://localhost:3000)
- 🩺 **Health Check**: [http://localhost:3000/health](http://localhost:3000/health)

---

## 📑 API Endpoints Summary

### Authentication Routes (`/api/v1/auth`)
- `POST /register` — Create a new user account `{ email, password, displayName? }`
- `POST /login` — Authenticate user and receive JWT pair `{ email, password }`
- `POST /refresh` — Rotate refresh token and issue new access token `{ refreshToken }`
- `POST /logout` — Revoke active refresh token session `[Auth Required]`
- `GET /me` — Retrieve current authenticated user profile `[Auth Required]`

### Quiz Routes (`/api/v1/quiz`)
- `POST /generate` — Generate or fetch cached quiz `{ topic, difficulty?, numQuestions?, customInstructions? }`
- `GET /:id` — Retrieve specific quiz details by ID
- `GET /` — List user's generated quiz history with pagination `[Auth Required]`

### Health Check (`/health`)
- `GET /health` — Returns DB & Redis connectivity status for load balancer health checks.

---

## 🧪 Testing & Verification

Run the comprehensive unit test suite:
```bash
# Run unit tests
npm test

# Run TypeScript strict type-check
npm run typecheck

# Run ESLint
npm run lint
```

---

## ☁️ Production Deployment (AWS & CI/CD)

The repository includes pre-configured GitHub Actions workflows for continuous integration and automated deployment:

1. **PR Checks (`.github/workflows/pr-checks.yml`)**: Runs on pull requests to validate linting, strict TypeScript types, unit tests, and secret scans.
2. **Production Deploy (`.github/workflows/ci.yml`)**: Runs on pushes to `main` to build the production Docker image, push to AWS ECR, execute rolling deployment on AWS ECS Fargate, and sync static assets to AWS S3 & CloudFront.

For full step-by-step instructions on configuring AWS IAM policies, ECR, RDS, ElastiCache, ECS Fargate, and CloudFront, read the **[AWS Setup Guide](file:///c:/Users/Tejas/Downloads/Quizmefy/infra/aws-setup.md)**.

---

## 📝 License

This project is open source and available under the [MIT License](LICENSE).
