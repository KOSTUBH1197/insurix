# Insurix

Tells Indian health insurance policyholders how much of their hospital bill
they'll actually get back, and why the rest was cut. See
[`insurix-build-spec.md`](./insurix-build-spec.md) for the full product and
engineering specification, and [`docs/decisions/`](./docs/decisions/) for why
the stack looks the way it does.

## Status

Repo scaffold only (build stage 1 of [section 11](./insurix-build-spec.md#11-build-order)).
No product features are implemented yet.

## Prerequisites

- Node.js 20.9+ (see `.nvmrc`)
- pnpm 9+ (`corepack enable` will pick up the version pinned in `package.json`)
- Docker, for Postgres and local S3-compatible storage

## Setup

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm dev
```

The app starts at [http://localhost:3000](http://localhost:3000). It fails
loudly at boot — not at request time — if a required environment variable in
`.env` is missing or malformed; see `apps/web/lib/env.ts`.

## Workspace layout

```
apps/
  web/            Next.js 15 app (App Router)
packages/
  domain/         Pure deduction engine — zero framework imports, by construction
  db/             Drizzle schema and client
docs/
  decisions/      Architectural decisions: context, decision, consequences
  assumptions.md  Regulatory/product ambiguities resolved as configurable, not guessed
  verify-before-launch.md   Claims that need checking against real policy documents
```

## Commands

Run from the repo root; Turborepo fans these out to every workspace package.

| Command | What it does |
|---|---|
| `pnpm dev` | Start all apps in dev mode |
| `pnpm build` | Production build of everything |
| `pnpm lint` | ESLint across the workspace |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm test` | Unit tests (Vitest) |
| `pnpm test:coverage` | Unit tests with coverage report |
| `pnpm db:generate` | Generate a Drizzle migration from schema changes |
| `pnpm db:migrate` | Apply migrations to `DATABASE_URL` |

## Conventions

- **No `any`.** TypeScript strict mode plus `noUncheckedIndexedAccess` is on
  everywhere; ESLint's `no-explicit-any` is an error, not a warning.
- **Money is integer paise, never a float.** The `Money` value type lands in
  `packages/domain` in build stage 2.
- **The domain package takes no dependencies on Next.js, the database, or
  the AI provider.** If a change to `packages/domain` seems to need one,
  that's a sign the logic belongs elsewhere.
- **Every external boundary is validated with Zod at runtime** — env vars,
  API bodies, LLM output, uploaded file contents. Parse, don't cast.
