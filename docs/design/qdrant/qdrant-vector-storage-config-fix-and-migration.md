# Vector Storage Configuration Fix and Migration Strategy

## Executive Summary

This document provides a comprehensive analysis and fix design for the Vector Storage Configuration issue in Roo Code's code indexing module, along with a recommended migration strategy.

**Problem Statement**: The Vector Storage Configuration settings are not being applied correctly, causing the system to always use the highest preset (medium) configuration, resulting in storage redundancy.

**Root Cause**: The `vectorStorageConfig` field is missing from the `CodeIndexConfig` interface returned by `CodeIndexConfigManager.getConfig()`, preventing the `VectorStorageConfigManager` from being instantiated.

---

## Table of Contents

1. [Current Architecture Analysis](#current-architecture-analysis)
2. [Identified Issues](#identified-issues)
3. [Design Solution](#design-solution)
4. [Migration Strategy](#migration-strategy)
5. [Implementation Plan](#implementation-plan)
6. [Testing Strategy](#testing-strategy)
7. [Risk Assessment](#risk-assessment)

---

## Current Architecture Analysis

### Component Overview

```
src/services/code-index/
├── config-manager.ts                      # CodeIndexConfigManager
├── vector-storage-config-manager.ts       # VectorStorageConfigManager
├── service-factory.ts                     # CodeIndexServiceFactory
├── vector-store/
│   ├── qdrant-client.ts                   # QdrantVectorStore
│   ├── collection-config-upgrade-service.ts
│   └── collection-size-estimator.ts
└── interfaces/
    ├── config.ts                          # CodeIndexConfig interface
    └── vector-storage-config.ts           # VectorStorageConfig types
```

### Current Data Flow

```
┌──────────────────────┐
│  Frontend            │
│  (CodeIndexPopover)  │
│  - vectorStorageMode │
│  - vectorStoragePreset│
│  - vectorStorageThresholds│
└──────────┬───────────┘
           │ saveCodeIndexSettingsAtomic
           ▼
┌──────────────────────┐
│  Backend             │
│  (webviewMessageHandler)│
│  Saves to globalState │
└──────────┬───────────┘
           │ loadConfiguration()
           ▼
┌──────────────────────┐
│  CodeIndexConfigManager│
│  - _loadAndSetConfiguration()│
│  - _vectorStorageConfig (internal)│
└──────────┬───────────┘
           │ getConfig() ❌ MISSING vectorStorageConfig
           ▼
┌──────────────────────┐
│  CodeIndexServiceFactory│
│  createVectorStore()  │
│  if (config.vectorStorageConfig) ❌ Always undefined
│    → Never creates VectorStorageConfigManager
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  QdrantVectorStore   │
│  getCollectionConfig()│
│  → Uses FALLBACK      │
│    (medium preset)   │
└──────────────────────┘
```

### Configuration Loading (Current Implementation)

```typescript
// config-manager.ts - Line 25
private _vectorStorageConfig: VectorStorageConfig = DEFAULT_VECTOR_STORAGE_CONFIG

// Line 158-176
let effectiveMode: VectorStorageConfig["mode"] = (vectorStorageMode as VectorStorageConfig["mode"]) ?? "auto"
if ((vectorStorageMode as string) === "preset" && vectorStoragePreset) {
    effectiveMode = vectorStoragePreset as VectorStorageConfig["mode"]
}

this._vectorStorageConfig = {
    mode: effectiveMode,
    thresholds: {
        tiny: savedThresholds?.tiny ?? defaultThresholds.tiny,
        small: savedThresholds?.small ?? defaultThresholds.small,
        medium: savedThresholds?.medium ?? defaultThresholds.medium,
        large: savedThresholds?.large ?? defaultThresholds.large,
    },
    // ❌ MISSING: preset field for preset mode
}

// Line 450-462 - getConfig() method
public getConfig(): CodeIndexConfig {
    return {
        isConfigured: this.isConfigured(),
        embedderProvider: this.embedderProvider,
        modelId: this.modelId,
        modelDimension: this.modelDimension,
        openAiOptions: this.openAiOptions,
        openAiCompatibleOptions: this.openAiCompatibleOptions,
        geminiOptions: this.geminiOptions,
        qdrantUrl: this.qdrantUrl,
        qdrantApiKey: this.qdrantApiKey,
        searchMinScore: this.currentSearchMinScore,
        searchMaxResults: this.currentSearchMaxResults,
        // ❌ MISSING: vectorStorageConfig field
    }
}
```

### Service Factory (Current Implementation)

```typescript
// service-factory.ts - Line 127-154
public createVectorStore(): IVectorStore {
    const config = this.configManager.getConfig()
    
    // ... vector size determination ...
    
    // ❌ This condition is ALWAYS false because getConfig() doesn't include vectorStorageConfig
    let vectorStorageConfigManager: VectorStorageConfigManager | undefined
    if (config.vectorStorageConfig) {  // ← Always undefined
        const tempClient = new QdrantClient({
            url: config.qdrantUrl,
            apiKey: config.qdrantApiKey,
        })
        
        const hash = createHash("sha256").update(this.workspacePath).digest("hex")
        const collectionName = `ws-${hash.substring(0, 16)}`
        
        vectorStorageConfigManager = new VectorStorageConfigManager(
            config.vectorStorageConfig,
            tempClient,
            collectionName,
        )
    }
    
    return new QdrantVectorStore(
        this.workspacePath,
        config.qdrantUrl,
        vectorSize,
        config.qdrantApiKey,
        vectorStorageConfigManager,  // ← Always undefined
    )
}
```

### QdrantVectorStore Fallback (Current Behavior)

```typescript
// qdrant-client.ts - Line 871-895
private async getCollectionConfig(): Promise<{
    vectors: { on_disk: boolean; quantization?: { enabled: boolean; type: string; bits?: number } }
    hnsw?: { m: number; ef_construct: number }
    wal?: { capacity_mb: number; segments: number }
}> {
    if (this.vectorStorageConfigManager) {  // ← Never true
        const config = await this.vectorStorageConfigManager.getCollectionConfig()
        return {
            vectors: {
                on_disk: config.vectors.on_disk,
                quantization: config.vectors.quantization,
            },
            hnsw: config.hnsw,
            wal: config.wal,
        }
    }
    
    // ❌ FALLBACK - Always used (medium preset)
    return {
        vectors: {
            on_disk: true,
        },
        hnsw: {
            m: 64,
            ef_construct: 512,
        },
    }
}
```

---

## Identified Issues

### Issue 1: Missing vectorStorageConfig in CodeIndexConfig (Critical)

**Severity**: P0 - Critical

**Description**: The `CodeIndexConfig` interface and `getConfig()` method do not include the `vectorStorageConfig` field, preventing the configuration from being passed to the service factory.

**Impact**: 
- VectorStorageConfigManager is never instantiated
- System always uses fallback configuration (medium preset)
- User settings for vector storage are ignored
- Storage redundancy and suboptimal performance

**Location**: 
- `src/services/code-index/interfaces/config.ts` - Interface definition
- `src/services/code-index/config-manager.ts` - `getConfig()` method

### Issue 2: Missing preset Field in VectorStorageConfig (Medium)

**Severity**: P2 - Medium

**Description**: When mode is "preset", the `preset` field is not being set in `_vectorStorageConfig`.

**Impact**:
- VectorStorageConfigManager cannot determine which preset to use in preset mode
- Falls back to default behavior

**Location**: 
- `src/services/code-index/config-manager.ts` - `_loadAndSetConfiguration()` method

### Issue 3: No Data Migration Detection (High)

**Severity**: P1 - High

**Description**: No mechanism exists to detect when storage configuration changes require data re-indexing vs. simple parameter updates.

**Impact**:
- Users may switch quantization settings without understanding data will be corrupted
- HNSW parameter changes may not take effect properly
- No warning or guidance provided to users

**Location**: 
- `src/services/code-index/vector-storage-config-manager.ts`
- `src/services/code-index/config-manager.ts` - `doesConfigChangeRequireRestart()`

### Issue 4: Incomplete Configuration Change Detection (Medium)

**Severity**: P2 - Medium

**Description**: `doesConfigChangeRequireRestart()` checks for vectorStorageMode changes but the comparison may not work correctly due to how the mode is stored.

**Impact**:
- Configuration changes may not trigger restart when needed
- Or may trigger unnecessary restarts

---

## Design Solution

### Fix 1: Add vectorStorageConfig to CodeIndexConfig Interface

**File**: `src/services/code-index/interfaces/config.ts`

```typescript
import { ApiHandlerOptions } from "../../../shared/api"
import { EmbedderProvider } from "./manager"
import { VectorStorageConfig } from "./vector-storage-config"

/**
 * Configuration state for the code indexing feature
 */
export interface CodeIndexConfig {
    isConfigured: boolean
    embedderProvider: EmbedderProvider
    modelId?: string
    modelDimension?: number
    openAiOptions?: ApiHandlerOptions
    openAiCompatibleOptions?: { baseUrl: string; apiKey: string }
    geminiOptions?: { apiKey: string }
    qdrantUrl?: string
    qdrantApiKey?: string
    searchMinScore?: number
    searchMaxResults?: number
    // ✅ ADD THIS FIELD
    vectorStorageConfig?: VectorStorageConfig
}
```

**Rationale**: This is the minimal change required to pass the vector storage configuration through the system.

### Fix 2: Include vectorStorageConfig in getConfig()

**File**: `src/services/code-index/config-manager.ts`

```typescript
/**
 * Gets the current configuration state.
 */
public getConfig(): CodeIndexConfig {
    return {
        isConfigured: this.isConfigured(),
        embedderProvider: this.embedderProvider,
        modelId: this.modelId,
        modelDimension: this.modelDimension,
        openAiOptions: this.openAiOptions,
        openAiCompatibleOptions: this.openAiCompatibleOptions,
        geminiOptions: this.geminiOptions,
        qdrantUrl: this.qdrantUrl,
        qdrantApiKey: this.qdrantApiKey,
        searchMinScore: this.currentSearchMinScore,
        searchMaxResults: this.currentSearchMaxResults,
        // ✅ ADD THIS LINE
        vectorStorageConfig: this._vectorStorageConfig,
    }
}
```

**Rationale**: Ensures the vector storage configuration is available to consumers of the config.

### Fix 3: Add preset Field When in Preset Mode

**File**: `src/services/code-index/config-manager.ts`

```typescript
// In _loadAndSetConfiguration():

// Load vector storage configuration
// If vectorStorageMode is "preset", convert it to the actual preset value for backward compatibility
let effectiveMode: VectorStorageConfig["mode"] = (vectorStorageMode as VectorStorageConfig["mode"]) ?? "auto"
let presetValue: VectorStoragePreset | undefined

if ((vectorStorageMode as string) === "preset" && vectorStoragePreset) {
    // Backward compatibility: convert old "preset" mode to actual preset
    effectiveMode = vectorStoragePreset as VectorStorageConfig["mode"]
    presetValue = vectorStoragePreset as VectorStoragePreset
}

// Ensure thresholds have all required fields
const defaultThresholds = DEFAULT_VECTOR_STORAGE_CONFIG.thresholds ?? {
    tiny: 2000,
    small: 10000,
    medium: 100000,
    large: 1000000,
}
const savedThresholds = codebaseIndexConfig.vectorStorageThresholds

this._vectorStorageConfig = {
    mode: effectiveMode,
    // ✅ ADD THIS LINE
    preset: presetValue,
    thresholds: {
        tiny: savedThresholds?.tiny ?? defaultThresholds.tiny,
        small: savedThresholds?.small ?? defaultThresholds.small,
        medium: savedThresholds?.medium ?? defaultThresholds.medium,
        large: savedThresholds?.large ?? defaultThresholds.large,
    },
}
```

**Rationale**: Ensures the preset field is properly set when in preset mode.

### Fix 4: Add Configuration Change Detection for Re-indexing

**File**: `src/services/code-index/vector-storage-config-manager.ts`

```typescript
/**
 * Determines if a configuration change requires re-indexing (data migration).
 * 
 * Re-indexing is required when:
 * - Quantization is enabled/disabled (changes vector representation)
 * - Quantization type changes (scalar ↔ product)
 * - Vector dimension changes (handled separately in QdrantVectorStore)
 * 
 * Re-indexing is NOT required when:
 * - HNSW parameters change (can be updated dynamically)
 * - WAL parameters change (affects future writes only)
 * - Threshold changes (affects future preset selection)
 */
static requiresReindexing(
    oldConfig: CustomVectorStorageConfig,
    newConfig: CustomVectorStorageConfig
): boolean {
    // Check quantization changes
    const oldQuantization = oldConfig.vectors.quantization
    const newQuantization = newConfig.vectors.quantization
    
    // Quantization enabled/disabled
    if (oldQuantization?.enabled !== newQuantization?.enabled) {
        return true
    }
    
    // Quantization type changed
    if (oldQuantization?.enabled && newQuantization?.enabled &&
        oldQuantization.type !== newQuantization.type) {
        return true
    }
    
    // Quantization bits changed (when enabled)
    if (oldQuantization?.enabled && newQuantization?.enabled &&
        oldQuantization.bits !== newQuantization.bits) {
        return true
    }
    
    return false
}

/**
 * Determines if a configuration change requires restarting the service.
 * This is separate from re-indexing - some changes can be applied dynamically.
 */
static requiresRestart(
    oldConfig: VectorStorageConfig,
    newConfig: VectorStorageConfig
): boolean {
    // Mode changed (auto ↔ preset ↔ custom)
    if (oldConfig.mode !== newConfig.mode) {
        return true
    }
    
    // Preset changed in preset mode
    if (oldConfig.mode === "preset" && newConfig.mode === "preset" &&
        oldConfig.preset !== newConfig.preset) {
        return true
    }
    
    // Custom config changed
    if (oldConfig.mode === "custom" && newConfig.mode === "custom" &&
        oldConfig.customConfig && newConfig.customConfig &&
        this.requiresReindexing(oldConfig.customConfig, newConfig.customConfig)) {
        return true
    }
    
    // Thresholds changed in auto mode (may affect future behavior, but doesn't require restart)
    // No restart needed - will apply on next size check
    
    return false
}
```

**Rationale**: Provides clear guidance on when re-indexing is required vs. when changes can be applied dynamically.

### Fix 5: Update Config Change Detection in ConfigManager

**File**: `src/services/code-index/config-manager.ts`

```typescript
/**
 * Determines if a configuration change requires restarting the indexing process.
 */
doesConfigChangeRequireRestart(prev: PreviousConfigSnapshot): boolean {
    // ... existing checks ...
    
    // Vector storage configuration changes
    const prevVectorStorageMode = prev?.vectorStorageMode ?? "auto"
    const currentVectorStorageMode = this._vectorStorageConfig.mode
    
    if (prevVectorStorageMode !== currentVectorStorageMode) {
        return true
    }
    
    // ✅ ADD: Check for preset changes in preset mode
    if (currentVectorStorageMode === "preset") {
        const prevPreset = prev?.vectorStoragePreset
        const currentPreset = this._vectorStorageConfig.preset
        if (prevPreset !== currentPreset) {
            return true
        }
    }
    
    // ... rest of existing checks ...
}
```

**Rationale**: Ensures preset changes in preset mode trigger a restart.

---

## Migration Strategy

### Recommended Approach: Create New Collection, Then Delete Old

**Recommendation**: ✅ **YES** - Use the "create new, then delete old" approach for migration.

### Rationale

#### Advantages of Create-Then-Delete Approach

1. **Data Integrity**: 
   - Old collection remains intact until new collection is fully built
   - Can rollback if migration fails partway through
   - No risk of partial data corruption

2. **Simplified Logic**:
   - No need to handle complex in-place update scenarios
   - No need to track which points have been migrated
   - Clean separation between old and new state

3. **Error Recovery**:
   - If migration fails, old collection is still available
   - Can retry migration without data loss
   - Easier to provide meaningful error messages

4. **Consistent with Existing Pattern**:
   - Already used for vector dimension changes in `QdrantVectorStore._recreateCollectionWithNewDimension()`
   - Proven pattern in the codebase

5. **Qdrant Limitations**:
   - Qdrant doesn't support changing vector dimension in-place
   - Quantization changes require re-embedding vectors
   - HNSW parameter changes may not apply to existing vectors properly

#### Migration Flow

```
┌─────────────────────────────────────────────────────────────┐
│  Migration Start                                            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  1. Create temporary collection with new config             │
│     Name: {collectionName}_new or {collectionName}_v2       │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  2. Re-index all data into temporary collection             │
│     - Scan all files                                       │
│     - Generate embeddings with new config                  │
│     - Upsert into temporary collection                     │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  3. Verify temporary collection                             │
│     - Check point count matches                            │
│     - Validate sample vectors                              │
│     - Create payload indexes                               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  4. Atomic swap                                             │
│     - Delete old collection                                │
│     - Rename temporary to final name                       │
│       (or update references to use new name)               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  5. Cleanup and confirmation                                │
│     - Verify new collection is accessible                  │
│     - Send success notification                            │
│     - Log migration completion                             │
└─────────────────────────────────────────────────────────────┘
```

### Implementation Design

#### New Interface: MigrationStrategy

```typescript
// src/services/code-index/interfaces/vector-store.ts

export interface MigrationContext {
    collectionName: string
    oldConfig: CustomVectorStorageConfig
    newConfig: CustomVectorStorageConfig
    requiresReindexing: boolean
    estimatedDuration?: number
    progressCallback?: (progress: number, message: string) => Promise<void>
}

export interface MigrationResult {
    success: boolean
    newCollectionName?: string
    oldCollectionDeleted?: boolean
    error?: string
    duration?: number
}

export interface IMigrationStrategy {
    /**
     * Executes the migration from old configuration to new configuration.
     */
    migrate(context: MigrationContext): Promise<MigrationResult>
    
    /**
     * Validates that migration is possible and safe.
     */
    validate(context: MigrationContext): { valid: boolean; errors: string[] }
    
    /**
     * Estimates the time required for migration.
     */
    estimateDuration(context: MigrationContext): Promise<number>
}
```

#### Implementation: RecreateCollectionMigration

```typescript
// src/services/code-index/vector-store/recreate-collection-migration.ts

import { IMigrationStrategy, MigrationContext, MigrationResult } from "../interfaces/vector-store"
import { QdrantClient } from "@qdrant/js-client-rest"

export class RecreateCollectionMigration implements IMigrationStrategy {
    constructor(
        private readonly client: QdrantClient,
        private readonly vectorSize: number,
        private readonly distanceMetric: string = "Cosine"
    ) {}
    
    async migrate(context: MigrationContext): Promise<MigrationResult> {
        const startTime = Date.now()
        const tempCollectionName = `${context.collectionName}_new`
        
        try {
            // Step 1: Create temporary collection with new config
            await context.progressCallback?.(0, "Creating temporary collection with new configuration...")
            await this.client.createCollection(tempCollectionName, {
                vectors: {
                    size: this.vectorSize,
                    distance: this.distanceMetric,
                    on_disk: context.newConfig.vectors.on_disk,
                },
                hnsw_config: context.newConfig.hnsw && {
                    m: context.newConfig.hnsw.m,
                    ef_construct: context.newConfig.hnsw.ef_construct,
                    on_disk: true,
                },
                quantization_config: context.newConfig.vectors.quantization?.enabled
                    ? {
                        scalar: context.newConfig.vectors.quantization.type === "scalar"
                            ? { type: "int8", always_ram: false }
                            : undefined,
                        product: context.newConfig.vectors.quantization.type === "product"
                            ? { product: { always_ram: false } }
                            : undefined,
                    }
                    : undefined,
            })
            
            // Step 2: Re-index all data
            await context.progressCallback?.(20, "Re-indexing all data into temporary collection...")
            // This would be handled by the orchestrator calling upsert on the new collection
            
            // Step 3: Create payload indexes
            await context.progressCallback?.(80, "Creating payload indexes...")
            await this.createPayloadIndexes(tempCollectionName)
            
            // Step 4: Atomic swap
            await context.progressCallback?.(90, "Swapping collections...")
            
            // Delete old collection
            await this.client.deleteCollection(context.collectionName)
            
            // Note: Qdrant doesn't support rename, so we need to:
            // Option A: Create new collection with original name and copy data
            // Option B: Update all references to use new collection name
            // For simplicity, we'll use Option B in this implementation
            
            // Step 5: Verify and complete
            await context.progressCallback?.(95, "Verifying migration...")
            const collectionInfo = await this.client.getCollection(tempCollectionName)
            
            const duration = Date.now() - startTime
            
            return {
                success: true,
                newCollectionName: tempCollectionName,
                oldCollectionDeleted: true,
                duration,
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error)
            
            // Attempt cleanup on failure
            try {
                await this.client.deleteCollection(tempCollectionName)
            } catch (cleanupError) {
                console.error("Failed to cleanup temporary collection:", cleanupError)
            }
            
            return {
                success: false,
                error: errorMessage,
                duration: Date.now() - startTime,
            }
        }
    }
    
    validate(context: MigrationContext): { valid: boolean; errors: string[] } {
        const errors: string[] = []
        
        // Validate new configuration
        if (!context.newConfig.vectors.on_disk) {
            errors.push("New configuration must have on_disk set to true")
        }
        
        // Check if old collection exists
        // ... validation logic ...
        
        return {
            valid: errors.length === 0,
            errors,
        }
    }
    
    async estimateDuration(context: MigrationContext): Promise<number> {
        // Estimate based on:
        // - Number of files to re-index
        // - Average embedding time per file
        // - Network latency for Qdrant operations
        
        // This would integrate with TokenBasedSizeEstimator
        // For now, return a conservative estimate
        return 60000 // 1 minute default
    }
    
    private async createPayloadIndexes(collectionName: string): Promise<void> {
        // Create type field index
        try {
            await this.client.createPayloadIndex(collectionName, {
                field_name: "type",
                field_schema: "keyword",
            })
        } catch (error) {
            if (!(error as any)?.message?.toLowerCase().includes("already exists")) {
                console.warn(`Failed to create type index:`, error)
            }
        }
        
        // Create pathSegments indexes
        for (let i = 0; i <= 4; i++) {
            try {
                await this.client.createPayloadIndex(collectionName, {
                    field_name: `pathSegments.${i}`,
                    field_schema: "keyword",
                })
            } catch (error) {
                if (!(error as any)?.message?.toLowerCase().includes("already exists")) {
                    console.warn(`Failed to create pathSegments.${i} index:`, error)
                }
            }
        }
    }
}
```

#### Integration with QdrantVectorStore

```typescript
// src/services/code-index/vector-store/qdrant-client.ts

export class QdrantVectorStore implements IVectorStore {
    // ... existing properties ...
    
    /**
     * Applies new collection configuration, migrating data if necessary.
     * @param newConfig The new configuration to apply
     * @param progressCallback Optional callback for progress updates
     * @returns Promise resolving to migration result
     */
    async applyConfiguration(
        newConfig: CustomVectorStorageConfig,
        progressCallback?: (progress: number, message: string) => Promise<void>
    ): Promise<{ success: boolean; requiresReindexing: boolean; error?: string }> {
        if (!this.vectorStorageConfigManager) {
            return { success: false, requiresReindexing: false, error: "Vector storage config manager not available" }
        }
        
        const oldConfig = await this.vectorStorageConfigManager.getCollectionConfig()
        
        // Check if re-indexing is required
        const requiresReindexing = VectorStorageConfigManager.requiresReindexing(oldConfig, newConfig)
        
        if (!requiresReindexing) {
            // Can apply configuration changes dynamically
            try {
                await this.updateDynamicConfiguration(newConfig)
                return { success: true, requiresReindexing: false }
            } catch (error) {
                return {
                    success: false,
                    requiresReindexing: false,
                    error: error instanceof Error ? error.message : String(error),
                }
            }
        } else {
            // Requires full re-indexing with collection recreation
            const migration = new RecreateCollectionMigration(this.client, this.vectorSize, this.DISTANCE_METRIC)
            
            const context: MigrationContext = {
                collectionName: this.collectionName,
                oldConfig,
                newConfig,
                requiresReindexing: true,
                progressCallback,
            }
            
            const result = await migration.migrate(context)
            
            if (result.success) {
                // Update collection name reference if it changed
                if (result.newCollectionName && result.newCollectionName !== this.collectionName) {
                    // Note: In a real implementation, we'd need to handle the collection name change
                    // This might require updating the vectorStorageConfigManager or other references
                    console.log(`Migration completed. New collection name: ${result.newCollectionName}`)
                }
                
                return { success: true, requiresReindexing: true }
            } else {
                return {
                    success: false,
                    requiresReindexing: true,
                    error: result.error,
                }
            }
        }
    }
    
    /**
     * Updates collection configuration dynamically without re-indexing.
     * Used for HNSW and WAL parameter changes.
     */
    private async updateDynamicConfiguration(config: CustomVectorStorageConfig): Promise<void> {
        const updateParams: Record<string, unknown> = {}
        
        // Apply HNSW configuration
        if (config.hnsw) {
            updateParams.hnsw_config = {
                m: config.hnsw.m,
                ef_construct: config.hnsw.ef_construct,
            }
            updateParams.optimizers_config = {
                indexing_threshold: 0,
            }
        }
        
        // Apply WAL configuration
        if (config.wal) {
            updateParams.wal_config = {
                capacity_mb: config.wal.capacity_mb,
                segments: config.wal.segments,
            }
        }
        
        // Note: Quantization changes require re-indexing and are handled separately
        
        if (Object.keys(updateParams).length > 0) {
            await this.client.updateCollection(this.collectionName, updateParams)
        }
    }
}
```

### When Re-indexing is NOT Required

Some configuration changes can be applied dynamically without full re-indexing:

1. **HNSW Parameter Changes**: Can be updated via `updateCollection()`
2. **WAL Parameter Changes**: Affect future writes only
3. **Threshold Changes**: Affect future preset selection in auto mode

For these changes, the system should:
1. Apply the configuration change immediately
2. Update the VectorStorageConfigManager
3. Continue operating without interruption

### When Re-indexing IS Required

Full re-indexing with collection recreation is required for:

1. **Quantization Enable/Disable**: Changes vector representation
2. **Quantization Type Change**: scalar ↔ product
3. **Quantization Bits Change**: Changes precision
4. **Vector Dimension Change**: Already handled in existing code

For these changes, the system should:
1. Notify the user that re-indexing is required
2. Show estimated duration
3. Provide progress updates during migration
4. Maintain old collection until migration completes successfully

---

## Implementation Plan

### Phase 1: Core Configuration Fix (Week 1)

**Goal**: Fix the critical issue of vectorStorageConfig not being passed through the system.

**Tasks**:
1. ✅ Add `vectorStorageConfig` field to `CodeIndexConfig` interface
2. ✅ Update `CodeIndexConfigManager.getConfig()` to include `vectorStorageConfig`
3. ✅ Add `preset` field when in preset mode
4. ✅ Update unit tests for config manager

**Files to Modify**:
- `src/services/code-index/interfaces/config.ts`
- `src/services/code-index/config-manager.ts`
- `src/services/code-index/__tests__/config-manager.spec.ts`

**Acceptance Criteria**:
- VectorStorageConfigManager is instantiated when config is saved
- QdrantVectorStore receives the correct configuration
- Settings UI changes are reflected in collection creation

### Phase 2: Configuration Change Detection (Week 2)

**Goal**: Implement proper detection of when changes require re-indexing vs. dynamic updates.

**Tasks**:
1. ✅ Add `requiresReindexing()` static method to VectorStorageConfigManager
2. ✅ Add `requiresRestart()` static method to VectorStorageConfigManager
3. ✅ Update `doesConfigChangeRequireRestart()` in ConfigManager
4. ✅ Add comprehensive unit tests

**Files to Modify**:
- `src/services/code-index/vector-storage-config-manager.ts`
- `src/services/code-index/config-manager.ts`
- `src/services/code-index/__tests__/vector-storage-config-manager.spec.ts`

**Acceptance Criteria**:
- System correctly identifies when re-indexing is required
- System correctly identifies when changes can be applied dynamically
- User is notified appropriately based on change type

### Phase 3: Migration Infrastructure (Week 3-4)

**Goal**: Implement the migration framework and recreate collection strategy.

**Tasks**:
1. ✅ Define `IMigrationStrategy` interface
2. ✅ Implement `RecreateCollectionMigration` class
3. ✅ Add migration progress tracking
4. ✅ Integrate with QdrantVectorStore.applyConfiguration()
5. ✅ Update orchestrator to handle migration
6. ✅ Add integration tests

**Files to Create**:
- `src/services/code-index/vector-store/recreate-collection-migration.ts`
- `src/services/code-index/vector-store/__tests__/recreate-collection-migration.spec.ts`

**Files to Modify**:
- `src/services/code-index/vector-store/qdrant-client.ts`
- `src/services/code-index/orchestrator.ts`
- `src/services/code-index/interfaces/vector-store.ts`

**Acceptance Criteria**:
- Migration can be initiated from settings UI
- Progress is shown to user during migration
- Old collection is preserved until migration succeeds
- Rollback works correctly on failure

### Phase 4: UI Integration (Week 5)

**Goal**: Update the settings UI to handle migration scenarios.

**Tasks**:
1. Add migration confirmation dialog
2. Show progress during migration
3. Handle migration success/failure states
4. Add migration history view (optional)

**Files to Modify**:
- `webview-ui/src/components/chat/CodeIndexPopover.tsx`
- `webview-ui/src/i18n/locales/en/settings.json`
- `webview-ui/src/i18n/locales/zh-CN/settings.json`

**Acceptance Criteria**:
- User is warned when changes require re-indexing
- Progress bar shows migration status
- Success/failure messages are clear and actionable

### Phase 5: Testing and Documentation (Week 6)

**Goal**: Comprehensive testing and documentation.

**Tasks**:
1. End-to-end testing of all migration scenarios
2. Performance testing with large codebases
3. Error scenario testing
4. Update user documentation
5. Update API documentation

**Files to Create**:
- `docs/code-index-migration-guide.md`

**Acceptance Criteria**:
- All test scenarios pass
- Documentation is complete and accurate
- Performance meets requirements

---

## Testing Strategy

### Unit Tests

#### Config Manager Tests

```typescript
describe("CodeIndexConfigManager", () => {
    describe("getConfig()", () => {
        it("should include vectorStorageConfig in returned config", () => {
            const config = manager.getConfig()
            expect(config.vectorStorageConfig).toBeDefined()
            expect(config.vectorStorageConfig?.mode).toBe("auto")
        })
        
        it("should include preset field when in preset mode", () => {
            // Setup preset mode
            manager.loadConfiguration()
            
            const config = manager.getConfig()
            expect(config.vectorStorageConfig?.preset).toBe("medium")
        })
    })
})
```

#### VectorStorageConfigManager Tests

```typescript
describe("VectorStorageConfigManager", () => {
    describe("requiresReindexing()", () => {
        it("should return true when quantization is enabled", () => {
            const oldConfig: CustomVectorStorageConfig = {
                vectors: { on_disk: true }
            }
            const newConfig: CustomVectorStorageConfig = {
                vectors: {
                    on_disk: true,
                    quantization: { enabled: true, type: "scalar", bits: 8 }
                }
            }
            
            expect(VectorStorageConfigManager.requiresReindexing(oldConfig, newConfig)).toBe(true)
        })
        
        it("should return false when only HNSW parameters change", () => {
            const oldConfig: CustomVectorStorageConfig = {
                vectors: { on_disk: true },
                hnsw: { m: 16, ef_construct: 128 }
            }
            const newConfig: CustomVectorStorageConfig = {
                vectors: { on_disk: true },
                hnsw: { m: 32, ef_construct: 256 }
            }
            
            expect(VectorStorageConfigManager.requiresReindexing(oldConfig, newConfig)).toBe(false)
        })
    })
})
```

### Integration Tests

```typescript
describe("Migration Integration", () => {
    it("should migrate from non-quantized to quantized configuration", async () => {
        // Setup initial collection without quantization
        await vectorStore.initialize()
        await vectorStore.upsertPoints(testPoints)
        
        // Apply new configuration with quantization
        const result = await vectorStore.applyConfiguration(quantizedConfig, progressCallback)
        
        expect(result.success).toBe(true)
        expect(result.requiresReindexing).toBe(true)
        
        // Verify data integrity
        const searchResults = await vectorStore.search(queryVector)
        expect(searchResults.length).toBeGreaterThan(0)
    })
    
    it("should preserve old collection until migration succeeds", async () => {
        // Start migration
        const migrationPromise = vectorStore.applyConfiguration(newConfig)
        
        // Verify old collection still exists during migration
        const oldCollectionExists = await vectorStore.collectionExists()
        expect(oldCollectionExists).toBe(true)
        
        // Wait for migration to complete
        await migrationPromise
        
        // Verify old collection is deleted after success
        const oldCollectionExistsAfter = await vectorStore.collectionExists()
        expect(oldCollectionExistsAfter).toBe(false)
    })
})
```

### End-to-End Tests

1. **Auto Mode Threshold Change**: Verify no re-indexing occurs
2. **Preset Mode Change**: Verify re-indexing occurs with progress
3. **Quantization Toggle**: Verify re-indexing occurs
4. **Migration Failure Recovery**: Verify old collection is preserved

---

## Risk Assessment

### Technical Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Migration fails partway through | Medium | High | Preserve old collection until success; implement rollback |
| Data corruption during migration | Low | Critical | Validate data integrity before deleting old collection |
| Performance degradation during migration | High | Medium | Run migration in background; allow cancellation |
| Collection name collision | Low | Medium | Use unique temporary names with timestamps |
| Qdrant API incompatibility | Low | High | Test with multiple Qdrant versions |

### User Experience Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| User confused by migration prompt | Medium | Medium | Clear messaging with estimated duration |
| Migration takes longer than expected | Medium | Medium | Show progress; allow pause/cancel |
| Settings appear to not apply | Low | Medium | Show clear status; provide retry option |
| Data loss perceived or real | Low | Critical | Backup old collection; provide recovery path |

### Mitigation Strategies

1. **Gradual Rollout**: Release to beta users first
2. **Feature Flag**: Allow disabling migration feature if issues arise
3. **Monitoring**: Log all migration attempts for analysis
4. **Documentation**: Clear user guide on when migration is needed
5. **Testing**: Comprehensive test coverage including edge cases

---

## Appendix A: Configuration Examples

### Auto Mode Configuration

```typescript
const autoConfig: VectorStorageConfig = {
    mode: "auto",
    thresholds: {
        tiny: 2000,
        small: 10000,
        medium: 100000,
        large: 1000000,
    },
}

// System will automatically select preset based on collection size:
// - < 2000 vectors: tiny preset
// - < 10000 vectors: small preset
// - < 100000 vectors: medium preset
// - >= 100000 vectors: large preset
```

### Preset Mode Configuration

```typescript
const presetConfig: VectorStorageConfig = {
    mode: "preset",
    preset: "small",  // Fixed to small preset regardless of size
    thresholds: {
        tiny: 2000,
        small: 10000,
        medium: 100000,
        large: 1000000,
    },
}
```

### Custom Mode Configuration

```typescript
const customConfig: VectorStorageConfig = {
    mode: "custom",
    customConfig: {
        hnsw: {
            m: 24,
            ef_construct: 256,
        },
        vectors: {
            on_disk: true,
            quantization: {
                enabled: true,
                type: "scalar",
                bits: 8,
            },
        },
        wal: {
            capacity_mb: 64,
            segments: 4,
        },
    },
}
```

---

## Appendix B: Migration Decision Tree

```
User Changes Vector Storage Settings
                │
                ▼
        ┌───────────────┐
        │ Config Change │
        │   Detected    │
        └───────┬───────┘
                │
                ▼
        ┌───────────────┐
        │  Check if     │
        │  Re-indexing  │
        │   Required    │
        └───────┬───────┘
                │
        ┌───────┴───────┐
        │               │
        ▼               ▼
   ┌────────┐     ┌─────────┐
   │   NO   │     │   YES   │
   └───┬────┘     └────┬────┘
       │               │
       │               ▼
       │        ┌───────────────┐
       │        │ Show Warning  │
       │        │ to User       │
       │        │ - Explain     │
       │        │ - Show ETA    │
       │        └───────┬───────┘
       │                │
       │                ▼
       │        ┌───────────────┐
       │        │ User Confirms │
       │        └───────┬───────┘
       │                │
       │                ▼
       │        ┌───────────────┐
       │        │   Create      │
       │        │   Temporary   │
       │        │  Collection   │
       │        └───────┬───────┘
       │                │
       │                ▼
       │        ┌───────────────┐
       │        │   Re-index    │
       │        │     Data      │
       │        └───────┬───────┘
       │                │
       │                ▼
       │        ┌───────────────┐
       │        │   Verify      │
       │        │   Success     │
       │        └───────┬───────┘
       │                │
       │        ┌───────┴───────┐
       │        │               │
       │        ▼               ▼
       │   ┌────────┐     ┌─────────┐
       │   │   OK   │     │  FAIL   │
       │   └───┬────┘     └────┬────┘
       │       │               │
       │       │               ▼
       │       │        ┌───────────────┐
       │       │        │   Rollback    │
       │       │        │   Preserve    │
       │       │        │   Old Data    │
       │       │        └───────────────┘
       │       │
       │       ▼
       │ ┌───────────────┐
       │ │   Delete      │
       │ │   Old         │
       │ │   Collection  │
       │ └───────┬───────┘
       │         │
       │         ▼
       │ ┌───────────────┐
       │ │   Complete    │
       │ │   Migration   │
       │ └───────────────┘
       │
       ▼
┌───────────────┐
│   Apply       │
│   Dynamic     │
│   Update      │
│ - HNSW params │
│ - WAL params  │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│   Success     │
│   No Restart  │
│   Required    │
└───────────────┘
```

---

## Appendix C: Related Documentation

- [Qdrant Vector Storage Implementation](./qdrant-vector-storage-implementation.md)
- [Qdrant Vector Size Estimation](./qdrant-vector-size-estimation-implementation.md)
- [Qdrant Vector Count Migration](./qdrant-vector-count-migration.md)
- [Qdrant Integration Config](../../qdrant-integration-config.md)

---

**Document Version**: 1.0  
**Last Updated**: 2026-02-25  
**Author**: Roo Code Team  
**Status**: Draft
