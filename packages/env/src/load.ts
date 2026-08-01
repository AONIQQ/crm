import { loadRootEnv } from "./index";

/**
 * Side-effect entry point: `import "@crm/env/load";`.
 *
 * ES module imports are hoisted and evaluated before any statement in the
 * importing file, so a module that reads `process.env` at import time — as
 * `@crm/auth`'s config and `@crm/db`'s client both do — cannot load the file
 * itself from its own top-level code and still be sure it ran first. Importing
 * this module can only run before them.
 */
loadRootEnv();
