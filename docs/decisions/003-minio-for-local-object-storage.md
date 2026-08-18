# 3. MinIO for local object storage

## Context

Section 3 specifies "S3 compatible, presigned uploads" and documents never
passing through the app server. Local development needs an S3-compatible
target that doesn't require real AWS credentials or a live bucket.

## Decision

Run MinIO in `docker-compose.yml` for local development. The presigned
upload code (stage 5) targets the S3 API generically (endpoint, region,
bucket, credentials all from environment configuration per section 2.1), so
production can point at real S3 or another S3-compatible provider without
code changes.

## Consequences

- Local dev has a real object store to test presigned upload flows against,
  not a mock.
- One more container in `docker compose up`, justified because the upload
  path is a named requirement, not incidental.
