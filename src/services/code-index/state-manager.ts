import * as vscode from "vscode"
import { CodeIndexStateMachine } from "./state-machine"

export type IndexingState = "Standby" | "Indexing" | "Migrating" | "Indexed" | "Error" | "Stopping"

export class CodeIndexStateManager {
	private _statusMessage: string = ""
	private _processedItems: number = 0
	private _totalItems: number = 0
	private _currentItemUnit: string = "blocks"
	private _progressEmitter = new vscode.EventEmitter<ReturnType<typeof this.getCurrentStatus>>()
	private _stateMachine: CodeIndexStateMachine

	// --- Public API ---

	public readonly onProgressUpdate = this._progressEmitter.event

	public get state(): IndexingState {
		return this._stateMachine.getState()
	}

	public getCurrentStatus() {
		return {
			systemStatus: this._stateMachine.getState(),
			message: this._statusMessage,
			processedItems: this._processedItems,
			totalItems: this._totalItems,
			currentItemUnit: this._currentItemUnit,
		}
	}

	// --- State Management ---

	constructor() {
		this._stateMachine = new CodeIndexStateMachine()
		// Subscribe to state changes to log them
		this._stateMachine.onStateChange(({ oldState, newState, message }) => {
			// Log state transitions for debugging
			console.log(`[CodeIndexStateManager] State transition: ${oldState} -> ${newState}${message ? ` - ${message}` : ''}`)
		})
	}

	public setSystemState(newState: IndexingState, message?: string): void {
		// Attempt the state transition using the state machine
		const transitionSuccessful = this._stateMachine.transition(newState, message)

		// Only update additional state if transition was successful
		if (transitionSuccessful) {
			if (message !== undefined) {
				this._statusMessage = message
			}

			// Reset progress counters if moving to a non-indexing/non-migrating state or starting fresh
			if (newState !== "Indexing" && newState !== "Migrating") {
				this._processedItems = 0
				this._totalItems = 0
				this._currentItemUnit = "blocks" // Reset to default unit
				// Optionally clear the message or set a default for non-indexing states
				if (newState === "Standby" && message === undefined) this._statusMessage = "Ready."
				if (newState === "Indexed" && message === undefined) this._statusMessage = "Index up-to-date."
				if (newState === "Error" && message === undefined) this._statusMessage = "An error occurred."
			}

			this._progressEmitter.fire(this.getCurrentStatus())
		}
	}

	public reportBlockIndexingProgress(processedItems: number, totalItems: number): void {
		const progressChanged = processedItems !== this._processedItems || totalItems !== this._totalItems

		// Don't override Stopping state with progress updates
		if (this._stateMachine.getState() === "Stopping") return
		// Update if progress changes OR if the system wasn't already in 'Indexing' or 'Migrating' state
		if (progressChanged || (this._stateMachine.getState() !== "Indexing" && this._stateMachine.getState() !== "Migrating")) {
			// Attempt state transition using the state machine
			const currentState = this._stateMachine.getState()

			// Determine the target state based on current state
			// If we're in Migrating state, stay in Migrating
			const targetState = currentState === "Migrating" ? "Migrating" : "Indexing"
			const transitionSuccessful = this._stateMachine.transition(targetState,
				`Indexed ${processedItems} / ${totalItems} blocks found`)

			if (transitionSuccessful) {
				this._processedItems = processedItems
				this._totalItems = totalItems
				this._currentItemUnit = "blocks"

				const message = `Indexed ${this._processedItems} / ${this._totalItems} ${this._currentItemUnit} found`
				this._statusMessage = message

				// Only fire update if message or progress actually changed
				if (progressChanged) {
					this._progressEmitter.fire(this.getCurrentStatus())
				}
			} else {
				console.warn(`[CodeIndexStateManager] Invalid transition from ${currentState} to ${targetState} in reportBlockIndexingProgress`)
			}
		}
	}

	public reportFileQueueProgress(processedFiles: number, totalFiles: number, currentFileBasename?: string): void {
		const progressChanged = processedFiles !== this._processedItems || totalFiles !== this._totalItems

		// Don't override Stopping state with progress updates
		if (this._stateMachine.getState() === "Stopping") return
		if (progressChanged || (this._stateMachine.getState() !== "Indexing" && this._stateMachine.getState() !== "Migrating")) {
			// Attempt state transition using the state machine
			const currentState = this._stateMachine.getState()

			// Determine the target state based on current state
			// If we're in Migrating state, stay in Migrating
			const targetState = currentState === "Migrating" ? "Migrating" : "Indexing"

			let message: string
			if (totalFiles > 0 && processedFiles < totalFiles) {
				message = `Processing ${processedFiles} / ${totalFiles} ${this._currentItemUnit}. Current: ${
					currentFileBasename || "..."
				}`
			} else if (totalFiles > 0 && processedFiles === totalFiles) {
				message = `Finished processing ${totalFiles} ${this._currentItemUnit} from queue.`
			} else {
				message = `File queue processed.`
			}

			const transitionSuccessful = this._stateMachine.transition(targetState, message)

			if (transitionSuccessful) {
				this._processedItems = processedFiles
				this._totalItems = totalFiles
				this._currentItemUnit = "files"

				this._statusMessage = message

				if (progressChanged) {
					this._progressEmitter.fire(this.getCurrentStatus())
				}
			} else {
				console.warn(`[CodeIndexStateManager] Invalid transition from ${currentState} to ${targetState} in reportFileQueueProgress`)
			}
		}
	}

	public dispose(): void {
		this._progressEmitter.dispose()
		this._stateMachine.dispose()
	}
}
