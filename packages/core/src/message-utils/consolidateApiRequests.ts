import type { ClineMessage } from "@coder/types"

/**
 * Consolidates API request start and finish messages in an array of ClineMessages.
 *
 * This function looks for pairs of 'api_req_started' and 'api_req_finished' messages.
 * When it finds a pair, it consolidates them into a single message.
 * The JSON data in the text fields of both messages are merged.
 *
 * @param messages - An array of ClineMessage objects to process.
 * @returns A new array of ClineMessage objects with API requests consolidated.
 *
 * @example
 * const messages = [
 *   { type: "say", say: "api_req_started", text: '{"request":"GET /api/data"}', ts: 1000 },
 *   { type: "say", say: "api_req_finished", text: '{"cost":0.005}', ts: 1001 }
 * ];
 * const result = consolidateApiRequests(messages);
 * // Result: [{ type: "say", say: "api_req_started", text: '{"request":"GET /api/data","cost":0.005}', ts: 1000 }]
 */
export function consolidateApiRequests(messages: ClineMessage[]): ClineMessage[] {
	if (messages.length === 0) {
		return []
	}

	if (messages.length === 1) {
		return messages
	}

	let isMergeNecessary = false

	for (const msg of messages) {
		if (msg.type === "say" && (msg.say === "api_req_started" || msg.say === "api_req_finished")) {
			isMergeNecessary = true
			break
		}
	}

	if (!isMergeNecessary) {
		return messages
	}

	const result: ClineMessage[] = []
	const startedIndices: number[] = []

	for (const message of messages) {
		if (message.type !== "say" || (message.say !== "api_req_started" && message.say !== "api_req_finished")) {
			result.push(message)
			continue
		}

		if (message.say === "api_req_started") {
			// Add to result and track the index.
			result.push(message)
			startedIndices.push(result.length - 1)
			continue
		}

		// Find the most recent api_req_started that hasn't been consolidated.
		const startIndex = startedIndices.length > 0 ? startedIndices.pop() : undefined

		if (startIndex !== undefined) {
			const startMessage = result[startIndex]
			if (!startMessage) continue

			let startData: Record<string, any> = {}
			let finishData: Record<string, any> = {}

			try {
				if (startMessage.text) {
					startData = JSON.parse(startMessage.text)
				}
			} catch {
				// Ignore JSON parse errors
			}

			try {
				if (message.text) {
					finishData = JSON.parse(message.text)
				}
			} catch {
				// Ignore JSON parse errors
			}

			// Merge finish data into start data, but preserve token data from start if finish doesn't have it
			// This prevents token data loss when api_req_finished doesn't contain token info
			const mergedData = { ...startData }
			
			// Only override with finishData if the value is actually present (not undefined)
			// This ensures token data from api_req_started is preserved
			for (const key of Object.keys(finishData)) {
				if (finishData[key] !== undefined) {
					mergedData[key] = finishData[key]
				}
			}

			result[startIndex] = { ...startMessage, text: JSON.stringify(mergedData) }
		}
	}

	return result
}
