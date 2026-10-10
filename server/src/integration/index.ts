/**
 * F062.1 — the integration contract surface.
 *
 * A single entry point so the boundary suite can resolve the complete
 * transitive module graph from one place and assert it against a reviewed
 * closed set. Re-exports only; this module contains no logic.
 *
 * **This slice is inert by construction.** Nothing here opens a socket, reads
 * a credential, touches the database, enqueues work or loads a vendor SDK, and
 * the boundary suite proves that from the emitted graph rather than from this
 * comment.
 */
export * from './connector-capabilities.js';
export * from './connector-registry.js';
export * from './delivery-contract.js';
export * from './fact-authority.js';
export * from './integration-envelope.js';
export * from './integration-telemetry.js';
export * from './schema-compatibility.js';
