import { ProviderName } from "./types.js"

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
