import { describe, test, expect, beforeEach, vi } from "vitest"
import { foldFiles } from "../index"
import * as path from "path"

// Mock tree-sitter
vi.mock("../../../services/tree-sitter", () => ({
	parseSourceCodeDefinitionsForFileFolding: vi.fn(),
}))

// Mock tiktoken
vi.mock("../../../utils/tiktoken", () => ({
	tiktoken: vi.fn(),
}))

import { parseSourceCodeDefinitionsForFileFolding } from "../../../services/tree-sitter"
import { tiktoken } from "../../../utils/tiktoken"

describe("file-folding", () => {
	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("foldFiles", () => {
		test("should return empty result for empty file list", async () => {
			const result = await foldFiles([], { cwd: "/test" })

			expect(result.content).toBe("")
			expect(result.sections).toEqual([])
			expect(result.filesProcessed).toBe(0)
			expect(result.filesSkipped).toBe(0)
			expect(result.totalTokens).toBe(0)
			expect(result.sectionsDropped).toBe(0)
		})

		test("should process single file successfully", async () => {
			const mockDefinitions = [
				{ type: "class" as const, name: "MyClass", startLine: 1, endLine: 10, originalType: "name.definition.class", language: "typescript" },
				{ type: "function" as const, name: "myFunction", startLine: 11, endLine: 20, originalType: "name.definition.function", language: "typescript" },
			]
			vi.mocked(parseSourceCodeDefinitionsForFileFolding).mockResolvedValue(mockDefinitions)
			vi.mocked(tiktoken).mockResolvedValue(100)

			const result = await foldFiles(["src/test.ts"], { cwd: "/test" })

			expect(result.filesProcessed).toBe(1)
			expect(result.filesSkipped).toBe(0)
			expect(result.sections.length).toBe(1)
			expect(result.content).toContain("<system-reminder>")
			expect(result.content).toContain("## File Context: src/test.ts")
			expect(parseSourceCodeDefinitionsForFileFolding).toHaveBeenCalledTimes(1)
		})

		test("should skip files that return null from tree-sitter", async () => {
			vi.mocked(parseSourceCodeDefinitionsForFileFolding).mockResolvedValue(null)

			const result = await foldFiles(["src/test.ts"], { cwd: "/test" })

			expect(result.filesProcessed).toBe(0)
			expect(result.filesSkipped).toBe(1)
			expect(result.sections.length).toBe(0)
		})

		test("should handle errors gracefully", async () => {
			vi.mocked(parseSourceCodeDefinitionsForFileFolding).mockRejectedValue(new Error("Test error"))

			const result = await foldFiles(["src/test.ts"], { cwd: "/test" })

			expect(result.filesProcessed).toBe(0)
			expect(result.filesSkipped).toBe(1)
			expect(result.sections.length).toBe(0)
		})

		test("should merge function blocks when mergeFunctions is true", async () => {
			const mockDefinitions = [
				{ type: "class" as const, name: "MyClass", startLine: 1, endLine: 10, originalType: "name.definition.class", language: "typescript" },
				{ type: "function" as const, name: "func1", startLine: 11, endLine: 20, originalType: "name.definition.function", language: "typescript" },
				{ type: "function" as const, name: "func2", startLine: 21, endLine: 30, originalType: "name.definition.function", language: "typescript" },
				{ type: "function" as const, name: "func3", startLine: 31, endLine: 40, originalType: "name.definition.function", language: "typescript" },
			]
			vi.mocked(parseSourceCodeDefinitionsForFileFolding).mockResolvedValue(mockDefinitions)
			vi.mocked(tiktoken).mockResolvedValue(100)

			const result = await foldFiles(["src/test.ts"], { cwd: "/test", mergeFunctions: true })

			expect(result.filesProcessed).toBe(1)
			expect(result.content).toContain("class MyClass")
			expect(result.content).toContain("func1, func2, func3")
		})

		test("should not merge function blocks when mergeFunctions is false", async () => {
			const mockDefinitions = [
				{ type: "class" as const, name: "MyClass", startLine: 1, endLine: 10, originalType: "name.definition.class", language: "typescript" },
				{ type: "function" as const, name: "func1", startLine: 11, endLine: 20, originalType: "name.definition.function", language: "typescript" },
				{ type: "function" as const, name: "func2", startLine: 21, endLine: 30, originalType: "name.definition.function", language: "typescript" },
			]
			vi.mocked(parseSourceCodeDefinitionsForFileFolding).mockResolvedValue(mockDefinitions)
			vi.mocked(tiktoken).mockResolvedValue(100)

			const result = await foldFiles(["src/test.ts"], { cwd: "/test", mergeFunctions: false })

			expect(result.filesProcessed).toBe(1)
			// When not merging, each function should be on its own line
			expect(result.content).toContain("class MyClass")
		})

		test("should apply random drop when tokens exceed maxTokens", async () => {
			const mockDefinitions = [
				{ type: "class" as const, name: "MyClass", startLine: 1, endLine: 10, originalType: "name.definition.class", language: "typescript" },
				{ type: "function" as const, name: "func1", startLine: 11, endLine: 20, originalType: "name.definition.function", language: "typescript" },
				{ type: "function" as const, name: "func2", startLine: 21, endLine: 30, originalType: "name.definition.function", language: "typescript" },
				{ type: "function" as const, name: "func3", startLine: 31, endLine: 40, originalType: "name.definition.function", language: "typescript" },
			]
			vi.mocked(parseSourceCodeDefinitionsForFileFolding).mockResolvedValue(mockDefinitions)

			// First call returns high token count, second call returns lower
			vi.mocked(tiktoken)
				.mockResolvedValueOnce(15000) // Initial high count
				.mockResolvedValueOnce(500) // Average per section
				.mockResolvedValueOnce(8000) // After dropping

			const result = await foldFiles(["src/test.ts"], { cwd: "/test", maxTokens: 10000 })

			expect(result.filesProcessed).toBe(1)
			expect(result.sectionsDropped).toBeGreaterThan(0)
			expect(result.totalTokens).toBeLessThanOrEqual(15000)
		})

		test("should not apply random drop when tokens are within limit", async () => {
			const mockDefinitions = [
				{ type: "class" as const, name: "MyClass", startLine: 1, endLine: 10, originalType: "name.definition.class", language: "typescript" },
				{ type: "function" as const, name: "func1", startLine: 11, endLine: 20, originalType: "name.definition.function", language: "typescript" },
			]
			vi.mocked(parseSourceCodeDefinitionsForFileFolding).mockResolvedValue(mockDefinitions)
			vi.mocked(tiktoken).mockResolvedValue(5000)

			const result = await foldFiles(["src/test.ts"], { cwd: "/test", maxTokens: 10000 })

			expect(result.filesProcessed).toBe(1)
			expect(result.sectionsDropped).toBe(0)
			expect(result.totalTokens).toBe(5000)
		})

		test("should process multiple files", async () => {
			const mockDefinitions = [
				{ type: "class" as const, name: "MyClass", startLine: 1, endLine: 10, originalType: "name.definition.class", language: "typescript" },
			]
			vi.mocked(parseSourceCodeDefinitionsForFileFolding).mockResolvedValue(mockDefinitions)
			vi.mocked(tiktoken).mockResolvedValue(100)

			const result = await foldFiles(["src/test1.ts", "src/test2.ts", "src/test3.ts"], { cwd: "/test" })

			expect(result.filesProcessed).toBe(3)
			expect(result.sections.length).toBe(3)
			expect(result.content).toContain("## File Context: src/test1.ts")
			expect(result.content).toContain("## File Context: src/test2.ts")
			expect(result.content).toContain("## File Context: src/test3.ts")
		})

		test("should use custom maxLineSpan", async () => {
			const mockDefinitions = [
				{ type: "function" as const, name: "func1", startLine: 1, endLine: 10, originalType: "name.definition.function", language: "typescript" },
				{ type: "function" as const, name: "func2", startLine: 20, endLine: 30, originalType: "name.definition.function", language: "typescript" },
				{ type: "function" as const, name: "func3", startLine: 40, endLine: 50, originalType: "name.definition.function", language: "typescript" },
			]
			vi.mocked(parseSourceCodeDefinitionsForFileFolding).mockResolvedValue(mockDefinitions)
			vi.mocked(tiktoken).mockResolvedValue(100)

			const result = await foldFiles(["src/test.ts"], { cwd: "/test", maxLineSpan: 30 })

			expect(result.filesProcessed).toBe(1)
			// With maxLineSpan of 30, functions should be split into multiple groups
		})

		test("should resolve relative paths correctly", async () => {
			const mockDefinitions = [
				{ type: "class" as const, name: "MyClass", startLine: 1, endLine: 10, originalType: "name.definition.class", language: "typescript" },
			]
			vi.mocked(parseSourceCodeDefinitionsForFileFolding).mockResolvedValue(mockDefinitions)
			vi.mocked(tiktoken).mockResolvedValue(100)

			await foldFiles(["src/test.ts"], { cwd: "/test" })

			expect(parseSourceCodeDefinitionsForFileFolding).toHaveBeenCalled()
			const callArgs = vi.mocked(parseSourceCodeDefinitionsForFileFolding).mock.calls[0]
			expect(callArgs[0]).toContain("test")
		})

		test("should handle empty definitions array", async () => {
			vi.mocked(parseSourceCodeDefinitionsForFileFolding).mockResolvedValue([])

			const result = await foldFiles(["src/test.ts"], { cwd: "/test" })

			expect(result.filesProcessed).toBe(0)
			expect(result.filesSkipped).toBe(1)
		})

		test("should handle type definitions", async () => {
			const mockDefinitions = [
				{ type: "type" as const, name: "MyType", startLine: 1, endLine: 5, originalType: "name.definition.type", language: "typescript" },
				{ type: "type" as const, name: "MyEnum", startLine: 6, endLine: 10, originalType: "name.definition.enum", language: "typescript" },
			]
			vi.mocked(parseSourceCodeDefinitionsForFileFolding).mockResolvedValue(mockDefinitions)
			vi.mocked(tiktoken).mockResolvedValue(100)

			const result = await foldFiles(["src/test.ts"], { cwd: "/test" })

			expect(result.filesProcessed).toBe(1)
			expect(result.content).toContain("type MyType")
			expect(result.content).toContain("type MyEnum")
		})
	})
})