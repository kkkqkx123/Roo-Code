#!/usr/bin/env node

/**
 * 测试脚本：支持从根目录直接运行特定测试文件
 *
 * 用法：
 *   pnpm test                              # 全部测试 (Turbo)
 *   pnpm test -- file.spec.ts              # 特定文件 (直接 vitest，跳过 Turbo)
 *   pnpm test -- file.spec.ts -t "pattern" # 特定测试模式 (直接 vitest，跳过 Turbo)
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
		const srcDir = path.join(process.cwd(), 'src')
		const vitestBin = path.join(srcDir, 'node_modules/.bin/vitest')
		
		// 处理参数：将 src/ 开头的路径转换为相对路径（因为 vitest 在 src 目录下执行）
		const processedArgs = args.map(arg => {
			// 如果是文件路径参数（不是以 - 开头的选项）
			if (!arg.startsWith('-') && arg.includes('/')) {
				// 移除开头的 src/ 如果存在
				return arg.replace(/^src\//, '')
			}
			return arg
		})
		
		const testArgs = processedArgs.join(' ')
		// 在 src 目录中执行，使用相对路径的配置文件
		execSync(`${vitestBin} run ${testArgs}`, {
			stdio: 'inherit',
			shell: true,
			cwd: srcDir
		})
	} catch (error) {
		process.exit(error.status || 1)
	}
}
