import { z } from "zod";

/**
 * Validated at import time so the process fails loudly at boot when a
 * required variable is missing or malformed, never silently at request
 * time. Extend this schema as each build stage starts reading a new
 * variable — see .env.example for the full planned surface.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  DATABASE_URL: z.string().url(),
});

function loadEnv(): z.infer<typeof envSchema> {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}

export const env = loadEnv();
