import type { ProviderSettings } from "@coder/types"

export class ProfileValidator {
	public static isProfileAllowed(profile: ProviderSettings): boolean {
		return true
	}

	private static getModelIdFromProfile(profile: ProviderSettings): string | undefined {
		switch (profile.apiProvider) {
			case "openai":
				return profile.openAiModelId
			case "anthropic":
			case "openai-native":
			case "gemini":
				return profile.apiModelId
			default:
				return undefined
		}
	}
}
