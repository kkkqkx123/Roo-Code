/**
 * Defines profiles for different embedding models, including their dimensions.
 * All model profiles are now user-defined - no hardcoded defaults.
 */

import type { EmbedderProvider, EmbeddingModelProfiles } from "./embedding.js"

/**
 * Retrieves the embedding dimension for a given provider and model ID from user-defined profiles.
 * @param profiles The user-defined embedding model profiles
 * @param provider The embedder provider (e.g., "openai").
 * @param modelId The specific model ID (e.g., "text-embedding-3-small").
 * @returns The dimension size or undefined if the model is not found.
 */
export function getModelDimension(
	profiles: EmbeddingModelProfiles,
	provider: EmbedderProvider,
	modelId: string,
): number | undefined {
	const providerProfiles = profiles[provider]
	if (!providerProfiles) {
		return undefined
	}

	const modelProfile = providerProfiles[modelId]
	return modelProfile?.dimension
}

/**
 * Retrieves the score threshold for a given provider and model ID from user-defined profiles.
 * @param profiles The user-defined embedding model profiles
 * @param provider The embedder provider (e.g., "openai").
 * @param modelId The specific model ID (e.g., "text-embedding-3-small").
 * @returns The score threshold or undefined if the model is not found.
 */
export function getModelScoreThreshold(
	profiles: EmbeddingModelProfiles,
	provider: EmbedderProvider,
	modelId: string,
): number | undefined {
	const providerProfiles = profiles[provider]
	if (!providerProfiles) {
		return undefined
	}

	const modelProfile = providerProfiles[modelId]
	return modelProfile?.scoreThreshold
}

/**
 * Retrieves the query prefix for a given provider and model ID from user-defined profiles.
 * @param profiles The user-defined embedding model profiles
 * @param provider The embedder provider (e.g., "openai").
 * @param modelId The specific model ID (e.g., "nomic-embed-code").
 * @returns The query prefix or undefined if the model doesn't require one.
 */
export function getModelQueryPrefix(
	profiles: EmbeddingModelProfiles,
	provider: EmbedderProvider,
	modelId: string,
): string | undefined {
	const providerProfiles = profiles[provider]
	if (!providerProfiles) {
		return undefined
	}

	const modelProfile = providerProfiles[modelId]
	return modelProfile?.queryPrefix
}

/**
 * Gets the default *specific* embedding model ID based on the provider from user-defined profiles.
 * Returns the first model ID defined for the provider, or undefined if no models are defined.
 * @param profiles The user-defined embedding model profiles
 * @param provider The embedder provider.
 * @returns The default specific model ID for the provider, or undefined if no models are defined.
 */
export function getDefaultModelId(profiles: EmbeddingModelProfiles, provider: EmbedderProvider): string | undefined {
	const providerProfiles = profiles[provider]
	if (!providerProfiles) {
		return undefined
	}

	const modelIds = Object.keys(providerProfiles)
	return modelIds.length > 0 ? modelIds[0] : undefined
}
