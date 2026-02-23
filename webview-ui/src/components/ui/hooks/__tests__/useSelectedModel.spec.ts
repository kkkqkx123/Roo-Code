// npx vitest src/components/ui/hooks/__tests__/useSelectedModel.spec.ts

import React from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { renderHook } from "@testing-library/react"

import {
	ProviderSettings,
} from "@coder/types"

import { useSelectedModel } from "../useSelectedModel"

const createWrapper = () => {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	})
	return ({ children }: { children: React.ReactNode }) =>
		React.createElement(QueryClientProvider, { client: queryClient }, children)
}

describe("useSelectedModel", () => {
	describe("default behavior", () => {
		it("should return anthropic default when no configuration is provided", () => {
			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(), { wrapper })

			expect(result.current.provider).toBe("anthropic")
			expect(result.current.id).toBe("claude-sonnet-4-5")
			expect(result.current.info).toBeUndefined()
		})
	})

	describe("anthropic provider with 1M context", () => {

		it("should apply 1M pricing tier for Claude Sonnet 4.6 when enabled", () => {
			const apiConfiguration: ProviderSettings = {
				apiProvider: "anthropic",
				apiModelId: "claude-sonnet-4-6",
				anthropicBeta1MContext: true,
			}

			const wrapper = createWrapper()
			const { result } = renderHook(() => useSelectedModel(apiConfiguration), { wrapper })

			expect(result.current.id).toBe("claude-sonnet-4-6")
			expect(result.current.info?.contextWindow).toBe(1_000_000)
			expect(result.current.info?.inputPrice).toBe(6.0)
			expect(result.current.info?.outputPrice).toBe(22.5)
		})
	})
})
