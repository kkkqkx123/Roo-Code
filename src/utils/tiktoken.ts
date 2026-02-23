import { Anthropic } from "@anthropic-ai/sdk"
import { Tiktoken } from "tiktoken/lite"
import o200kBase from "tiktoken/encoders/o200k_base"

const TOKEN_FUDGE_FACTOR = 1.5

let encoder: Tiktoken | null = null

/**
 * Comprehensive incremental token counter for streaming assistant responses.
 * Tracks text, reasoning, and tool calls to provide accurate token estimation.
 */
export class StreamingTokenCounter {
	private accumulatedText: string = ""
	private accumulatedReasoning: string = ""
	private toolCalls: Array<{ name: string; args: string }> = []
	private textTokenCount: number = 0
	private reasoningTokenCount: number = 0
	private toolCallsTokenCount: number = 0

	/**
	 * Add text content and return the incremental token count.
	 * @param text - New text to add
	 * @returns The number of tokens in the newly added text
	 */
	addText(text: string): number {
		if (!text || text.length === 0) {
			return 0
		}

		this.accumulatedText += text
		const newTotalTokens = this.countTokens(this.accumulatedText)
		const incrementalTokens = newTotalTokens - this.textTokenCount
		this.textTokenCount = newTotalTokens

		return incrementalTokens
	}

	/**
	 * Add reasoning content and return the incremental token count.
	 * @param text - New reasoning text to add
	 * @returns The number of tokens in the newly added reasoning text
	 */
	addReasoning(text: string): number {
		if (!text || text.length === 0) {
			return 0
		}

		this.accumulatedReasoning += text
		const newTotalTokens = this.countTokens(this.accumulatedReasoning)
		const incrementalTokens = newTotalTokens - this.reasoningTokenCount
		this.reasoningTokenCount = newTotalTokens

		return incrementalTokens
	}

	/**
	 * Add or update a tool call and return the incremental token count.
	 * @param toolName - Name of the tool
	 * @param args - Tool arguments (partial or complete)
	 * @returns The incremental token count for this tool call
	 */
	addToolCall(toolName: string, args: string): number {
		if (!toolName) {
			return 0
		}

		// Find existing tool call by name (for streaming updates)
		const existingIndex = this.toolCalls.findIndex((tc) => tc.name === toolName)
		const toolCallStr = `Tool: ${toolName}\nArguments: ${args}`
		const newTokens = this.countTokens(toolCallStr)

		if (existingIndex >= 0) {
			// Update existing tool call
			const oldToolCallStr = `Tool: ${this.toolCalls[existingIndex].name}\nArguments: ${this.toolCalls[existingIndex].args}`
			const oldTokens = this.countTokens(oldToolCallStr)
			this.toolCallsTokenCount -= oldTokens

			this.toolCalls[existingIndex] = { name: toolName, args }
			this.toolCallsTokenCount += newTokens

			return newTokens - oldTokens
		} else {
			// Add new tool call
			this.toolCalls.push({ name: toolName, args })
			this.toolCallsTokenCount += newTokens
			return newTokens
		}
	}

	/**
	 * Get the total token count for all accumulated content.
	 * @returns Total token count (text + reasoning + tool calls)
	 */
	getTotalTokens(): number {
		return this.textTokenCount + this.reasoningTokenCount + this.toolCallsTokenCount
	}

	/**
	 * Get token count breakdown by category.
	 * @returns Object with text, reasoning, toolCalls, and total counts
	 */
	getTokenBreakdown(): { text: number; reasoning: number; toolCalls: number; total: number } {
		return {
			text: this.textTokenCount,
			reasoning: this.reasoningTokenCount,
			toolCalls: this.toolCallsTokenCount,
			total: this.getTotalTokens(),
		}
	}

	/**
	 * Reset the counter.
	 */
	reset(): void {
		this.accumulatedText = ""
		this.accumulatedReasoning = ""
		this.toolCalls = []
		this.textTokenCount = 0
		this.reasoningTokenCount = 0
		this.toolCallsTokenCount = 0
	}

	/**
	 * Count tokens for a given text string.
	 * @param text - Text to count tokens for
	 * @returns Token count
	 */
	private countTokens(text: string): number {
		if (!text || text.length === 0) {
			return 0
		}

		// Lazily create and cache the encoder if it doesn't exist.
		if (!encoder) {
			encoder = new Tiktoken(o200kBase.bpe_ranks, o200kBase.special_tokens, o200kBase.pat_str)
		}

		const tokens = encoder.encode(text, undefined, [])
		return tokens.length
	}
}

/**
 * Serializes a tool_use block to text for token counting.
 * Approximates how the API sees the tool call.
 */
function serializeToolUse(block: Anthropic.Messages.ToolUseBlockParam): string {
	const parts = [`Tool: ${block.name}`]
	if (block.input !== undefined) {
		try {
			parts.push(`Arguments: ${JSON.stringify(block.input)}`)
		} catch {
			parts.push(`Arguments: [serialization error]`)
		}
	}
	return parts.join("\n")
}

/**
 * Serializes a tool_result block to text for token counting.
 * Handles both string content and array content.
 */
function serializeToolResult(block: Anthropic.Messages.ToolResultBlockParam): string {
	const parts = [`Tool Result (${block.tool_use_id})`]

	if (block.is_error) {
		parts.push(`[Error]`)
	}

	const content = block.content
	if (typeof content === "string") {
		parts.push(content)
	} else if (Array.isArray(content)) {
		// Handle array of content blocks recursively
		for (const item of content) {
			if (item.type === "text") {
				parts.push(item.text || "")
			} else if (item.type === "image") {
				parts.push("[Image content]")
			} else {
				parts.push(`[Unsupported content block: ${String((item as { type?: unknown }).type)}]`)
			}
		}
	}

	return parts.join("\n")
}

export async function tiktoken(content: Anthropic.Messages.ContentBlockParam[]): Promise<number> {
	if (content.length === 0) {
		return 0
	}

	let totalTokens = 0

	// Lazily create and cache the encoder if it doesn't exist.
	if (!encoder) {
		encoder = new Tiktoken(o200kBase.bpe_ranks, o200kBase.special_tokens, o200kBase.pat_str)
	}

	// Process each content block using the cached encoder.
	for (const block of content) {
		if (block.type === "text") {
			const text = block.text || ""

			if (text.length > 0) {
				const tokens = encoder.encode(text, undefined, [])
				totalTokens += tokens.length
			}
		} else if (block.type === "image") {
			// For images, calculate based on data size.
			const imageSource = block.source

			if (imageSource && typeof imageSource === "object" && "data" in imageSource) {
				const base64Data = imageSource.data as string
				totalTokens += Math.ceil(Math.sqrt(base64Data.length))
			} else {
				totalTokens += 300 // Conservative estimate for unknown images
			}
		} else if (block.type === "tool_use") {
			// Serialize tool_use block to text and count tokens
			const serialized = serializeToolUse(block as Anthropic.Messages.ToolUseBlockParam)
			if (serialized.length > 0) {
				const tokens = encoder.encode(serialized, undefined, [])
				totalTokens += tokens.length
			}
		} else if (block.type === "tool_result") {
			// Serialize tool_result block to text and count tokens
			const serialized = serializeToolResult(block as Anthropic.Messages.ToolResultBlockParam)
			if (serialized.length > 0) {
				const tokens = encoder.encode(serialized, undefined, [])
				totalTokens += tokens.length
			}
		}
	}

	// Add a fudge factor to account for the fact that tiktoken is not always
	// accurate.
	return Math.ceil(totalTokens * TOKEN_FUDGE_FACTOR)
}
