/**
 * Core error types.
 * Centralized error handling for the Roo-Code application.
 *
 * Error domains:
 * - Streaming errors: Occur during stream processing and parsing
 * - Tool errors: Occur during tool validation and execution
 */

export * from "./streaming/index.js"
export * from "./tools/index.js"
