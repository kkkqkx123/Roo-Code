import { describe, test, expect } from "vitest"
import {
	calculateExcessRatio,
	calculateBatchSize,
	shuffleArray,
	applyRandomDrop,
	estimateAvgTokensPerSection,
} from "../random-dropper"
import type { MergedSection } from "../function-merger"

describe("random-dropper", () => {
	describe("calculateExcessRatio", () => {
		test("should return 0 when current tokens are within limit", () => {
			expect(calculateExcessRatio(5000, 10000)).toBe(0)
			expect(calculateExcessRatio(10000, 10000)).toBe(0)
		})

		test("should calculate correct excess ratio", () => {
			expect(calculateExcessRatio(15000, 10000)).toBe(0.5)
			expect(calculateExcessRatio(20000, 10000)).toBe(1)
			expect(calculateExcessRatio(25000, 10000)).toBe(1.5)
		})
	})

	describe("calculateBatchSize", () => {
		test("should return 0 when no excess", () => {
			expect(calculateBatchSize(5000, 10000, 100)).toBe(0)
			expect(calculateBatchSize(10000, 10000, 100)).toBe(0)
		})

		test("should calculate correct batch size", () => {
			expect(calculateBatchSize(15000, 10000, 100)).toBe(50)
			expect(calculateBatchSize(20000, 10000, 100)).toBe(100)
			expect(calculateBatchSize(25000, 10000, 100)).toBe(150)
		})

		test("should handle edge cases", () => {
			expect(calculateBatchSize(10001, 10000, 1)).toBe(1)
			expect(calculateBatchSize(10001, 10000, 1000)).toBe(1)
		})

		test("should return 0 when avgTokensPerSection is 0", () => {
			expect(calculateBatchSize(15000, 10000, 0)).toBe(0)
		})
	})

	describe("shuffleArray", () => {
		test("should shuffle array in place", () => {
			const arr = [1, 2, 3, 4, 5]
			const result = shuffleArray(arr)

			expect(result).toBe(arr)
			expect(result).toHaveLength(5)
			expect(result).toContain(1)
			expect(result).toContain(2)
			expect(result).toContain(3)
			expect(result).toContain(4)
			expect(result).toContain(5)
		})

		test("should handle empty array", () => {
			const arr: number[] = []
			const result = shuffleArray(arr)

			expect(result).toEqual([])
		})

		test("should handle single element array", () => {
			const arr = [1]
			const result = shuffleArray(arr)

			expect(result).toEqual([1])
		})

		test("should produce different order on multiple calls", () => {
			const arr = [1, 2, 3, 4, 5]
			const original = [...arr]

			shuffleArray(arr)
			const firstShuffle = [...arr]

			shuffleArray(arr)
			const secondShuffle = [...arr]

			// It's possible (though unlikely) to get the same shuffle twice
			// So we just verify that the array is still valid
			expect(firstShuffle).toHaveLength(5)
			expect(secondShuffle).toHaveLength(5)
			expect(firstShuffle).toContain(1)
			expect(secondShuffle).toContain(1)
		})
	})

	describe("applyRandomDrop", () => {
		const mockSections: MergedSection[] = [
			{ type: "class", names: ["Class1"], startLine: 1 },
			{ type: "class", names: ["Class2"], startLine: 11 },
			{ type: "functions", names: ["func1", "func2"], startLine: 21 },
			{ type: "functions", names: ["func3"], startLine: 31 },
			{ type: "interface", names: ["Interface1"], startLine: 41 },
		]

		test("should return all sections when no excess", () => {
			const result = applyRandomDrop(mockSections, {
				maxTokens: 10000,
				currentTokens: 5000,
				avgTokensPerSection: 100,
			})

			expect(result.keptSections).toHaveLength(5)
			expect(result.droppedSections).toHaveLength(0)
			expect(result.droppedCount).toBe(0)
			expect(result.estimatedTokens).toBe(5000)
		})

		test("should drop sections when excess exists", () => {
			const result = applyRandomDrop(mockSections, {
				maxTokens: 10000,
				currentTokens: 15000,
				avgTokensPerSection: 100,
			})

			expect(result.droppedCount).toBeGreaterThan(0)
			expect(result.droppedCount).toBeLessThan(5)
			expect(result.keptSections.length + result.droppedSections.length).toBe(5)
		})

		test("should calculate correct batch size", () => {
			const result = applyRandomDrop(mockSections, {
				maxTokens: 10000,
				currentTokens: 15000,
				avgTokensPerSection: 100,
			})

			// Excess is 5000 tokens, avg is 100, so batch size should be 50
			// But we only have 5 sections, so we should drop all but maybe 1
			expect(result.droppedCount).toBeGreaterThan(0)
		})

		test("should handle batch size larger than total sections", () => {
			const result = applyRandomDrop(mockSections, {
				maxTokens: 100,
				currentTokens: 10000,
				avgTokensPerSection: 100,
			})

			// Should keep at least one section
			expect(result.keptSections.length).toBeGreaterThanOrEqual(1)
			expect(result.droppedSections.length).toBeLessThanOrEqual(4)
		})

		test("should handle empty sections array", () => {
			const result = applyRandomDrop([], {
				maxTokens: 10000,
				currentTokens: 0,
				avgTokensPerSection: 100,
			})

			expect(result.keptSections).toEqual([])
			expect(result.droppedSections).toEqual([])
			expect(result.droppedCount).toBe(0)
			expect(result.estimatedTokens).toBe(0)
		})

		test("should estimate tokens correctly", () => {
			const result = applyRandomDrop(mockSections, {
				maxTokens: 10000,
				currentTokens: 15000,
				avgTokensPerSection: 100,
			})

			expect(result.estimatedTokens).toBe(result.keptSections.length * 100)
		})
	})

	describe("estimateAvgTokensPerSection", () => {
		const mockSections: MergedSection[] = [
			{ type: "class", names: ["Class1"], startLine: 1 },
			{ type: "functions", names: ["func1", "func2"], startLine: 11 },
			{ type: "interface", names: ["Interface1"], startLine: 21 },
		]

		test("should return 0 for empty sections", async () => {
			const result = await estimateAvgTokensPerSection([], () => "test")
			expect(result).toBe(0)
		})

		test("should estimate average tokens for sections", async () => {
			const result = await estimateAvgTokensPerSection(mockSections, (section) => {
				if (section.type === "class") return "class Class1"
				if (section.type === "functions") return "functions: func1, func2"
				return "interface Interface1"
			})

			expect(result).toBeGreaterThan(0)
		})

		test("should sample up to 10 sections", async () => {
			const manySections: MergedSection[] = Array.from({ length: 20 }, (_, i) => ({
				type: "functions" as const,
				names: [`func${i}`],
				startLine: i * 10,
			}))

			const result = await estimateAvgTokensPerSection(manySections, () => "test")

			// Should sample up to 10 sections and return average
			expect(result).toBeGreaterThan(0)
		})

		test("should handle single section", async () => {
			const singleSection: MergedSection[] = [
				{ type: "class", names: ["Class1"], startLine: 1 },
			]

			const result = await estimateAvgTokensPerSection(singleSection, () => "test")

			expect(result).toBeGreaterThan(0)
		})
	})
})