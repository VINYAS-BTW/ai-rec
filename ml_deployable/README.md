# ML Deployable - AI Recommendation Engine

A production-ready machine learning service for deploying AI-powered recommendation systems using Docker, FastAPI, Celery, and MLflow on AWS.

## Table of Contents

- [Overview](#overview)
- [Prerequisites](#prerequisites)
- [Architecture](#architecture)
- [Deployment Guide](#deployment-guide)
  - [Phase 1: AWS Setup](#phase-1-aws-setup)
  - [Phase 2: Server Configuration](#phase-2-server-configuration)
  - [Phase 3: Deploying Your Code](#phase-3-deploying-your-code)
  - [Phase 4: Launch](#phase-4-launch)
  - [Phase 5: Access Your Platform](#phase-5-access-your-platform)
- [Troubleshooting](#troubleshooting)

## Overview

This ML deployable service provides a scalable, containerized recommendation engine that includes:

- **FastAPI Service** - REST API for recommendations
- **Celery Worker** - Asynchronous task processing
- **Redis** - Message broker for task queues
- **MLflow** - Model tracking and versioning
- **AWS Integration** - S3 for model storage and ETL pipeline

## Prerequisites

Before deploying, ensure you have:

- AWS Account with permissions to create S3, EC2, and IAM resources
- SSH client (built-in on Linux/Mac; Git Bash on Windows)
- Local copy of the project files
- Python 3.9+ (for local development)

## Architecture

```
┌─────────────────────────────────────────────────┐
│         AWS Cloud Environment                   │
├─────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐   │
│  │  EC2 Instance (Ubuntu 24.04)            │   │
│  │  ┌──────────────┐  ┌──────────────┐    │   │
│  │  │  FastAPI API │  │  Celery      │    │   │
│  │  │ (Port 80)    │  │  Worker      │    │   │
│  │  └──────────────┘  └──────────────┘    │   │
│  │  ┌──────────────┐  ┌──────────────┐    │   │
│  │  │  Redis       │  │  MLflow      │    │   │
│  │  │ (Port 6379)  │  │ (Port 5000)  │    │   │
│  │  └──────────────┘  └──────────────┘    │   │
│  └─────────────────────────────────────────┘   │
│                    ↓                            │
│  ┌──────────────────────────────────────────┐  │
│  │  S3 Bucket (Model & Artifact Storage)    │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

## Deployment Guide

### Phase 1: AWS Setup (The Infrastructure)

We need a place to store files (S3) and a computer to run your code (EC2).

#### Step 1: Create an S3 Bucket

1. Log in to the [AWS Console](https://console.aws.amazon.com)
2. Search for **S3** and click **Create bucket**
3. **Name**: `my-recommender-saas-unique-name` (Bucket names must be globally unique)
4. **Region**: Choose `us-east-1` (or one close to you)
5. **Block Public Access**: Keep all checked (Block all)
6. Click **Create bucket**

#### Step 2: Create an IAM User (For Credentials)

Your code needs "Username/Password" to talk to S3.

1. Search for **IAM** → **Users** → **Create user**
2. **Name**: `recommender-bot`
3. **Permissions**: Select "Attach policies directly"
4. Search for and select: `AmazonS3FullAccess`
5. Click **Next** → **Create user**
6. Click on the new user → **Security credentials** tab
7. Scroll down to **Access keys** → **Create access key**
8. Select **Local code** → **Next** → **Create access key**
9. **⚠️ COPY THESE NOW**: Access Key and Secret Key. You won't see them again.

#### Step 3: Launch an EC2 Instance

1. Search for **EC2** → **Instances** → **Launch instances**
2. **Name**: `Recommender-Server`
3. **OS**: Select Ubuntu Server 24.04 LTS
4. **Instance Type**: 
   - `t2.micro` (Free tier)
   - `t2.medium` (Recommended if you have budget, ~$30/mo, runs faster)
5. **Key pair**: Create new key pair → Name it `deploy-key` → Download `.pem` file
6. **Network settings**:
   - ✓ Allow SSH traffic from → Anywhere (0.0.0.0/0)
   - ✓ Allow HTTP traffic from the internet
   - ✓ Allow HTTPS traffic from the internet
7. Click **Launch instance**

### Phase 2: Server Configuration

Now we turn that empty cloud computer into a machine learning server.

#### Step 1: Connect to Your Server

Open your terminal (on your laptop) where you downloaded the `.pem` file:

```bash
# 1. Protect your key (required for SSH)
chmod 400 deploy-key.pem

# 2. Connect to the server
# Find your Public IPv4 address in the EC2 console
ssh -i "deploy-key.pem" ubuntu@<YOUR_EC2_PUBLIC_IP>
```

#### Step 2: Install Docker and Docker Compose

Once inside the server (you'll see `ubuntu@ip-...`), run these commands:

```bash
# Update the system
sudo apt-get update
sudo apt-get upgrade -y

# Install Docker
sudo apt-get install docker.io -y
sudo systemctl start docker
sudo systemctl enable docker

# Allow 'ubuntu' user to run docker commands
sudo usermod -aG docker ubuntu

# Install Docker Compose
sudo apt-get install docker-compose-v2 -y

# Exit and reconnect to refresh permissions
exit
```

Then reconnect with SSH to refresh your group permissions.

### Phase 3: Deploying Your Code

We will transfer your files and prepare the Docker containers.

#### Step 1: Prepare the Project Structure

Inside the EC2 terminal:

```bash
mkdir my-saas
cd my-saas
```

#### Step 2: Create the Dockerfile

Create a file named `Dockerfile` on the server:

```bash
nano Dockerfile
```

Paste this content:

```dockerfile
FROM python:3.9-slim

# Install system dependencies (needed for psycopg2/numpy)
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements first (for caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the app
COPY . .
```

Save and exit: Press `Ctrl+X`, then `Y`, then `Enter`.

#### Step 3: Create docker-compose.yml

Create the Docker Compose configuration to run your API, Worker, Redis, and MLflow together:

```bash
nano docker-compose.yml
```

Paste this configuration:

```yaml
version: '3.8'

services:
  # 1. The API Service
  api:
    build: .
    container_name: saas_api
    command: uvicorn saas_api:app --host 0.0.0.0 --port 80
    ports:
      - "80:80"
    env_file: .env
    depends_on:
      - redis
      - mlflow

  # 2. The Worker Service
  worker:
    build: .
    container_name: saas_worker
    command: celery -A worker.celery_app worker --loglevel=info
    env_file: .env
    depends_on:
      - redis
      - mlflow

  # 3. Redis (Message Broker)
  redis:
    image: redis:alpine
    container_name: saas_redis
    ports:
      - "6379:6379"

  # 4. MLflow (Model Tracking)
  mlflow:
    image: ghcr.io/mlflow/mlflow:latest
    container_name: saas_mlflow
    ports:
      - "5000:5000"
    command: >
      mlflow server
      --backend-store-uri sqlite:///mlflow.db
      --default-artifact-root s3://${AWS_BUCKET_NAME}/mlflow/
      --host 0.0.0.0
    environment:
      - AWS_ACCESS_KEY_ID=${AWS_ACCESS_KEY_ID}
      - AWS_SECRET_ACCESS_KEY=${AWS_SECRET_ACCESS_KEY}
      - AWS_DEFAULT_REGION=${AWS_REGION}
```

Save and exit (`Ctrl+X`, `Y`, `Enter`).

#### Step 4: Create the .env File

This is the most critical step. Paste your real secrets here:

```bash
nano .env
```

Paste this template and fill in your details:

```env
# --- AWS Credentials (from Phase 1) ---
AWS_ACCESS_KEY_ID=AKIA......
AWS_SECRET_ACCESS_KEY=wJalr......
AWS_REGION=us-east-1
AWS_BUCKET_NAME=my-recommender-saas-unique-name

# --- Database (Neon Postgres) ---
# Replace with your actual Neon URL
DATABASE_URL=postgres://user:pass@ep-xyz.aws.neon.tech/neondb?sslmode=require

# --- Internal Configuration ---
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/0
MLFLOW_TRACKING_URI=http://mlflow:5000

# --- Webhook (Optional) ---
# Point this to your node service if you deployed it, or leave as localhost for now
WEBHOOK_SERVICE_URL=http://node_service:3001/api/apps
```

Save and exit.

#### Step 5: Upload Your Python Files

Copy your local Python files to the server. Open a **new terminal** on your laptop (not the SSH one):

```bash
# Navigate to your project directory, then:
scp -i "deploy-key.pem" *.py requirements.txt ubuntu@<YOUR_EC2_IP>:~/my-saas/
```

This copies all `.py` files and `requirements.txt` to the server.

### Phase 4: Launch

Go back to your EC2 terminal (SSH session).

#### Build and Run

```bash
cd ~/my-saas
sudo docker compose up -d --build
```

This will take a few minutes to download Python and install libraries.

#### Check Status

```bash
sudo docker compose ps
```

You should see all four services (`saas_api`, `saas_worker`, `redis`, `mlflow`) showing as **Up**.

#### View Logs (If Something Breaks)

```bash
# View API logs
sudo docker compose logs -f api

# Or view worker logs
sudo docker compose logs -f worker
```

### Phase 5: Access Your Platform

You are live!

#### API Documentation

Open your browser and navigate to:

```
http://<YOUR_EC2_PUBLIC_IP>/docs
```

You will see the **Swagger UI** with all available endpoints.

#### MLflow UI

Open your browser and navigate to:

```
http://<YOUR_EC2_PUBLIC_IP>:5000
```

> **Note**: If MLflow UI doesn't load, you need to open Port 5000 in your EC2 Security Group (see instructions below).

#### Open Port 5000 for MLflow

1. Go to **AWS Console** → **EC2** → **Instances**
2. Click your instance → **Security** tab → Click the **Security group** link
3. **Edit inbound rules** → **Add rule**
4. **Type**: Custom TCP | **Port**: 5000 | **Source**: Anywhere (0.0.0.0/0)
5. **Save rules**

## Troubleshooting

### Containers won't start

```bash
# Check logs for errors
sudo docker compose logs -f api

# Rebuild from scratch
sudo docker compose down
sudo docker compose up -d --build
```

### Cannot connect to API

1. Verify EC2 security group allows inbound HTTP (port 80)
2. Verify instance is running: `sudo docker compose ps`
3. Check if API is healthy: `sudo docker compose logs api`

### MLflow UI not accessible

1. Ensure port 5000 is open in EC2 Security Group (see Phase 5)
2. Verify MLflow container is running: `sudo docker compose ps mlflow`
3. Check MLflow logs: `sudo docker compose logs mlflow`

### Database connection errors

1. Verify `DATABASE_URL` in `.env` is correct
2. Ensure Neon database is accessible from EC2
3. Check credentials are properly set in `.env`

### Worker not processing tasks

1. Verify Redis is running: `sudo docker compose ps redis`
2. Check worker logs: `sudo docker compose logs -f worker`
3. Verify `CELERY_BROKER_URL` uses correct Redis hostname