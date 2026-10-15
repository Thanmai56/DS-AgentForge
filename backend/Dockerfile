FROM python:3.12-slim

WORKDIR /app

# System deps (for JayDeBeApi + JDBC + psycopg2)
RUN apt-get update && apt-get install -y \
    default-jdk \
    libpq-dev \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Java for JDBC
ENV JAVA_HOME=/usr/lib/jvm/default-java
ENV PATH="$JAVA_HOME/bin:$PATH"

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Download sentence-transformers model at build time (offline after this)
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('all-MiniLM-L6-v2')"

COPY . .

EXPOSE 8000
