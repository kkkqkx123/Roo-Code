import type OpenAI from "openai"

// Import from new unified schema location
import {
	getAllNativeTools,
	type ReadFileToolOptions,
} from "../../../tools/schemas"

// Re-export for backward compatibility
export { getMcpServerTools } from "./mcp_server"
export { convertOpenAIToolToAnthropic, convertOpenAIToolsToAnthropic } from "./converters"
export type { ReadFileToolOptions } from "../../../tools/schemas"

/**
 * Options for customizing the native tools array.
 */
export interface NativeToolsOptions {
	/** Whether the model supports image processing (default: false) */
	supportsImages?: boolean
}

/**
 * Get native tools array, optionally customizing based on settings.
 *
 * @param options - Configuration options for the tools
 * @returns Array of native tool definitions
 */
export function getNativeTools(options: NativeToolsOptions = {}): OpenAI.Chat.ChatCompletionTool[] {
	return getAllNativeTools(options)
}

// Backward compatibility: export default tools with line ranges enabled
export const nativeTools = getNativeTools()
