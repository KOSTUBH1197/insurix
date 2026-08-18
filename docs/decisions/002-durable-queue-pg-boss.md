# 2. Durable job queue: pg-boss on Postgres, not Redis-backed

## Context

Section 3 requires "a durable queue, not `setTimeout`" for document parsing
jobs (10-60 seconds) but does not name a product. The spec also requires
`docker compose up` plus `pnpm dev` to make a new engineer productive in
under ten minutes (section 3), which argues against adding infrastructure
beyond what's load-bearing.

## Decision

Use `pg-boss`, which runs on the Postgres instance the app already requires,
instead of a Redis-backed queue (BullMQ). No second datastore for local dev
or production. Revisit only if job throughput or Postgres contention becomes
a measured problem, not preemptively.

## Consequences

- `docker-compose.yml` needs only Postgres and MinIO, not Redis.
- Job state lives in the same database as everything else, so it's covered
  by existing backup and migration tooling.
- Ceiling on throughput is lower than a dedicated queue; acceptable at this
  product's expected volume (document parsing per user action, not
  high-frequency event processing).
- The actual worker process is built in stage 5 (upload pipeline); this ADR
  only fixes the choice ahead of that so the compose file doesn't need to
  change later.
