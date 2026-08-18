# 1. pnpm workspace monorepo with Turborepo

## Context

Section 2.6 of the build spec requires the deduction engine to be "pure and
framework free... zero imports from Next.js, the database, or the AI
provider." An ESLint rule can flag such imports, but it can be disabled or
missed. A package boundary cannot: if `packages/domain` never lists Next.js,
Drizzle, or the Anthropic SDK as a dependency, importing them is a module
resolution error, not a lint warning.

## Decision

Structure the repo as a pnpm workspace: `apps/web` (Next.js), `packages/domain`
(pure engine, stage 2), `packages/db` (Drizzle schema and client). Use
Turborepo to run `dev`/`build`/`lint`/`typecheck`/`test` across the workspace
with caching, since these packages have real dependency edges
(`apps/web` depends on both `packages/*`).

## Consequences

- The framework-free constraint is enforced structurally, not by convention.
- One more root-level tool (`turbo.json`) to maintain.
- Future packages (e.g. a worker process for the job queue, stage 5) slot in
  the same way without restructuring.
