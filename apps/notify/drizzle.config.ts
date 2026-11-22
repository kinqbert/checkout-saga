import { defineConfig } from "drizzle-kit";

// points at the compiled schema: run `pnpm build` before `pnpm db:generate`.
export default defineConfig({
  out: "./drizzle",
  schema: "./dist/db/schema.js",
  schemaFilter: ["notify"],
  dialect: "postgresql",
});
