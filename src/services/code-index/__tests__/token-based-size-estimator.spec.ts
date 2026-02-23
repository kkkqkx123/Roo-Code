import { describe, it, expect, vi, beforeEach } from "vitest"
import { TokenBasedSizeEstimator } from "../token-based-size-estimator"
import * as fs from "fs/promises"
import * as path from "path"

// Mock fs module
vi.mock("fs/promises", () => ({
	stat: vi.fn(),
	readFile: vi.fn(),
}))

// Mock listFiles
vi.mock("../../glob/list-files", () => ({
	listFiles: vi.fn(),
}))

// Mock RooIgnoreController
vi.mock("../../../core/ignore/RooIgnoreController", () => ({
	RooIgnoreController: vi.fn().mockImplementation(() => ({
		initialize: vi.fn().mockResolvedValue(undefined),
		filterPaths: vi.fn((paths) => paths),
	})),
	IgnoreMode: {
		Both: "both",
	},
}))

describe("TokenBasedSizeEstimator", () => {
	let estimator: TokenBasedSizeEstimator
	const testDirectory = "/test/workspace"

	beforeEach(() => {
		estimator = new TokenBasedSizeEstimator()
		vi.clearAllMocks()
	})

	describe("estimateCollectionSize", () => {
		it("should estimate collection size from files", async () => {
			const { listFiles } = await import("../../glob/list-files")
			vi.mocked(listFiles).mockResolvedValue([
				["/test/workspace/file1.js", "/test/workspace/file2.ts"],
				false,
			])

			vi.mocked(fs.stat).mockResolvedValue({ size: 1000 } as any)
			vi.mocked(fs.readFile).mockResolvedValue("const x = 1;\nconst y = 2;\n")

			const result = await estimator.estimateCollectionSize(testDirectory)

			expect(result.fileCount).toBe(2) // 2 files
			expect(result.totalFileSize).toBe(2000) // 2 files * 1000 bytes
			expect(result.estimatedTokenCount).toBeGreaterThan(0)
			expect(result.estimatedVectorCount).toBeGreaterThan(0)
		})

		it("should handle empty directory", async () => {
			const { listFiles } = await import("../../glob/list-files")
			vi.mocked(listFiles).mockResolvedValue([[], false])

			const result = await estimator.estimateCollectionSize(testDirectory)

			expect(result.fileCount).toBe(0)
			expect(result.totalFileSize).toBe(0)
			expect(result.estimatedTokenCount).toBe(0)
			expect(result.estimatedVectorCount).toBe(0)
		})

		it("should skip files that cannot be read", async () => {
			const { listFiles } = await import("../../glob/list-files")
			vi.mocked(listFiles).mockResolvedValue([["/test/workspace/file1.js", "/test/workspace/file2.js"], false])

			vi.mocked(fs.stat).mockResolvedValue({ size: 1000 } as any)
			vi.mocked(fs.readFile)
				.mockResolvedValueOnce("const x = 1;")
				.mockRejectedValueOnce(new Error("Cannot read file"))

			const result = await estimator.estimateCollectionSize(testDirectory)

			expect(result.fileCount).toBe(1) // Only 1 file successfully read
		})

		it("should use custom estimation parameters", async () => {
			const { listFiles } = await import("../../glob/list-files")
			vi.mocked(listFiles).mockResolvedValue([["/test/workspace/file1.js"], false])

			vi.mocked(fs.stat).mockResolvedValue({ size: 400 } as any)
			vi.mocked(fs.readFile).mockResolvedValue("const x = 1;") // 12 chars

			estimator.setEstimationParameters(50, 4, 1.0) // 50 tokens per vector

			const result = await estimator.estimateCollectionSize(testDirectory)

			// 12 chars / 4 = 3 tokens * 1.0 = 3 tokens
			// 3 tokens / 50 = 0.06 -> 1 vector
			expect(result.estimatedTokenCount).toBe(3)
			expect(result.estimatedVectorCount).toBe(1)
		})
	})

	describe("estimateTokenCount", () => {
		it("should estimate token count from text", async () => {
			const { listFiles } = await import("../../glob/list-files")
			vi.mocked(listFiles).mockResolvedValue([["/test/workspace/file1.js"], false])

			vi.mocked(fs.stat).mockResolvedValue({ size: 100 } as any)
			vi.mocked(fs.readFile).mockResolvedValue("const x = 1;") // 12 chars

			const result = await estimator.estimateCollectionSize(testDirectory)

			// 12 chars / 4 = 3 tokens * 1.2 (code multiplier) = 3.6 -> 3 tokens
			expect(result.estimatedTokenCount).toBe(3)
		})

		it("should handle empty text", async () => {
			const { listFiles } = await import("../../glob/list-files")
			vi.mocked(listFiles).mockResolvedValue([["/test/workspace/file1.js"], false])

			vi.mocked(fs.stat).mockResolvedValue({ size: 0 } as any)
			vi.mocked(fs.readFile).mockResolvedValue("")

			const result = await estimator.estimateCollectionSize(testDirectory)

			expect(result.estimatedTokenCount).toBe(0)
		})

		it("should handle whitespace-only text", async () => {
			const { listFiles } = await import("../../glob/list-files")
			vi.mocked(listFiles).mockResolvedValue([["/test/workspace/file1.js"], false])

			vi.mocked(fs.stat).mockResolvedValue({ size: 10 } as any)
			vi.mocked(fs.readFile).mockResolvedValue("   \n\t  ")

			const result = await estimator.estimateCollectionSize(testDirectory)

			expect(result.estimatedTokenCount).toBe(0)
		})
	})

	describe("setEstimationParameters", () => {
		it("should update estimation parameters", () => {
			estimator.setEstimationParameters(200, 5, 1.5)

			// Verify parameters are set (indirectly through estimation)
			// This is tested through the estimateCollectionSize test above
		})
	})
})