import type { TokenUsage, ToolUsage, ToolName, ClineMessage } from "@coder/types"

export type ParsedApiReqStartedTextType = {
	tokensIn: number
	tokensOut: number
	cacheWrites: number
	cacheReads: number
	cost?: number // Only present if consolidateApiRequests has been called
	apiProtocol?: "anthropic" | "openai"
}

/**
 * Consolidates token usage metrics from an array of ClineMessages.
 *
 * This function processes 'condense_context' messages and 'api_req_started' messages that have been
 * consolidated with their corresponding 'api_req_finished' messages by the consolidateApiRequests function.
 * It extracts and sums up the tokensIn, tokensOut, cacheWrites, cacheReads, and cost from these messages.
 *
 * @param messages - An array of ClineMessage objects to process.
 * @returns A TokenUsage object containing totalTokensIn, totalTokensOut, totalCacheWrites, totalCacheReads, totalCost, and contextTokens.
 *
 * @example
 * const messages = [
 *   { type: "say", say: "api_req_started", text: '{"request":"GET /api/data","tokensIn":10,"tokensOut":20,"cost":0.005}', ts: 1000 }
 * ];
 * const { totalTokensIn, totalTokensOut, totalCost } = consolidateTokenUsage(messages);
 * // Result: { totalTokensIn: 10, totalTokensOut: 20, totalCost: 0.005 }
 */
export function consolidateTokenUsage(messages: ClineMessage[]): TokenUsage {
	const result: TokenUsage = {
		totalTokensIn: 0,
		totalTokensOut: 0,
		totalCacheWrites: undefined,
		totalCacheReads: undefined,
		totalCost: 0,
		contextTokens: 0,
	}

	// Calculate running totals.
	// Skip placeholder messages for token counts (where both tokensIn and tokensOut are 0 or undefined)
	// These are created when API request starts but haven't received token data yet.
	// However, we still accumulate cost even from placeholder messages.
	messages.forEach((message) => {
		if (message.type === "say" && message.say === "api_req_started" && message.text) {
			try {
				const parsedText: ParsedApiReqStartedTextType = JSON.parse(message.text)
				const { tokensIn, tokensOut, cacheWrites, cacheReads, cost } = parsedText

				// Check if this message has real token data
				// A placeholder is identified by having no tokens (both in and out are 0 or undefined)
				const hasRealTokenData = (tokensIn ?? 0) > 0 || (tokensOut ?? 0) > 0

				// Only accumulate tokens if we have real data
				if (hasRealTokenData) {
					if (typeof tokensIn === "number") {
						result.totalTokensIn += tokensIn
					}

					if (typeof tokensOut === "number") {
						result.totalTokensOut += tokensOut
					}

					if (typeof cacheWrites === "number") {
						result.totalCacheWrites = (result.totalCacheWrites ?? 0) + cacheWrites
					}

					if (typeof cacheReads === "number") {
						result.totalCacheReads = (result.totalCacheReads ?? 0) + cacheReads
					}
				}

				// Always accumulate cost (even from placeholder messages)
				if (typeof cost === "number") {
					result.totalCost += cost
				}
			} catch (error) {
				console.error("Error parsing JSON:", error)
			}
		} else if (message.type === "say" && message.say === "condense_context") {
			result.totalCost += message.contextCondense?.cost ?? 0
		}
	})

	// Calculate context tokens.
	// The context tokens represent the total tokens used in the current context window.
	// Priority order:
	// 1. condense_context messages: Contains authoritative token count after context compression
	// 2. api_req_started messages: Use the LAST request's tokensIn + tokensOut
	//    (tokensIn already includes all input tokens: system prompt + conversation history + current message)
	//    DO NOT accumulate all requests - that would cause double counting since tokensIn
	//    already contains the full context history for each request.
	result.contextTokens = 0

	// First, check for condense_context message which has authoritative token count
	let lastCondenseTokens = 0
	let lastCondenseIndex = -1
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i]
		if (!message) continue

		if (message.type === "say" && message.say === "condense_context") {
			const condenseTokens = message.contextCondense?.newContextTokens ?? 0
			if (condenseTokens > 0) {
				lastCondenseTokens = condenseTokens
				lastCondenseIndex = i
				break
			}
		}
	}

	// If we have a condense message, use its token count as the base
	// and add tokens from api_req_started messages AFTER the condense
	if (lastCondenseTokens > 0) {
		result.contextTokens = lastCondenseTokens
		// Find the last api_req_started after the condense and add its output tokens
		// (input tokens are already included in condense count)
		for (let i = messages.length - 1; i > lastCondenseIndex; i--) {
			const message = messages[i]
			if (message && message.type === "say" && message.say === "api_req_started" && message.text) {
				try {
					const parsedText: ParsedApiReqStartedTextType = JSON.parse(message.text)
					// Only add output tokens since input is already in condense
					result.contextTokens += parsedText.tokensOut || 0
				} catch {
					// Ignore JSON parse errors
				}
			}
		}
	} else {
		// No condense message: use the LAST api_req_started message's tokens
		// tokensIn already contains the full context, so we don't need to accumulate
		// Skip placeholder messages (where both tokensIn and tokensOut are 0)
		for (let i = messages.length - 1; i >= 0; i--) {
			const message = messages[i]
			if (message && message.type === "say" && message.say === "api_req_started" && message.text) {
				try {
					const parsedText: ParsedApiReqStartedTextType = JSON.parse(message.text)
					const { tokensIn, tokensOut } = parsedText

					// Skip placeholder messages that don't have real token data yet
					const hasRealTokenData = (tokensIn ?? 0) > 0 || (tokensOut ?? 0) > 0
					if (!hasRealTokenData) {
						continue // Skip this placeholder, look for previous message
					}

					// Use the last request's tokens - tokensIn already includes full context
					result.contextTokens = (tokensIn || 0) + (tokensOut || 0)
					break
				} catch {
					// Ignore JSON parse errors
					continue
				}
			}
		}
	}

	return result
}

/**
 * Check if token usage has changed by comparing relevant properties.
 * @param current - Current token usage data
 * @param snapshot - Previous snapshot to compare against
 * @returns true if any relevant property has changed or snapshot is undefined
 */
export function hasTokenUsageChanged(current: TokenUsage, snapshot?: TokenUsage): boolean {
	if (!snapshot) {
		return true
	}

	const keysToCompare: (keyof TokenUsage)[] = [
		"totalTokensIn",
		"totalTokensOut",
		"totalCacheWrites",
		"totalCacheReads",
		"totalCost",
		"contextTokens",
	]

	return keysToCompare.some((key) => current[key] !== snapshot[key])
}

/**
 * Check if tool usage has changed by comparing attempts and failures.
 * @param current - Current tool usage data
 * @param snapshot - Previous snapshot to compare against (undefined treated as empty)
 * @returns true if any tool's attempts/failures have changed between current and snapshot
 */
export function hasToolUsageChanged(current: ToolUsage, snapshot?: ToolUsage): boolean {
	// Treat undefined snapshot as empty object for consistent comparison
	const effectiveSnapshot = snapshot ?? {}

	const currentKeys = Object.keys(current) as ToolName[]
	const snapshotKeys = Object.keys(effectiveSnapshot) as ToolName[]

	// Check if number of tools changed
	if (currentKeys.length !== snapshotKeys.length) {
		return true
	}

	// Check if any tool's stats changed
	return currentKeys.some((key) => {
		const currentTool = current[key]
		const snapshotTool = effectiveSnapshot[key]

		if (!snapshotTool || !currentTool) {
			return true
		}

		return currentTool.attempts !== snapshotTool.attempts || currentTool.failures !== snapshotTool.failures
	})
}
