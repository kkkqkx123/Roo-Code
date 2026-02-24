import { Task } from "../Task"
import { TaskOptions } from "../Task"

/**
 * Task工厂类
 * 提供创建和启动任务的静态方法
 */
export class TaskFactory {
	/**
	 * 创建任务实例并返回任务和启动Promise
	 *
	 * @param options - 任务选项
	 * @returns 包含任务实例和启动Promise的元组
	 */
	static create(options: TaskOptions): [Task, Promise<void>] {
		const instance = new Task({ ...options, startTask: false })
		const { images, task, historyItem } = options
		let promise

		if (images || task) {
			promise = instance.startTask(task, images)
		} else if (historyItem) {
			promise = instance.resumeTaskFromHistory()
		} else {
			throw new Error("Either historyItem or task/images must be provided")
		}

		return [instance, promise]
	}

	/**
	 * 创建任务实例（不自动启动）
	 *
	 * @param options - 任务选项
	 * @returns 任务实例
	 */
	static createInstance(options: TaskOptions): Task {
		return new Task({ ...options, startTask: false })
	}

	/**
	 * 创建并启动任务
	 *
	 * @param options - 任务选项
	 * @returns 包含任务实例和启动Promise的元组
	 */
	static createAndStart(options: TaskOptions): [Task, Promise<void>] {
		return this.create(options)
	}
}