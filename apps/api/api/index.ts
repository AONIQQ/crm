// Thin wrapper: the real handler is pre-bundled by scripts/bundle-serverless.ts
// at build time so the platform bundler never walks the app's import graph.
// @ts-expect-error generated at build time
export { default } from "./bundle.mjs"
