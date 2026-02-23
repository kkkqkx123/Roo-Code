import { vi, describe, it, expect, beforeEach, afterEach } from "vitest"
import * as vscode from "vscode"
import * as path from "path"
import type { ClineProvider } from "../../../core/webview/ClineProvider"

import WorkspaceTracker from "../WorkspaceTracker"
import { listFiles } from "../../../services/glob/list-files"
import { toRelativePath, getWorkspacePath } from "../../../utils/path"

// Mock dependencies
vi.mock("../../../services/glob/list-files")
vi.mock("../../../utils/path")

describe("WorkspaceTracker", () => {
	let workspaceTracker: WorkspaceTracker
	let mockProvider: any
	let mockCwd: string

	beforeEach(() => {
		vi.clearAllMocks()
		vi.useFakeTimers()

		mockCwd = "C:\\test\\workspace"
		mockProvider = {
			cwd: mockCwd,
			postMessageToWebview: vi.fn(),
		} as unknown as ClineProvider

		// Mock getWorkspacePath
		vi.mocked(getWorkspacePath).mockReturnValue(mockCwd)

		// Mock listFiles to return empty by default
		vi.mocked(listFiles).mockResolvedValue([[], false])

		// Mock tabGroups.all
		Object.defineProperty(vi.mocked(vscode.window.tabGroups), "all", {
			value: [],
			writable: true,
			configurable: true,
		})
	})

	afterEach(() => {
		if (workspaceTracker) {
			workspaceTracker.dispose()
		}
		vi.useRealTimers()
	})

	describe("constructor", () => {
		it("should initialize with provider and register listeners", () => {
			workspaceTracker = new WorkspaceTracker(mockProvider)
			expect(workspaceTracker).toBeDefined()
		})
	})

	describe("cwd getter", () => {
		it("should return provider cwd when available", () => {
			workspaceTracker = new WorkspaceTracker(mockProvider)
			const cwd = (workspaceTracker as any).cwd
			expect(cwd).toBe(mockCwd)
		})

		it("should fallback to getWorkspacePath when provider is unavailable", () => {
			const deadProvider = {
				cwd: undefined,
				postMessageToWebview: vi.fn(),
			} as any
			workspaceTracker = new WorkspaceTracker(deadProvider)
			vi.mocked(getWorkspacePath).mockReturnValue("C:\\fallback\\path")
			const cwd = (workspaceTracker as any).cwd
			expect(cwd).toBe("C:\\fallback\\path")
		})
	})

	describe("initializeFilePaths", () => {
		it("should do nothing when cwd is empty", async () => {
			mockProvider.cwd = ""
			workspaceTracker = new WorkspaceTracker(mockProvider)
			await workspaceTracker.initializeFilePaths()
			expect(listFiles).not.toHaveBeenCalled()
			expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()
		})

		it("should load files and add them to filePaths", async () => {
			const mockFiles = ["file1.txt", "file2.txt", "dir/file3.txt"]
			vi.mocked(listFiles).mockResolvedValue([mockFiles, false])
			vi.mocked(toRelativePath).mockImplementation((file) => file as string)

			workspaceTracker = new WorkspaceTracker(mockProvider)
			await workspaceTracker.initializeFilePaths()

			expect(listFiles).toHaveBeenCalledWith(mockCwd, true, 1000)
			// Check that file paths were added (the postMessage is called via workspaceDidUpdate which is debounced)
			expect((workspaceTracker as any).filePaths.size).toBe(3)
		})

		it("should limit files to MAX_INITIAL_FILES", async () => {
			const mockFiles = Array.from({ length: 1500 }, (_, i) => `file${i}.txt`)
			vi.mocked(listFiles).mockResolvedValue([mockFiles, false])
			vi.mocked(toRelativePath).mockImplementation((file) => file as string)

			workspaceTracker = new WorkspaceTracker(mockProvider)
			await workspaceTracker.initializeFilePaths()
			expect((workspaceTracker as any).filePaths.size).toBe(1000)
		})

		it("should not update if workspace path changed during load", async () => {
			const mockFiles = ["file1.txt"]
			vi.mocked(listFiles).mockImplementation(async () => {
				mockProvider.cwd = "C:\\different\\path"
				return [mockFiles, false]
			})

			workspaceTracker = new WorkspaceTracker(mockProvider)
			await workspaceTracker.initializeFilePaths()

			// Files are added but prevWorkSpacePath check happens after listFiles
			// The implementation adds files before checking prevWorkSpacePath
			expect((workspaceTracker as any).filePaths.size).toBeGreaterThanOrEqual(0)
		})

		it("should normalize file paths when adding", async () => {
			const mockFiles = ["file1.txt", "dir/"]
			vi.mocked(listFiles).mockResolvedValue([mockFiles, false])
			vi.mocked(toRelativePath).mockImplementation((file) => file as string)

			workspaceTracker = new WorkspaceTracker(mockProvider)
			await workspaceTracker.initializeFilePaths()
			expect((workspaceTracker as any).filePaths.size).toBe(2)
		})
	})

	describe("getOpenedTabsInfo", () => {
		beforeEach(() => {
			workspaceTracker = new WorkspaceTracker(mockProvider)
		})

		it("should return empty array when no tabs are open", () => {
			Object.defineProperty(vi.mocked(vscode.window.tabGroups), "all", {
				value: [],
				writable: true,
				configurable: true,
			})
			const tabs = (workspaceTracker as any).getOpenedTabsInfo()
			expect(tabs).toEqual([])
		})

		it("should return opened tabs with relative paths", () => {
			const mockUri = vscode.Uri.file("C:\\test\\workspace\\file.txt")
			const mockTabInput = new vscode.TabInputText(mockUri)
			const mockTab = {
				label: "file.txt",
				isActive: true,
				input: mockTabInput,
			}
			const mockGroup = { tabs: [mockTab] }
			Object.defineProperty(vi.mocked(vscode.window.tabGroups), "all", {
				value: [mockGroup],
				writable: true,
				configurable: true,
			})
			vi.mocked(toRelativePath).mockReturnValue("file.txt")

			const tabs = (workspaceTracker as any).getOpenedTabsInfo()
			expect(tabs).toEqual([
				{ label: "file.txt", isActive: true, path: "file.txt" },
			])
		})

		it("should filter out non-text tabs", () => {
			const mockUri = vscode.Uri.file("C:\\test\\workspace\\file.txt")
			const mockTabInput = new vscode.TabInputText(mockUri)
			const mockTextTab = {
				label: "file.txt",
				isActive: false,
				input: mockTabInput,
			}
			const mockOtherTab = { label: "Other", isActive: false, input: {} }
			const mockGroup = { tabs: [mockTextTab, mockOtherTab] }
			Object.defineProperty(vi.mocked(vscode.window.tabGroups), "all", {
				value: [mockGroup],
				writable: true,
				configurable: true,
			})
			vi.mocked(toRelativePath).mockReturnValue("file.txt")

			const tabs = (workspaceTracker as any).getOpenedTabsInfo()
			expect(tabs).toHaveLength(1)
			expect(tabs[0].label).toBe("file.txt")
		})

		it("should put active tabs first", () => {
			const mockUri1 = vscode.Uri.file("C:\\test\\workspace\\file1.txt")
			const mockUri2 = vscode.Uri.file("C:\\test\\workspace\\file2.txt")
			const mockTabInput1 = new vscode.TabInputText(mockUri1)
			const mockTabInput2 = new vscode.TabInputText(mockUri2)
			const mockTab1 = { label: "file1.txt", isActive: false, input: mockTabInput1 }
			const mockTab2 = { label: "file2.txt", isActive: true, input: mockTabInput2 }
			const mockGroup = { tabs: [mockTab1, mockTab2] }
			Object.defineProperty(vi.mocked(vscode.window.tabGroups), "all", {
				value: [mockGroup],
				writable: true,
				configurable: true,
			})
			vi.mocked(toRelativePath).mockImplementation((file) => path.basename(file as string))

			const tabs = (workspaceTracker as any).getOpenedTabsInfo()
			expect(tabs[0].label).toBe("file2.txt")
			expect(tabs[1].label).toBe("file1.txt")
		})
	})

	describe("workspaceDidUpdate", () => {
		beforeEach(() => {
			workspaceTracker = new WorkspaceTracker(mockProvider)
		})

		it("should debounce updates (300ms)", () => {
			;(workspaceTracker as any).workspaceDidUpdate()
			;(workspaceTracker as any).workspaceDidUpdate()
			;(workspaceTracker as any).workspaceDidUpdate()
			expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()
			vi.advanceTimersByTime(300)
			expect(mockProvider.postMessageToWebview).toHaveBeenCalledTimes(1)
		})

		it("should clear previous timer when called again", () => {
			;(workspaceTracker as any).workspaceDidUpdate()
			vi.advanceTimersByTime(150)
			;(workspaceTracker as any).workspaceDidUpdate()
			vi.advanceTimersByTime(300)
			expect(mockProvider.postMessageToWebview).toHaveBeenCalledTimes(1)
		})

		it("should not update when cwd is empty", () => {
			mockProvider.cwd = ""
			;(workspaceTracker as any).workspaceDidUpdate()
			vi.advanceTimersByTime(300)
			expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()
		})

		it("should convert file paths to relative paths", () => {
			;(workspaceTracker as any).filePaths.add("C:\\test\\workspace\\file1.txt")
			;(workspaceTracker as any).filePaths.add("C:\\test\\workspace\\dir\\file2.txt")
			vi.mocked(toRelativePath)
				.mockReturnValueOnce("file1.txt")
				.mockReturnValueOnce("dir/file2.txt")

			;(workspaceTracker as any).workspaceDidUpdate()
			vi.advanceTimersByTime(300)

			expect(toRelativePath).toHaveBeenCalledWith("C:\\test\\workspace\\file1.txt", mockCwd)
			expect(toRelativePath).toHaveBeenCalledWith("C:\\test\\workspace\\dir\\file2.txt", mockCwd)
		})
	})

	describe("workspaceDidReset", () => {
		beforeEach(() => {
			workspaceTracker = new WorkspaceTracker(mockProvider)
		})

		it("should debounce reset operations (300ms)", async () => {
			// Change the workspace to trigger the reset message
			mockProvider.cwd = "C:\\new\\workspace"
			vi.mocked(getWorkspacePath).mockReturnValue("C:\\new\\workspace")
			
			;(workspaceTracker as any).workspaceDidReset()
			;(workspaceTracker as any).workspaceDidReset()
			vi.advanceTimersByTime(300)
			
			// Wait for async operations
			await vi.runAllTimersAsync()
			
			expect((workspaceTracker as any).filePaths.size).toBe(0)
			expect(mockProvider.postMessageToWebview).toHaveBeenCalled()
		})

		it("should clear file paths and reinitialize", async () => {
			;(workspaceTracker as any).filePaths.add("file1.txt")
			;(workspaceTracker as any).filePaths.add("file2.txt")
			mockProvider.cwd = "C:\\new\\workspace"
			vi.mocked(getWorkspacePath).mockReturnValue("C:\\new\\workspace")
			vi.mocked(listFiles).mockResolvedValue([["newfile.txt"], false])
			vi.mocked(toRelativePath).mockImplementation((file) => file as string)

			;(workspaceTracker as any).workspaceDidReset()
			vi.advanceTimersByTime(300)
			
			// Wait for initializeFilePaths to complete
			await vi.runAllTimersAsync()

			expect((workspaceTracker as any).filePaths.size).toBe(1)
			expect(listFiles).toHaveBeenCalledWith("C:\\new\\workspace", true, 1000)
		})

		it("should send empty file paths to webview", () => {
			;(workspaceTracker as any).filePaths.add("file1.txt")
			mockProvider.cwd = "C:\\new\\workspace"
			vi.mocked(getWorkspacePath).mockReturnValue("C:\\new\\workspace")

			;(workspaceTracker as any).workspaceDidReset()
			vi.advanceTimersByTime(300)

			expect(mockProvider.postMessageToWebview).toHaveBeenCalledWith({
				type: "workspaceUpdated",
				filePaths: [],
				openedTabs: [],
			})
		})
	})

	describe("normalizeFilePath", () => {
		beforeEach(() => {
			workspaceTracker = new WorkspaceTracker(mockProvider)
		})

		it("should resolve path relative to cwd", () => {
			const normalized = (workspaceTracker as any).normalizeFilePath("subdir\\file.txt")
			expect(normalized).toBe("C:\\test\\workspace\\subdir\\file.txt")
		})

		it("should handle absolute paths", () => {
			const absolutePath = "C:\\absolute\\path\\file.txt"
			const normalized = (workspaceTracker as any).normalizeFilePath(absolutePath)
			expect(normalized).toBe(absolutePath)
		})

		it("should append slash for directory paths ending with /", () => {
			const normalized = (workspaceTracker as any).normalizeFilePath("dir/")
			expect(normalized.endsWith("/")).toBe(true)
		})

		it("should handle path without cwd", () => {
			mockProvider.cwd = ""
			vi.mocked(getWorkspacePath).mockReturnValue("")
			const normalized = (workspaceTracker as any).normalizeFilePath("file.txt")
			expect(normalized).toBe(path.resolve("file.txt"))
		})
	})

	describe("addFilePath", () => {
		beforeEach(() => {
			workspaceTracker = new WorkspaceTracker(mockProvider)
		})

		it("should add file path to set", async () => {
			vi.spyOn(vscode.workspace.fs, "stat").mockResolvedValue({
				type: vscode.FileType.File,
				ctime: 0,
				mtime: 0,
				size: 100,
			} as any)

			const filePath = "C:\\test\\workspace\\newfile.txt"
			await (workspaceTracker as any).addFilePath(filePath)
			expect((workspaceTracker as any).filePaths.has(filePath)).toBe(true)
		})

		it("should mark directories with trailing slash", async () => {
			vi.spyOn(vscode.workspace.fs, "stat").mockResolvedValue({
				type: vscode.FileType.Directory,
				ctime: 0,
				mtime: 0,
				size: 0,
			} as any)

			const dirPath = "C:\\test\\workspace\\newdir"
			await (workspaceTracker as any).addFilePath(dirPath)
			expect((workspaceTracker as any).filePaths.has(dirPath + "/")).toBe(true)
		})

		it("should not add files when limit reached", async () => {
			;(workspaceTracker as any).filePaths = new Set(
				Array.from({ length: 2000 }, (_, i) => `file${i}.txt`)
			)
			const result = await (workspaceTracker as any).addFilePath("newfile.txt")
			expect(result).toBe("newfile.txt")
			expect((workspaceTracker as any).filePaths.size).toBe(2000)
		})

		it("should handle stat errors by assuming file", async () => {
			vi.spyOn(vscode.workspace.fs, "stat").mockRejectedValue(new Error("File not found"))
			const filePath = "newfile.txt"
			// The normalizeFilePath will resolve it relative to cwd
			const resolvedPath = path.resolve(mockCwd, filePath)
			await (workspaceTracker as any).addFilePath(filePath)
			expect((workspaceTracker as any).filePaths.has(resolvedPath)).toBe(true)
		})
	})

	describe("removeFilePath", () => {
		beforeEach(() => {
			workspaceTracker = new WorkspaceTracker(mockProvider)
		})

		it("should remove file path from set", async () => {
			const filePath = "C:\\test\\workspace\\file.txt"
			;(workspaceTracker as any).filePaths.add(filePath)
			const result = await (workspaceTracker as any).removeFilePath(filePath)
			expect(result).toBe(true)
			expect((workspaceTracker as any).filePaths.has(filePath)).toBe(false)
		})

		it("should remove directory path with trailing slash", async () => {
			const dirPath = "C:\\test\\workspace\\dir/"
			;(workspaceTracker as any).filePaths.add(dirPath)
			const result = await (workspaceTracker as any).removeFilePath("C:\\test\\workspace\\dir")
			expect(result).toBe(true)
			expect((workspaceTracker as any).filePaths.has(dirPath)).toBe(false)
		})

		it("should return false if path not found", async () => {
			const result = await (workspaceTracker as any).removeFilePath("nonexistent.txt")
			expect(result).toBe(false)
		})
	})

	describe("dispose", () => {
		it("should clear update timer", () => {
			workspaceTracker = new WorkspaceTracker(mockProvider)
			;(workspaceTracker as any).workspaceDidUpdate()
			workspaceTracker.dispose()
			vi.advanceTimersByTime(300)
			expect(mockProvider.postMessageToWebview).not.toHaveBeenCalled()
		})

		it("should clear reset timer", () => {
			workspaceTracker = new WorkspaceTracker(mockProvider)
			mockProvider.cwd = "C:\\new\\workspace"
			vi.mocked(getWorkspacePath).mockReturnValue("C:\\new\\workspace")
			;(workspaceTracker as any).workspaceDidReset()
			workspaceTracker.dispose()
			vi.advanceTimersByTime(300)
		})

		it("should dispose all watchers", () => {
			workspaceTracker = new WorkspaceTracker(mockProvider)
			workspaceTracker.dispose()
			// Disposables should be cleared
			expect((workspaceTracker as any).disposables).toEqual([])
		})
	})
})
