import pWaitFor from "p-wait-for"
import * as vscode from "vscode"

import { Task } from "../task/Task"

import { getWorkspacePath } from "../../utils/path"
import { checkGitInstalled } from "../../utils/git"
import { t } from "../../i18n"

import { CheckpointServiceOptions, RepoPerTaskCheckpointService } from "../../services/checkpoints"

const WARNING_THRESHOLD_MS = 5000

/**
 * Send checkpoint initialization warning to webview
 */
function sendCheckpointInitWarn(task: Task, type?: "WAIT_TIMEOUT" | "INIT_TIMEOUT", timeout?: number) {
	task.providerRef.deref()?.postMessageToWebview({
		type: "checkpointInitWarning",
		checkpointWarning: type && timeout ? { type, timeout } : undefined,
	})
}

/**
 * Get or initialize the checkpoint service for a task
 *
 * @param task - The task to get checkpoint service for
 * @param options - Optional configuration
 * @returns The checkpoint service or undefined if not available
 */
export async function getCheckpointService(task: Task, { interval = 250 }: { interval?: number } = {}) {
	if (!task.enableCheckpoints) {
		return undefined
	}

	if (task.checkpointService) {
		return task.checkpointService
	}

	const provider = task.providerRef.deref()

	// Get checkpoint timeout from task settings (converted to milliseconds)
	const checkpointTimeoutMs = task.checkpointTimeout * 1000

	const log = (message: string) => {
		console.log(message)

		try {
			provider?.log(message)
		} catch (err) {
			// NO-OP
		}
	}

	console.log("[Task#getCheckpointService] initializing checkpoints service")

	try {
		const workspaceDir = task.cwd || getWorkspacePath()

		if (!workspaceDir) {
			log("[Task#getCheckpointService] workspace folder not found, disabling checkpoints")
			task.enableCheckpoints = false
			return undefined
		}

		const globalStorageDir = provider?.context.globalStorageUri.fsPath

		if (!globalStorageDir) {
			log("[Task#getCheckpointService] globalStorageDir not found, disabling checkpoints")
			task.enableCheckpoints = false
			return undefined
		}

		const options: CheckpointServiceOptions = {
			taskId: task.taskId,
			workspaceDir,
			shadowDir: globalStorageDir,
			log,
		}

		if (task.checkpointServiceInitializing) {
			const checkpointInitStartTime = Date.now()
			let warningShown = false

			await pWaitFor(
				() => {
					const elapsed = Date.now() - checkpointInitStartTime

					// Show warning if we're past the threshold and haven't shown it yet
					if (!warningShown && elapsed >= WARNING_THRESHOLD_MS) {
						warningShown = true
						sendCheckpointInitWarn(task, "WAIT_TIMEOUT", WARNING_THRESHOLD_MS / 1000)
					}

					console.log(
						`[Task#getCheckpointService] waiting for service to initialize (${Math.round(elapsed / 1000)}s)`,
					)
					return !!task.checkpointService && !!task?.checkpointService?.isInitialized
				},
				{ interval, timeout: checkpointTimeoutMs },
			)
			if (!task?.checkpointService) {
				sendCheckpointInitWarn(task, "INIT_TIMEOUT", task.checkpointTimeout)
				task.enableCheckpoints = false
				return undefined
			} else {
				sendCheckpointInitWarn(task)
			}
			return task.checkpointService
		}

		if (!task.enableCheckpoints) {
			return undefined
		}

		const service = RepoPerTaskCheckpointService.create(options)
		task.checkpointServiceInitializing = true
		await checkGitInstallation(task, service, log, provider)
		task.checkpointService = service
		if (task.enableCheckpoints) {
			sendCheckpointInitWarn(task)
		}
		return service
	} catch (err) {
		if ((err as any)?.name === "TimeoutError" && task.enableCheckpoints) {
			sendCheckpointInitWarn(task, "INIT_TIMEOUT", task.checkpointTimeout)
		}
		log(`[Task#getCheckpointService] ${(err as Error)?.message || String(err)}`)
		task.enableCheckpoints = false
		task.checkpointServiceInitializing = false
		return undefined
	}
}

/**
 * Check Git installation and configure checkpoint service event handlers
 */
async function checkGitInstallation(
	task: Task,
	service: RepoPerTaskCheckpointService,
	log: (message: string) => void,
	provider: any,
) {
	try {
		const gitInstalled = await checkGitInstalled()

		if (!gitInstalled) {
			log("[Task#getCheckpointService] Git is not installed, disabling checkpoints")
			task.enableCheckpoints = false
			task.checkpointServiceInitializing = false

			// Show user-friendly notification
			const selection = await vscode.window.showWarningMessage(
				t("common:errors.git_not_installed"),
				t("common:buttons.learn_more"),
			)

			if (selection === t("common:buttons.learn_more")) {
				await vscode.env.openExternal(vscode.Uri.parse("https://git-scm.com/downloads"))
			}

			return
		}

		// Git is installed, proceed with initialization
		service.on("initialize", () => {
			log("[Task#getCheckpointService] service initialized")
			task.checkpointServiceInitializing = false
		})

		service.on("checkpoint", ({ fromHash: from, toHash: to, suppressMessage }) => {
			try {
				sendCheckpointInitWarn(task)
				// Always update the current checkpoint hash in the webview, including the suppress flag
				provider?.postMessageToWebview({
					type: "currentCheckpointUpdated",
					text: to,
					suppressMessage: !!suppressMessage,
				})

				// Always create the chat message but include the suppress flag in the payload
				// so the chatview can choose not to render it while keeping it in history.
				task.say(
					"checkpoint_saved",
					to,
					undefined,
					undefined,
					{ from, to, suppressMessage: !!suppressMessage },
					undefined,
					{ isNonInteractive: true },
				).catch((err) => {
					log("[Task#getCheckpointService] caught unexpected error in say('checkpoint_saved')")
					console.error(err)
				})
			} catch (err) {
				log("[Task#getCheckpointService] caught unexpected error in on('checkpoint'), disabling checkpoints")
				console.error(err)
				task.enableCheckpoints = false
			}
		})

		log("[Task#getCheckpointService] initializing shadow git")

		try {
			await service.initShadowGit()
		} catch (err) {
			log(`[Task#getCheckpointService] initShadowGit -> ${(err as Error)?.message || String(err)}`)
			task.enableCheckpoints = false
		}
	} catch (err) {
		log(`[Task#getCheckpointService] Unexpected error during Git check: ${(err as Error)?.message || String(err)}`)
		console.error("Git check error:", err)
		task.enableCheckpoints = false
		task.checkpointServiceInitializing = false
	}
}

/**
 * Save a checkpoint for the current task state
 *
 * @param task - The task to save checkpoint for
 * @param force - Whether to allow empty checkpoints
 * @param suppressMessage - Whether to suppress the checkpoint saved message
 * @returns The checkpoint result or undefined if not available
 */
export async function checkpointSave(task: Task, force = false, suppressMessage = false) {
	const service = await getCheckpointService(task)

	if (!service) {
		return
	}

	// Start the checkpoint process in the background.
	return service
		.saveCheckpoint(`Task: ${task.taskId}, Time: ${Date.now()}`, { allowEmpty: force, suppressMessage })
		.catch((err) => {
			console.error("[Task#checkpointSave] caught unexpected error, disabling checkpoints", err)
			task.enableCheckpoints = false
		})
}
