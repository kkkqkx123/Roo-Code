/**
 * Provider Settings Module
 *
 * This module provides types, schemas, and utilities for provider configuration.
 *
 * Structure:
 * - constants.ts: Constant values
 * - types.ts: Type definitions (ProviderName, CustomProvider, etc.)
 * - schemas.ts: Zod schemas for validation
 * - model-id.ts: Model ID related utilities
 * - protocol.ts: API protocol utilities
 * - metadata.ts: Provider metadata
 */

// Constants
export { DEFAULT_CONSECUTIVE_MISTAKE_LIMIT } from "./constants.js"

// Types
export {
	customProviders,
	isCustomProvider,
	providerNames,
	providerNamesSchema,
	isProviderName,
	isTypicalProvider,
} from "./types.js"

export type {
	CustomProvider,
	ProviderName,
	TypicalProvider,
} from "./types.js"

// Schemas
export {
	providerSettingsEntrySchema,
	providerSettingsSchema,
	providerSettingsWithIdSchema,
	discriminatedProviderSettingsWithIdSchema,
	PROVIDER_SETTINGS_KEYS,
} from "./schemas.js"

export type {
	ProviderSettingsEntry,
	ProviderSettings,
	ProviderSettingsWithId,
} from "./schemas.js"

// Model ID
export { modelIdKeys, getModelId, modelIdKeysByProvider } from "./model-id.js"
export type { ModelIdKey } from "./model-id.js"

// Protocol
export { ANTHROPIC_STYLE_PROVIDERS, getApiProtocol } from "./protocol.js"

// Metadata
export { MODELS_BY_PROVIDER } from "./metadata.js"
