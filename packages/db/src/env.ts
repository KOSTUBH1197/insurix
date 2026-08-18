import { z } from "zod";

const dbEnvSchema = z.object({
  DATABASE_URL: z.string().url(),
});

function loadDbEnv(): z.infer<typeof dbEnvSchema> {
  const result = dbEnvSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid database environment configuration:\n${issues}`);
  }

  return result.data;
}

export const dbEnv = loadDbEnv();
