FROM python:3.11-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential gcc g++ libgomp1 \
    && rm -rf /var/lib/apt/lists/*

COPY back2/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

COPY back2/ ./
COPY agent_datasets/ ../agent_datasets/

EXPOSE 8000

CMD ["uvicorn", "saas_api:app", "--host", "0.0.0.0", "--port", "8000"]