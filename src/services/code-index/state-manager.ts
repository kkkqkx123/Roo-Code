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
			// Update message only if provided
			if (message !== undefined) {
				this._statusMessage = message
			} else {
				// Set default messages for specific states
				if (newState === "Standby") {
					this._statusMessage = "Ready."
				} else if (newState === "Indexed") {
					this._statusMessage = "Index up-to-date."
				} else if (newState === "Error") {
					this._statusMessage = "An error occurred."
				}
				// For other states, keep existing message or leave empty
			}

			// Reset progress counters when moving to completion or error states
			// but not when transitioning through Stopping state
			if ((newState !== "Indexing" && newState !== "Migrating" && newState !== "Stopping")) {
				this._processedItems = 0
				this._totalItems = 0
				this._currentItemUnit = "blocks" // Reset to default unit
			}

			this._progressEmitter.fire(this.getCurrentStatus())
		}
	}

	public reportBlockIndexingProgress(processedItems: number, totalItems: number): void {
		const progressChanged = processedItems !== this._processedItems || totalItems !== this._totalItems

		// Don't override Stopping state with progress updates
		if (this._stateMachine.getState() === "Stopping") return
		
		const currentState = this._stateMachine.getState()
		const isIndexingOrMigrating = currentState === "Indexing" || currentState === "Migrating"

		// Update if progress changes OR if the system wasn't already in 'Indexing' or 'Migrating' state
		if (progressChanged || !isIndexingOrMigrating) {
			// Determine the target state based on current state
			// If we're in Migrating state, stay in Migrating
			const targetState = currentState === "Migrating" ? "Migrating" : "Indexing"
			
			// Only attempt transition if we're not already in the target state
			if (currentState !== targetState) {
				const transitionSuccessful = this._stateMachine.transition(targetState,
					`Indexed ${processedItems} / ${totalItems} blocks found`)
				
				if (!transitionSuccessful) {
					console.warn(`[CodeIndexStateManager] Invalid transition from ${currentState} to ${targetState} in reportBlockIndexingProgress`)
					return
				}
			}

			this._processedItems = processedItems
			this._totalItems = totalItems
			this._currentItemUnit = "blocks"

			const message = `Indexed ${this._processedItems} / ${this._totalItems} ${this._currentItemUnit} found`
			this._statusMessage = message

			// Only fire update if progress actually changed
			if (progressChanged) {
				this._progressEmitter.fire(this.getCurrentStatus())
			}
		}
	}

	public reportFileQueueProgress(processedFiles: number, totalFiles: number, currentFileBasename?: string): void {
		const progressChanged = processedFiles !== this._processedItems || totalFiles !== this._totalItems

		// Don't override Stopping state with progress updates
		if (this._stateMachine.getState() === "Stopping") return
		
		const currentState = this._stateMachine.getState()
		const isIndexingOrMigrating = currentState === "Indexing" || currentState === "Migrating"

		if (progressChanged || !isIndexingOrMigrating) {
			// Determine the target state based on current state
			// If we're in Migrating state, stay in Migrating
			const targetState = currentState === "Migrating" ? "Migrating" : "Indexing"

			let message: string
			if (totalFiles > 0 && processedFiles < totalFiles) {
				message = `Processing ${processedFiles} / ${totalFiles} files. Current: ${
					currentFileBasename || "..."
				}`
			} else if (totalFiles > 0 && processedFiles === totalFiles) {
				message = `Finished processing ${totalFiles} files from queue.`
			} else {
				message = `File queue processed.`
			}

			// Only attempt transition if we're not already in the target state
			if (currentState !== targetState) {
				const transitionSuccessful = this._stateMachine.transition(targetState, message)
				if (!transitionSuccessful) {
					console.warn(`[CodeIndexStateManager] Invalid transition from ${currentState} to ${targetState} in reportFileQueueProgress`)
					return
				}
			}

			this._processedItems = processedFiles
			this._totalItems = totalFiles
			this._currentItemUnit = "files"

			this._statusMessage = message

			if (progressChanged) {
				this._progressEmitter.fire(this.getCurrentStatus())
			}
		}
	}

	public dispose(): void {
		this._progressEmitter.dispose()
		this._stateMachine.dispose()
	}
}
