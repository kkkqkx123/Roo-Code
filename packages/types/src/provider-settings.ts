import { z } from "zod"

import { modelInfoSchema, reasoningEffortSettingSchema, verbosityLevelsSchema, serviceTierSchema } from "./model.js"
import { codebaseIndexProviderSchema } from "./codebase-index.js"

/**
 * constants
 */

export const DEFAULT_CONSECUTIVE_MISTAKE_LIMIT = 3

/**
 * CustomProvider
 *
 * Custom providers are completely configurable within Coder settings.
 */

export const customProviders = ["openai"] as const

export type CustomProvider = (typeof customProviders)[number]

export const isCustomProvider = (key: string): key is CustomProvider => customProviders.includes(key as CustomProvider)

/**
 * ProviderName
 */

export const providerNames = [
	...customProviders,
	"anthropic",
	"gemini",
	"openai-native",
] as const

export const providerNamesSchema = z.enum(providerNames)

export type ProviderName = (typeof providerNames)[number]

export const isProviderName = (key: unknown): key is ProviderName =>
	typeof key === "string" && providerNames.includes(key as ProviderName)

/**
 * ProviderSettingsEntry
 */

export const providerSettingsEntrySchema = z.object({
	id: z.string(),
	name: z.string(),
	apiProvider: providerNamesSchema.optional(),
	modelId: z.string().optional(),
})

export type ProviderSettingsEntry = z.infer<typeof providerSettingsEntrySchema>

/**
 * ProviderSettings
 *
 * Dual Schema Design Pattern:
 *
 * This module uses two complementary schemas to serve different use cases:
 *
 * 1. providerSettingsSchema (Permissive Mode):
 *    - Contains all fields from all providers
 *    - Used for VSCode settings and global configuration
 *    - Allows fields to coexist, enabling seamless provider switching
 *    - Example: User can have both anthropic and openai settings in their config
 *
 * 2. providerSettingsSchemaDiscriminated (Strict Mode):
 *    - Discriminated union based on apiProvider field
 *    - Used for runtime validation and filtering in ProviderSettingsManager
 *    - Ensures each config only contains properties for its specific provider
 *    - Prevents property leakage between providers
 *
 * Why this design?
 * - VSCode settings need to persist all provider configurations for easy switching
 * - ProviderProfiles need strict validation to avoid storing irrelevant properties
 * - The discriminated union provides type-safe filtering at runtime
 */

const baseProviderSettingsSchema = z.object({
	includeMaxTokens: z.boolean().optional(),
	todoListEnabled: z.boolean().optional(),
	modelTemperature: z.number().nullish(),
	rateLimitSeconds: z.number().optional(),
	consecutiveMistakeLimit: z.number().min(0).optional(),

	// Model reasoning.
	enableReasoningEffort: z.boolean().optional(),
	reasoningEffort: reasoningEffortSettingSchema.optional(),
	modelMaxTokens: z.number().optional(),
	modelMaxThinkingTokens: z.number().optional(),

	// Model verbosity.
	verbosity: verbosityLevelsSchema.optional(),
})

const anthropicSchema = baseProviderSettingsSchema.extend({
	apiModelId: z.string().optional(),
	apiKey: z.string().optional(),
	anthropicBaseUrl: z.string().optional(),
	anthropicUseAuthToken: z.boolean().optional(),
	anthropicBeta1MContext: z.boolean().optional(), // Enable 'context-1m-2025-08-07' beta for 1M context window.
})

const openAiSchema = baseProviderSettingsSchema.extend({
	openAiBaseUrl: z.string().optional(),
	openAiApiKey: z.string().optional(),
	openAiR1FormatEnabled: z.boolean().optional(),
	openAiModelId: z.string().optional(),
	openAiCustomModelInfo: modelInfoSchema.nullish(),
	openAiStreamingEnabled: z.boolean().optional(),
	openAiHostHeader: z.string().optional(), // Keep temporarily for backward compatibility during migration.
	openAiHeaders: z.record(z.string(), z.string()).optional(),
})

const geminiSchema = baseProviderSettingsSchema.extend({
	apiModelId: z.string().optional(),
	geminiApiKey: z.string().optional(),
	googleGeminiBaseUrl: z.string().optional(),
	vertexProjectId: z.string().optional(),
	vertexRegion: z.string().optional(),
	vertexJsonCredentials: z.string().optional(),
	vertexKeyFile: z.string().optional(),
})

const openAiNativeSchema = baseProviderSettingsSchema.extend({
	apiModelId: z.string().optional(),
	openAiNativeApiKey: z.string().optional(),
	openAiNativeBaseUrl: z.string().optional(),
	// OpenAI Responses API service tier for openai-native provider only.
	// UI should only expose this when the selected model supports flex/priority.
	openAiNativeServiceTier: serviceTierSchema.optional(),
})

/**
 * Discriminated union for type-safe provider-specific settings validation.
 *
 * This strict schema ensures that when saving/loading provider configs,
 * only properties relevant to the specified apiProvider are included.
 *
 * Usage:
 * - ProviderSettingsManager uses this to filter out properties from other providers
 * - Prevents property leakage when switching between providers
 * - Provides runtime type safety for provider-specific configurations
 *
 * Example:
 * Input: { apiProvider: "anthropic", apiModelId: "claude-3", openAiBaseUrl: "..." }
 * Output: { apiProvider: "anthropic", apiModelId: "claude-3" } // openAiBaseUrl filtered out
 */
const defaultSchema = z.object({
	apiProvider: z.undefined(),
})

const providerSettingsSchemaDiscriminated = z.discriminatedUnion("apiProvider", [
	anthropicSchema.merge(z.object({ apiProvider: z.literal("anthropic") })),
	openAiSchema.merge(z.object({ apiProvider: z.literal("openai") })),
	geminiSchema.merge(z.object({ apiProvider: z.literal("gemini") })),
	openAiNativeSchema.merge(z.object({ apiProvider: z.literal("openai-native") })),
	defaultSchema,
])

/**
 * Permissive schema containing all provider fields.
 *
 * This schema allows all provider-specific fields to coexist, which is necessary for:
 * - VSCode settings that persist configurations for multiple providers
 * - Global settings that may contain fields from different providers
 * - Seamless provider switching without losing configuration
 *
 * Note: This is intentionally permissive. For strict validation, use
 * providerSettingsSchemaDiscriminated instead.
 */
export const providerSettingsSchema = z.object({
	apiProvider: providerNamesSchema.optional(),
	...anthropicSchema.shape,
	...openAiSchema.shape,
	...geminiSchema.shape,
	...openAiNativeSchema.shape,
	...codebaseIndexProviderSchema.shape,
})

export type ProviderSettings = z.infer<typeof providerSettingsSchema>

export const providerSettingsWithIdSchema = providerSettingsSchema.extend({ id: z.string().optional() })

/**
 * Discriminated version with id for filtering provider-specific properties.
 *
 * Combines the strict discriminated union with an optional id field.
 * Used in ProviderSettingsManager to validate and filter configs with ids.
 */
export const discriminatedProviderSettingsWithIdSchema = providerSettingsSchemaDiscriminated.and(
	z.object({ id: z.string().optional() }),
)

export type ProviderSettingsWithId = z.infer<typeof providerSettingsWithIdSchema>

export const PROVIDER_SETTINGS_KEYS = providerSettingsSchema.keyof().options

/**
 * ModelIdKey
 */

export const modelIdKeys = [
	"apiModelId",
	"openAiModelId",
] as const satisfies readonly (keyof ProviderSettings)[]

export type ModelIdKey = (typeof modelIdKeys)[number]

export const getModelId = (settings: ProviderSettings): string | undefined => {
	const modelIdKey = modelIdKeys.find((key) => settings[key])
	return modelIdKey ? settings[modelIdKey] : undefined
}

/**
 * TypicalProvider
 */

export type TypicalProvider = Exclude<ProviderName, CustomProvider>

export const isTypicalProvider = (key: unknown): key is TypicalProvider =>
	isProviderName(key) && !isCustomProvider(key)

export const modelIdKeysByProvider: Record<TypicalProvider, ModelIdKey> = {
	anthropic: "apiModelId",
	"openai-native": "openAiModelId",
	gemini: "apiModelId",
}

/**
 * ANTHROPIC_STYLE_PROVIDERS
 */

// Providers that use Anthropic-style API protocol.
export const ANTHROPIC_STYLE_PROVIDERS: ProviderName[] = ["anthropic"]

export const getApiProtocol = (
	provider: ProviderName | undefined,
	_modelId?: string,
): "anthropic" | "openai" => {
	if (provider && ANTHROPIC_STYLE_PROVIDERS.includes(provider)) {
		return "anthropic"
	}

	return "openai"
}

/**
 * MODELS_BY_PROVIDER
 *
 * Removed hardcoded model lists. All providers now support custom model configuration
 * just like OpenAI Compatible endpoints. Users must provide model ID and optionally
 * model info through their configuration.
 */

export const MODELS_BY_PROVIDER: Record<ProviderName, { id: ProviderName; label: string; models: string[] }> = {
	anthropic: {
		id: "anthropic",
		label: "Anthropic",
		models: [], // No hardcoded models - users provide custom model IDs
	},
	gemini: {
		id: "gemini",
		label: "Google Gemini",
		models: [], // No hardcoded models - users provide custom model IDs
	},
	"openai-native": {
		id: "openai-native",
		label: "OpenAI",
		models: [], // No hardcoded models - users provide custom model IDs
	},
	openai: {
		id: "openai",
		label: "OpenAI Compatible",
		models: [],
	},
}
