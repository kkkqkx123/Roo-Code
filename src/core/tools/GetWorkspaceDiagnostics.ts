import path from "path"
import * as vscode from "vscode"
import { Task } from "../task/Task"
import { BaseTool, ToolCallbacks } from "./core/BaseTool"

interface GetWorkspaceDiagnosticsParams {
    targets?: readonly string[]
    severity?: readonly ("error" | "warning" | "information" | "hint")[]
    sources?: readonly string[]
    codes?: readonly (string | number)[]
    maxResults?: number
    includeRelatedInformation?: boolean
    includeTags?: boolean
    sortBy?: "severity" | "file" | "line" | "source"
    summaryOnly?: boolean
}

export class GetWorkspaceDiagnosticsTool extends BaseTool<"get_workspace_diagnostics"> {
    readonly name = "get_workspace_diagnostics" as const

    parseLegacy(params: Partial<Record<string, string>>): GetWorkspaceDiagnosticsParams {
        return {
            targets: params.targets ? JSON.parse(params.targets as string) : undefined,
            severity: params.severity ? JSON.parse(params.severity as string) : undefined,
            sources: params.sources ? JSON.parse(params.sources as string) : undefined,
            codes: params.codes ? JSON.parse(params.codes as string) : undefined,
            maxResults: params.maxResults ? parseInt(params.maxResults as string, 10) : undefined,
            includeRelatedInformation: params.includeRelatedInformation ? params.includeRelatedInformation === 'true' : undefined,
            includeTags: params.includeTags ? params.includeTags === 'true' : undefined,
            sortBy: params.sortBy as any,
            summaryOnly: params.summaryOnly ? params.summaryOnly === 'true' : undefined,
        }
    }

    async execute(params: GetWorkspaceDiagnosticsParams, task: Task, callbacks: ToolCallbacks): Promise<void> {
        const { pushToolResult } = callbacks

        try {
            // 1. 解析目标路径，如果未指定则获取整个工作区
            const uris = await this.resolveTargetUris(params.targets ? [...params.targets] : undefined, task.cwd)

            // 2. 获取所有诊断信息
            const allDiagnostics = vscode.languages.getDiagnostics()

            // 3. 过滤到目标路径的诊断
            const filteredByPath = this.filterByPath(allDiagnostics, uris)

            // 4. 应用过滤条件
            const filteredDiagnostics = this.filterDiagnostics(filteredByPath, params)

            // 5. 应用排序
            const sortedDiagnostics = this.sortDiagnostics(filteredDiagnostics, params.sortBy)

            // 6. 限制结果数量
            const limitedDiagnostics = sortedDiagnostics.slice(0, params.maxResults ?? 100)

            // 7. 格式化输出
            const result = params.summaryOnly
                ? this.formatSummary(limitedDiagnostics, params)
                : this.formatDetailed(limitedDiagnostics, params)

            pushToolResult(JSON.stringify(result, null, 2))

        } catch (error) {
            pushToolResult(JSON.stringify({
                error: `Failed to get workspace diagnostics: ${(error as Error).message}`,
                success: false
            }))
        }
    }

    private async resolveTargetUris(targets: string[] | undefined, cwd: string): Promise<Set<string>> {
        const uris = new Set<string>()

        if (!targets || targets.length === 0) {
            // 如果没有指定目标，返回空集合，表示获取整个工作区
            return uris
        }

        for (const target of targets) {
            const absolutePath = path.resolve(cwd, target)

            try {
                const stat = await this.getFileStat(absolutePath)

                if (stat.isDirectory()) {
                    // 文件夹：递归获取所有文件
                    const files = await this.getAllFilesInDirectory(absolutePath)
                    files.forEach(f => uris.add(vscode.Uri.file(f).toString()))
                } else if (target.includes('*') || target.includes('?') || target.includes('[') || target.includes(']')) {
                    // Glob 模式 - 使用 VS Code 的内置功能
                    const pattern = new vscode.RelativePattern(cwd, target)
                    const matchedFiles = await vscode.workspace.findFiles(pattern, null, 1000)
                    matchedFiles.forEach((uri) => uris.add(uri.toString()))
                } else {
                    // 单个文件
                    uris.add(vscode.Uri.file(absolutePath).toString())
                }
            } catch (error) {
                console.warn(`Could not access path ${absolutePath}: ${(error as Error).message}`)
            }
        }

        return uris
    }

    private async getFileStat(filePath: string): Promise<{ isDirectory(): boolean }> {
        try {
            const fs = await import('fs')
            return fs.statSync(filePath)
        } catch (error) {
            throw new Error(`Cannot access file: ${error}`)
        }
    }

    private async getAllFilesInDirectory(dirPath: string): Promise<string[]> {
        const fs = await import('fs')
        const files: string[] = []

        const dirents = fs.readdirSync(dirPath, { withFileTypes: true })

        for (const dirent of dirents) {
            const fullPath = path.join(dirPath, dirent.name)

            if (dirent.isDirectory()) {
                files.push(...await this.getAllFilesInDirectory(fullPath))
            } else {
                files.push(fullPath)
            }
        }

        return files
    }

    private filterByPath(
        diagnostics: [vscode.Uri, vscode.Diagnostic[]][],
        targetUris: Set<string>
    ): [vscode.Uri, vscode.Diagnostic[]][] {
        if (targetUris.size === 0) {
            // 如果没有指定目标，返回所有诊断
            return diagnostics
        }

        return diagnostics.filter(([uri, _]) => targetUris.has(uri.toString()))
    }

    private filterDiagnostics(
        diagnostics: [vscode.Uri, vscode.Diagnostic[]][],
        params: GetWorkspaceDiagnosticsParams
    ): [vscode.Uri, vscode.Diagnostic[]][] {
        return diagnostics.map(([uri, diags]) => {
            const filtered = diags.filter(diag => {
                // 严重程度过滤
                if (params.severity && !this.matchesSeverity(diag.severity, [...params.severity])) {
                    return false
                }

                // 来源过滤
                if (params.sources && !params.sources.includes(diag.source || '')) {
                    return false
                }

                // 代码过滤
                if (params.codes) {
                    const codeStr = typeof diag.code === 'object' ? String(diag.code?.value) : String(diag.code)
                    if (codeStr && !params.codes.some(code => String(code) === codeStr)) {
                        return false
                    }
                }

                return true
            })

            return [uri, filtered] as [vscode.Uri, vscode.Diagnostic[]]
        }).filter(([_, diags]) => Array.isArray(diags) && diags.length > 0)
    }

    private matchesSeverity(severity: vscode.DiagnosticSeverity, allowedSeverities: string[]): boolean {
        const severityMap: Record<vscode.DiagnosticSeverity, string> = {
            [vscode.DiagnosticSeverity.Error]: 'error',
            [vscode.DiagnosticSeverity.Warning]: 'warning',
            [vscode.DiagnosticSeverity.Information]: 'information',
            [vscode.DiagnosticSeverity.Hint]: 'hint'
        }

        return allowedSeverities.includes(severityMap[severity])
    }

    private sortDiagnostics(
        diagnostics: [vscode.Uri, vscode.Diagnostic[]][],
        sortBy: string | undefined
    ): [vscode.Uri, vscode.Diagnostic[]][] {
        const sorted = [...diagnostics]

        switch (sortBy) {
            case 'severity':
                sorted.sort(([_, diagsA], [__, diagsB]) => {
                    if (diagsA.length === 0 && diagsB.length === 0) return 0
                    if (diagsA.length === 0) return 1
                    if (diagsB.length === 0) return -1
                    const firstA = diagsA[0]
                    const firstB = diagsB[0]
                    if (!firstA || !firstB) return 0
                    return firstB.severity - firstA.severity
                })
                break
            case 'file':
                sorted.sort(([uriA], [uriB]) => uriA.fsPath.localeCompare(uriB.fsPath))
                break
            case 'line':
                sorted.sort(([_, diagsA], [__, diagsB]) => {
                    if (diagsA.length === 0 && diagsB.length === 0) return 0
                    if (diagsA.length === 0) return 1
                    if (diagsB.length === 0) return -1
                    const firstA = diagsA[0]
                    const firstB = diagsB[0]
                    if (!firstA || !firstB) return 0
                    return firstA.range.start.line - firstB.range.start.line
                })
                break
            case 'source':
                sorted.sort(([_, diagsA], [__, diagsB]) => {
                    const sourceA = diagsA[0]?.source || ''
                    const sourceB = diagsB[0]?.source || ''
                    return sourceA.localeCompare(sourceB)
                })
                break
            default:
                // 默认按严重程度排序
                sorted.sort(([_, diagsA], [__, diagsB]) => {
                    if (diagsA.length === 0 && diagsB.length === 0) return 0
                    if (diagsA.length === 0) return 1
                    if (diagsB.length === 0) return -1
                    const firstA = diagsA[0]
                    const firstB = diagsB[0]
                    if (!firstA || !firstB) return 0
                    return firstB.severity - firstA.severity
                })
        }

        return sorted
    }

    private formatDetailed(
        diagnostics: [vscode.Uri, vscode.Diagnostic[]][],
        params: GetWorkspaceDiagnosticsParams
    ) {
        const summary = this.calculateSummary(diagnostics)

        const formattedDiagnostics = diagnostics.flatMap(([uri, diags]) =>
            diags.map(diag => ({
                file: path.relative(params.targets?.[0] || '', uri.fsPath),
                line: diag.range.start.line + 1,
                column: diag.range.start.character + 1,
                severity: this.severityToString(diag.severity),
                source: diag.source || 'unknown',
                code: typeof diag.code === 'object' ? diag.code?.value : diag.code,
                message: diag.message,
                range: {
                    start: { line: diag.range.start.line + 1, character: diag.range.start.character + 1 },
                    end: { line: diag.range.end.line + 1, character: diag.range.end.character + 1 }
                },
                ...(params.includeRelatedInformation && diag.relatedInformation && {
                    relatedInformation: diag.relatedInformation.map(ri => ({
                        location: {
                            file: ri.location.uri.fsPath,
                            range: {
                                start: { line: ri.location.range.start.line + 1, character: ri.location.range.start.character + 1 },
                                end: { line: ri.location.range.end.line + 1, character: ri.location.range.end.character + 1 }
                            }
                        },
                        message: ri.message
                    }))
                }),
                ...(params.includeTags && diag.tags && {
                    tags: diag.tags.map(tag => this.tagToString(tag))
                })
            }))
        )

        return {
            queryInfo: {
                targets: params.targets,
                severity: params.severity,
                timestamp: new Date().toISOString()
            },
            summary,
            diagnostics: formattedDiagnostics
        }
    }

    private formatSummary(
        diagnostics: [vscode.Uri, vscode.Diagnostic[]][],
        params: GetWorkspaceDiagnosticsParams
    ) {
        const summary = this.calculateSummary(diagnostics)

        return {
            queryInfo: {
                targets: params.targets,
                severity: params.severity,
                timestamp: new Date().toISOString()
            },
            summary
        }
    }

    private calculateSummary(diagnostics: [vscode.Uri, vscode.Diagnostic[]][]): any {
        const summary: any = {
            totalDiagnostics: 0,
            bySeverity: { error: 0, warning: 0, information: 0, hint: 0 },
            bySource: {} as Record<string, number>,
            byFileCount: 0
        }

        const files = new Set<string>()

        diagnostics.forEach(([uri, diags]) => {
            files.add(uri.fsPath)

            diags.forEach(diag => {
                summary.totalDiagnostics++

                // Count by severity
                const severityStr = this.severityToString(diag.severity)
                summary.bySeverity[severityStr]++

                // Count by source
                const source = diag.source || 'unknown'
                summary.bySource[source] = (summary.bySource[source] || 0) + 1
            })
        })

        summary.byFileCount = files.size

        return summary
    }

    private severityToString(severity: vscode.DiagnosticSeverity): string {
        switch (severity) {
            case vscode.DiagnosticSeverity.Error: return 'error'
            case vscode.DiagnosticSeverity.Warning: return 'warning'
            case vscode.DiagnosticSeverity.Information: return 'information'
            case vscode.DiagnosticSeverity.Hint: return 'hint'
            default: return 'unknown'
        }
    }

    private tagToString(tag: vscode.DiagnosticTag): string {
        switch (tag) {
            case vscode.DiagnosticTag.Unnecessary: return 'unnecessary'
            case vscode.DiagnosticTag.Deprecated: return 'deprecated'
            default: return 'unknown'
        }
    }
}

export const getWorkspaceDiagnosticsTool = new GetWorkspaceDiagnosticsTool()