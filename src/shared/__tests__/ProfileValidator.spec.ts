// npx vitest run src/shared/__tests__/ProfileValidator.spec.ts

import type { ProviderSettings } from "@coder/types"

import { ProfileValidator } from "../ProfileValidator"

describe("ProfileValidator", () => {
	describe("isProfileAllowed", () => {
		it("should allow any profile", () => {
			const profile: ProviderSettings = {
				apiProvider: "openai",
				openAiModelId: "gpt-4",
			}

			expect(ProfileValidator.isProfileAllowed(profile)).toBe(true)
		})

		it("should allow profiles without an apiProvider", () => {
			const profile: Partial<ProviderSettings> = {}

			expect(ProfileValidator.isProfileAllowed(profile as ProviderSettings)).toBe(true)
		})

		it("should allow openai provider", () => {
			const profile: ProviderSettings = {
				apiProvider: "openai",
				openAiModelId: "gpt-4",
			}

			expect(ProfileValidator.isProfileAllowed(profile)).toBe(true)
		})

		it("should allow anthropic provider", () => {
			const profile: ProviderSettings = {
				apiProvider: "anthropic",
				apiModelId: "claude-3-opus",
			}

			expect(ProfileValidator.isProfileAllowed(profile)).toBe(true)
		})

		it("should allow gemini provider", () => {
			const profile: ProviderSettings = {
				apiProvider: "gemini",
				apiModelId: "gemini-pro",
			}

			expect(ProfileValidator.isProfileAllowed(profile)).toBe(true)
		})

		it("should allow openai-native provider", () => {
			const profile: ProviderSettings = {
				apiProvider: "openai-native",
				apiModelId: "gpt-4",
			}

			expect(ProfileValidator.isProfileAllowed(profile)).toBe(true)
		})
	})
})