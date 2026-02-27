import { MergedSection } from "./function-merger"
import { tiktoken } from "../../utils/tiktoken"

/**
 * Result of applying random drop to sections.
 */
export interface RandomDropResult {
	/** The sections that were kept */
	keptSections: MergedSection[]
	/** The sections that were dropped */
	droppedSections: MergedSection[]
	/** The number of sections dropped */
	droppedCount: number
	/** The estimated token count after dropping */
	estimatedTokens: number
}

/**
 * Options for random drop operation.
 */
export interface RandomDropOptions {
	/** Maximum allowed tokens */
	maxTokens: number
	/** Current token count of all sections */
	currentTokens: number
	/** Average tokens per section (for heuristic calculation) */
	avgTokensPerSection: number
}

/**
 * Calculates the excess ratio based on current tokens and max tokens.
 * Returns 0 if current tokens are within the limit.
 *
 * @param currentTokens - Current token count
 * @param maxTokens - Maximum allowed tokens
 * @returns Excess ratio (0 if no excess)
 */
export function calculateExcessRatio(currentTokens: number, maxTokens: number): number {
	if (currentTokens <= maxTokens) {
		return 0
	}
	return currentTokens / maxTokens - 1
}

/**
 * Calculates the heuristic batch size for dropping sections.
 * This estimates how many sections need to be dropped to get under the token limit.
 *
 * @param currentTokens - Current token count
 * @param maxTokens - Maximum allowed tokens
 * @param avgTokensPerSection - Average tokens per section
 * @returns Number of sections to drop
 */
export function calculateBatchSize(
	currentTokens: number,
	maxTokens: number,
	avgTokensPerSection: number,
): number {
	const excessTokens = currentTokens - maxTokens

	if (excessTokens <= 0 || avgTokensPerSection <= 0) {
		return 0
	}

	// Calculate how many sections we need to drop
	// Use Math.ceil to ensure we drop enough
	return Math.ceil(excessTokens / avgTokensPerSection)
}

/**
 * Shuffles an array in place using Fisher-Yates algorithm.
 *
 * @param array - Array to shuffle
 * @returns The same array (shuffled)
 */
export function shuffleArray<T>(array: T[]): T[] {
	for (let i = array.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		const temp = array[i]
		array[i] = array[j]!
		array[j] = temp!
	}
	return array
}

/**
 * Applies random drop to sections based on token threshold.
 * This function:
 * 1. Calculates the excess ratio
 * 2. Calculates the heuristic batch size
 * 3. Randomly shuffles sections
 * 4. Drops the required number of sections
 * 5. Returns the result
 *
 * @param sections - Array of merged sections
 * @param options - Random drop options
 * @returns Random drop result
 */
export function applyRandomDrop(sections: MergedSection[], options: RandomDropOptions): RandomDropResult {
	const { maxTokens, currentTokens, avgTokensPerSection } = options

	// Calculate excess ratio
	const excessRatio = calculateExcessRatio(currentTokens, maxTokens)

	// If no excess, return all sections
	if (excessRatio <= 0) {
		return {
			keptSections: sections,
			droppedSections: [],
			droppedCount: 0,
			estimatedTokens: currentTokens,
		}
	}

	// Calculate batch size
	const batchSize = calculateBatchSize(currentTokens, maxTokens, avgTokensPerSection)

	// If batch size is 0 or larger than total sections, handle edge cases
	if (batchSize === 0) {
		return {
			keptSections: sections,
			droppedSections: [],
			droppedCount: 0,
			estimatedTokens: currentTokens,
		}
	}

	if (batchSize >= sections.length) {
		// Drop all sections except keep at least one if possible
		const kept: MergedSection[] = sections.length > 0 ? [sections[0]!] : []
		const dropped: MergedSection[] = sections.length > 0 ? sections.slice(1) : []
		return {
			keptSections: kept,
			droppedSections: dropped,
			droppedCount: dropped.length,
			estimatedTokens: kept.length * avgTokensPerSection,
		}
	}

	// Create a copy and shuffle it
	const shuffled = [...sections]
	shuffleArray(shuffled)

	// Split into kept and dropped
	const dropped: MergedSection[] = shuffled.slice(0, batchSize)
	const kept: MergedSection[] = shuffled.slice(batchSize)

	// Estimate new token count
	const estimatedTokens = kept.length * avgTokensPerSection

	return {
		keptSections: kept,
		droppedSections: dropped,
		droppedCount: dropped.length,
		estimatedTokens,
	}
}

/**
 * Estimates the average tokens per section.
 * This is a heuristic calculation used for batch size estimation.
 *
 * @param sections - Array of merged sections
 * @param sectionContent - Function to get content for a section
 * @returns Estimated average tokens per section
 */
export async function estimateAvgTokensPerSection(
	sections: MergedSection[],
	sectionContent: (section: MergedSection) => string,
): Promise<number> {
	if (sections.length === 0) {
		return 0
	}

	// Sample up to 10 sections to estimate average
	const sampleSize = Math.min(sections.length, 10)
	const sampleIndices = []

	// Generate random indices for sampling
	for (let i = 0; i < sampleSize; i++) {
		const randomIndex = Math.floor(Math.random() * sections.length)
		sampleIndices.push(randomIndex)
	}

	// Calculate tokens for sampled sections
	let totalTokens = 0
	for (const index of sampleIndices) {
		const section = sections[index]!
		const content = sectionContent(section)
		const tokens = await tiktoken([{ type: "text", text: content }])
		totalTokens += tokens
	}

	// Calculate average
	return totalTokens / sampleSize
}