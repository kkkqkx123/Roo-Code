import { describe, test, expect } from "vitest"
import { mergeFunctionBlocks, formatMergedSections } from "../function-merger"
import type { FoldingItem } from "../name-extractor"

describe("function-merger", () => {
	describe("mergeFunctionBlocks", () => {
		test("should return empty array for empty input", () => {
			const result = mergeFunctionBlocks([])
			expect(result).toEqual([])
		})

		test("should keep classes as separate sections", () => {
			const definitions: FoldingItem[] = [
				{ type: "class", name: "MyClass", lineNumber: 1 },
				{ type: "class", name: "AnotherClass", lineNumber: 10 },
			]

			const result = mergeFunctionBlocks(definitions)

			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({ type: "class", names: ["MyClass"], startLine: 1 })
			expect(result[1]).toEqual({ type: "class", names: ["AnotherClass"], startLine: 10 })
		})

		test("should keep interfaces as separate sections", () => {
			const definitions: FoldingItem[] = [
				{ type: "interface", name: "MyInterface", lineNumber: 1 },
				{ type: "interface", name: "AnotherInterface", lineNumber: 10 },
			]

			const result = mergeFunctionBlocks(definitions)

			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({ type: "interface", names: ["MyInterface"], startLine: 1 })
			expect(result[1]).toEqual({ type: "interface", names: ["AnotherInterface"], startLine: 10 })
		})

		test("should keep types as separate sections", () => {
			const definitions: FoldingItem[] = [
				{ type: "type", name: "MyType", lineNumber: 1 },
				{ type: "type", name: "AnotherType", lineNumber: 10 },
			]

			const result = mergeFunctionBlocks(definitions)

			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({ type: "type", names: ["MyType"], startLine: 1 })
			expect(result[1]).toEqual({ type: "type", names: ["AnotherType"], startLine: 10 })
		})

		test("should merge consecutive functions", () => {
			const definitions: FoldingItem[] = [
				{ type: "function", name: "func1", lineNumber: 1 },
				{ type: "function", name: "func2", lineNumber: 10 },
				{ type: "function", name: "func3", lineNumber: 20 },
			]

			const result = mergeFunctionBlocks(definitions)

			expect(result).toHaveLength(1)
			expect(result[0]).toEqual({
				type: "functions",
				names: ["func1", "func2", "func3"],
				startLine: 1,
			})
		})

		test("should interrupt function merging when class is encountered", () => {
			const definitions: FoldingItem[] = [
				{ type: "function", name: "func1", lineNumber: 1 },
				{ type: "function", name: "func2", lineNumber: 10 },
				{ type: "class", name: "MyClass", lineNumber: 20 },
				{ type: "function", name: "func3", lineNumber: 30 },
			]

			const result = mergeFunctionBlocks(definitions)

			expect(result).toHaveLength(3)
			expect(result[0]).toEqual({
				type: "functions",
				names: ["func1", "func2"],
				startLine: 1,
			})
			expect(result[1]).toEqual({ type: "class", names: ["MyClass"], startLine: 20 })
			expect(result[2]).toEqual({
				type: "functions",
				names: ["func3"],
				startLine: 30,
			})
		})

		test("should interrupt function merging when type is encountered", () => {
			const definitions: FoldingItem[] = [
				{ type: "function", name: "func1", lineNumber: 1 },
				{ type: "function", name: "func2", lineNumber: 10 },
				{ type: "type", name: "MyType", lineNumber: 20 },
				{ type: "function", name: "func3", lineNumber: 30 },
			]

			const result = mergeFunctionBlocks(definitions)

			expect(result).toHaveLength(3)
			expect(result[0]).toEqual({
				type: "functions",
				names: ["func1", "func2"],
				startLine: 1,
			})
			expect(result[1]).toEqual({ type: "type", names: ["MyType"], startLine: 20 })
			expect(result[2]).toEqual({
				type: "functions",
				names: ["func3"],
				startLine: 30,
			})
		})

		test("should interrupt function merging when line span exceeds maxLineSpan", () => {
			const definitions: FoldingItem[] = [
				{ type: "function", name: "func1", lineNumber: 1 },
				{ type: "function", name: "func2", lineNumber: 50 },
				{ type: "function", name: "func3", lineNumber: 120 },
			]

			const result = mergeFunctionBlocks(definitions, { maxLineSpan: 100 })

			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({
				type: "functions",
				names: ["func1", "func2"],
				startLine: 1,
			})
			expect(result[1]).toEqual({
				type: "functions",
				names: ["func3"],
				startLine: 120,
			})
		})

		test("should use default maxLineSpan of 100", () => {
			const definitions: FoldingItem[] = [
				{ type: "function", name: "func1", lineNumber: 1 },
				{ type: "function", name: "func2", lineNumber: 50 },
				{ type: "function", name: "func3", lineNumber: 120 },
			]

			const result = mergeFunctionBlocks(definitions)

			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({
				type: "functions",
				names: ["func1", "func2"],
				startLine: 1,
			})
		})

		test("should handle mixed definitions", () => {
			const definitions: FoldingItem[] = [
				{ type: "class", name: "MyClass", lineNumber: 1 },
				{ type: "function", name: "func1", lineNumber: 10 },
				{ type: "function", name: "func2", lineNumber: 20 },
				{ type: "interface", name: "MyInterface", lineNumber: 30 },
				{ type: "function", name: "func3", lineNumber: 40 },
				{ type: "type", name: "MyType", lineNumber: 50 },
			]

			const result = mergeFunctionBlocks(definitions)

			expect(result).toHaveLength(5)
			expect(result[0]).toEqual({ type: "class", names: ["MyClass"], startLine: 1 })
			expect(result[1]).toEqual({
				type: "functions",
				names: ["func1", "func2"],
				startLine: 10,
			})
			expect(result[2]).toEqual({ type: "interface", names: ["MyInterface"], startLine: 30 })
			expect(result[3]).toEqual({
				type: "functions",
				names: ["func3"],
				startLine: 40,
			})
			expect(result[4]).toEqual({ type: "type", names: ["MyType"], startLine: 50 })
		})

		test("should interrupt function merging when line span exceeds maxLineSpan", () => {
			const definitions: FoldingItem[] = [
				{ type: "function", name: "func1", lineNumber: 1 },
				{ type: "function", name: "func2", lineNumber: 50 },
				{ type: "function", name: "func3", lineNumber: 120 },
			]

			const result = mergeFunctionBlocks(definitions, { maxLineSpan: 100 })

			expect(result).toHaveLength(2)
			expect(result[0]).toEqual({
				type: "functions",
				names: ["func1", "func2"],
				startLine: 1,
			})
			expect(result[1]).toEqual({
				type: "functions",
				names: ["func3"],
				startLine: 120,
			})
		})
	})

	describe("formatMergedSections", () => {
		test("should format class sections", () => {
			const sections = [
				{ type: "class" as const, names: ["MyClass"], startLine: 1 },
			]

			const result = formatMergedSections(sections)

			expect(result).toBe("1 | class MyClass")
		})

		test("should format interface sections", () => {
			const sections = [
				{ type: "interface" as const, names: ["MyInterface"], startLine: 1 },
			]

			const result = formatMergedSections(sections)

			expect(result).toBe("1 | interface MyInterface")
		})

		test("should format function sections with multiple names", () => {
			const sections = [
				{ type: "functions" as const, names: ["func1", "func2", "func3"], startLine: 1 },
			]

			const result = formatMergedSections(sections)

			expect(result).toBe("1 | func1, func2, func3")
		})

		test("should format type sections", () => {
			const sections = [
				{ type: "type" as const, names: ["MyType"], startLine: 1 },
			]

			const result = formatMergedSections(sections)

			expect(result).toBe("1 | type MyType")
		})

		test("should format multiple sections", () => {
			const sections = [
				{ type: "class" as const, names: ["MyClass"], startLine: 1 },
				{ type: "functions" as const, names: ["func1", "func2"], startLine: 11 },
				{ type: "interface" as const, names: ["MyInterface"], startLine: 21 },
				{ type: "type" as const, names: ["MyType"], startLine: 31 },
			]

			const result = formatMergedSections(sections)

			expect(result).toBe("1 | class MyClass\n11 | func1, func2\n21 | interface MyInterface\n31 | type MyType")
		})

		test("should handle empty sections array", () => {
			const result = formatMergedSections([])
			expect(result).toBe("")
		})
	})
})