import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/infrastructure/db/schema.ts',
  out: './drizzle'
})
