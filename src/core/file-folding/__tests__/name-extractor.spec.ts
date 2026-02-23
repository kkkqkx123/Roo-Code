import { describe, test, expect, vi } from "vitest"
import { extractFoldingItems, FoldingItem } from "../name-extractor"
import { parseSourceCodeDefinitionsForFileFolding } from "../../../services/tree-sitter"

// Mock the tree-sitter function
vi.mock("../../../services/tree-sitter", () => ({
	parseSourceCodeDefinitionsForFileFolding: vi.fn(),
}))

describe("name-extractor", () => {
	describe("extractFoldingItems", () => {
		test("should extract folding items from TypeScript file", async () => {
			const mockDefinitions = [
				{ type: "class" as const, name: "MyClass", startLine: 1, endLine: 10, originalType: "name.definition.class", language: "typescript" },
				{ type: "interface" as const, name: "MyInterface", startLine: 11, endLine: 20, originalType: "name.definition.interface", language: "typescript" },
				{ type: "function" as const, name: "myFunction", startLine: 21, endLine: 30, originalType: "name.definition.function", language: "typescript" },
				{ type: "type" as const, name: "MyType", startLine: 31, endLine: 35, originalType: "name.definition.type", language: "typescript" },
			]

			vi.mocked(parseSourceCodeDefinitionsForFileFolding).mockResolvedValue(mockDefinitions)

			const result = await extractFoldingItems("/test/file.ts")

			expect(result).toHaveLength(4)
			expect(result).toEqual([
				{ type: "class", name: "MyClass", lineNumber: 1 },
				{ type: "interface", name: "MyInterface", lineNumber: 11 },
				{ type: "function", name: "myFunction", lineNumber: 21 },
				{ type: "type", name: "MyType", lineNumber: 31 },
			])
		})

		test("should return null when tree-sitter returns null", async () => {
			vi.mocked(parseSourceCodeDefinitionsForFileFolding).mockResolvedValue(null)

			const result = await extractFoldingItems("/test/file.ts")

			expect(result).toBeNull()
		})

		test("should return null when tree-sitter throws error", async () => {
			vi.mocked(parseSourceCodeDefinitionsForFileFolding).mockRejectedValue(new Error("Parse error"))

			const result = await extractFoldingItems("/test/file.ts")

			expect(result).toBeNull()
		})

		test("should handle empty definitions array", async () => {
			vi.mocked(parseSourceCodeDefinitionsForFileFolding).mockResolvedValue([])

			const result = await extractFoldingItems("/test/file.ts")

			expect(result).toEqual([])
		})

		test("should filter out 'other' type for compression", async () => {
			const mockDefinitions = [
				{ type: "class" as const, name: "MyClass", startLine: 1, endLine: 10, originalType: "name.definition.class", language: "typescript" },
				{ type: "interface" as const, name: "MyInterface", startLine: 11, endLine: 20, originalType: "name.definition.interface", language: "typescript" },
				{ type: "function" as const, name: "myFunction", startLine: 21, endLine: 30, originalType: "name.definition.function", language: "typescript" },
				{ type: "type" as const, name: "MyType", startLine: 31, endLine: 35, originalType: "name.definition.type", language: "typescript" },
				{ type: "other" as const, name: "MyNamespace", startLine: 36, endLine: 40, originalType: "name.definition.namespace", language: "typescript" },
			]

			vi.mocked(parseSourceCodeDefinitionsForFileFolding).mockResolvedValue(mockDefinitions)

			const result = await extractFoldingItems("/test/file.ts")

			expect(result).toHaveLength(4)
			expect(result?.[0]).toEqual({ type: "class", name: "MyClass", lineNumber: 1 })
			expect(result?.[1]).toEqual({ type: "interface", name: "MyInterface", lineNumber: 11 })
			expect(result?.[2]).toEqual({ type: "function", name: "myFunction", lineNumber: 21 })
			expect(result?.[3]).toEqual({ type: "type", name: "MyType", lineNumber: 31 })
		})

		test("should pass rooIgnoreController to tree-sitter", async () => {
			const mockController = {} as any
			vi.mocked(parseSourceCodeDefinitionsForFileFolding).mockResolvedValue([])

			await extractFoldingItems("/test/file.ts", mockController)

			expect(parseSourceCodeDefinitionsForFileFolding).toHaveBeenCalledWith("/test/file.ts", mockController)
		})
	})
})