#!/usr/bin/env node

/**
 * 测试脚本：支持从根目录直接运行特定测试文件
 *
 * 用法：
 *   pnpm test                              # 全部测试 (Turbo)
 *   pnpm test -- file.spec.ts              # 特定文件 (直接 vitest，跳过 Turbo)
 *   pnpm test -- file.spec.ts -t "pattern" # 特定测试模式 (直接 vitest，跳过 Turbo)
 *   pnpm test -- webview-ui/src/...        # webview-ui 包的测试
 */

import { execSync } from 'child_process'
import process from 'process'
import path from 'path'

// 获取 -- 之后的所有参数
const args = process.argv.slice(2)

// 检查是否有参数
if (args.length === 0) {
	// 没有参数，运行全部测试
	try {
		execSync('turbo test --log-order grouped --output-logs new-only', {
			stdio: 'inherit',
			shell: true
		})
	} catch (error) {
		process.exit(error.status || 1)
	}
} else {
	// 有参数，直接调用 vitest 而不通过 Turbo
	// 这跳过了 Turbo 的冗余信息和全量包测试
	try {
		// 检测目标包：webview-ui 或 src
		// 规范化路径：将反斜杠转换为正斜杠（处理 Windows 路径）
		const firstArg = (args[0] || '').replace(/\\/g, '/')
		const isWebviewUI = firstArg.startsWith('webview-ui/')

		const targetDir = isWebviewUI
			? path.join(process.cwd(), 'webview-ui')
			: path.join(process.cwd(), 'src')

		const vitestBin = path.join(targetDir, 'node_modules/.bin/vitest')

		// 处理参数：将路径转换为相对路径（因为 vitest 在目标目录下执行）
		const processedArgs = args.map(arg => {
			// 规范化路径：将反斜杠转换为正斜杠（处理 Windows 路径）
			let normalizedArg = arg.replace(/\\/g, '/')

			// 消除多个连续的斜杠
			normalizedArg = normalizedArg.replace(/\/+/g, '/')

			// 如果是文件路径参数（不是以 - 开头的选项）
			if (!normalizedArg.startsWith('-') && normalizedArg.includes('/')) {
				if (isWebviewUI) {
					// 移除开头的 webview-ui/ 如果存在
					normalizedArg = normalizedArg.replace(/^webview-ui\//, '')
				} else {
					// 移除开头的 src/ 如果存在
					normalizedArg = normalizedArg.replace(/^src\//, '')
				}
			}

			return normalizedArg
		})

		// 为参数添加引号以保护空格和特殊字符
		const quotedArgs = processedArgs.map(arg => {
			if (arg.includes(' ')) {
				return `"${arg}"`
			}
			return arg
		})
		const testArgs = quotedArgs.join(' ')
		// 在目标目录中执行
		execSync(`${vitestBin} run ${testArgs}`, {
			stdio: 'inherit',
			shell: true,
			cwd: targetDir
		})
	} catch (error) {
		process.exit(error.status || 1)
	}
}
