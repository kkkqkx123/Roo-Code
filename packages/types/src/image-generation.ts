/**
 * Image generation configuration types
 *
 * This module provides flexible configuration for image generation APIs,
 * similar to the LLM API configuration system.
 */

import { z } from "zod"

/**
 * API method used for image generation
 */
export type ImageGenerationApiMethod = "chat_completions" | "images_api"

/**
 * Image generation provider type
 * Supports multiple providers for flexibility
 */
export type ImageGenerationProvider = "openai" | "anthropic" | "custom"

/**
 * Image generation model configuration
 */
export interface ImageGenerationModel {
	value: string
	label: string
	provider: ImageGenerationProvider
	apiMethod?: ImageGenerationApiMethod
	description?: string
}

/**
 * Default image generation models for reference
 * These can be used as examples or starting points
 */
export const DEFAULT_IMAGE_GENERATION_MODELS: ImageGenerationModel[] = [
	// OpenAI models
	{
		value: "dall-e-3",
		label: "DALL-E 3",
		provider: "openai",
		apiMethod: "images_api",
		description: "OpenAI's latest image generation model"
	},
	{
		value: "dall-e-2",
		label: "DALL-E 2",
		provider: "openai",
		apiMethod: "images_api",
		description: "OpenAI's previous generation model"
	},
	// Anthropic models (via chat completions)
	{
		value: "claude-3-5-sonnet-20241022",
		label: "Claude 3.5 Sonnet",
		provider: "anthropic",
		apiMethod: "chat_completions",
		description: "Anthropic's Claude with image generation capabilities"
	},
]

/**
 * Image generation configuration
 * Similar to ProviderSettings for LLM APIs
 */
export interface ImageGenerationConfig {
	/** Unique identifier for this configuration */
	id?: string
	/** Display name for this configuration */
	name: string
	/** Provider type */
	provider: ImageGenerationProvider
	/** Model ID to use */
	modelId: string
	/** API key (stored separately in secret storage) */
	apiKey?: string
	/** Base URL for API requests */
	baseUrl?: string
	/** API method to use */
	apiMethod?: ImageGenerationApiMethod
	/** Custom headers for API requests */
	headers?: Record<string, string>
	/** Additional provider-specific settings */
	settings?: Record<string, unknown>
}

/**
 * Image generation configuration entry (for listing configs)
 */
export interface ImageGenerationConfigEntry {
	id: string
	name: string
	provider: ImageGenerationProvider
	modelId?: string
}

/**
 * Get the default image generation provider
 */
export function getDefaultImageGenerationProvider(): ImageGenerationProvider {
	return "openai"
}

/**
 * Get the default API method for a provider
 */
export function getDefaultApiMethod(provider: ImageGenerationProvider): ImageGenerationApiMethod {
	switch (provider) {
		case "openai":
			return "images_api"
		case "anthropic":
		case "custom":
		default:
			return "chat_completions"
	}
}

/**
 * Get the default base URL for a provider
 */
export function getDefaultBaseUrl(provider: ImageGenerationProvider): string | undefined {
	switch (provider) {
		case "openai":
			return "https://api.openai.com/v1"
		case "anthropic":
			return "https://api.anthropic.com/v1"
		case "custom":
		default:
			return undefined
	}
}

/**
 * Validate image generation configuration
 */
export function validateImageGenerationConfig(config: ImageGenerationConfig): boolean {
	if (!config.name || !config.provider || !config.modelId) {
		return false
	}

	// Validate provider-specific requirements
	switch (config.provider) {
		case "openai":
		case "anthropic":
			// These providers require API key
			return true // API key validation happens in secret storage
		case "custom":
			// Custom provider requires base URL
			return !!config.baseUrl
		default:
			return false
	}
}

/**
 * Image generation config schema
 */
export const imageGenerationConfigSchema = z.object({
	id: z.string().optional(),
	name: z.string(),
	provider: z.enum(["openai", "anthropic", "custom"]),
	modelId: z.string(),
	apiKey: z.string().optional(),
	baseUrl: z.string().optional(),
	apiMethod: z.enum(["chat_completions", "images_api"]).optional(),
	headers: z.record(z.string()).optional(),
	settings: z.record(z.unknown()).optional(),
})
