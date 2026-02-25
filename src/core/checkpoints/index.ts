/**
 * Checkpoint module
 *
 * Provides checkpoint save, restore, and diff functionality for task state management.
 *
 * @module checkpoints
 */

// Service initialization and save operations
export { getCheckpointService, checkpointSave } from "./checkpoint-service"

// Restore and diff operations
export { checkpointRestore } from "./checkpoint-restore"
export { checkpointDiff } from "./checkpoint-diff"

// Re-export types
export type { CheckpointRestoreOptions } from "./checkpoint-restore"
export type { CheckpointDiffOptions } from "./checkpoint-diff"
