import { defineConfig } from "drizzle-kit";

// Points at the compiled schema: run `pnpm build` before `pnpm db:generate`.
export default defineConfig({
  out: "./drizzle",
  schema: "./dist/db/schema.js",
  schemaFilter: ["orders"],
  dialect: "postgresql",
});
