import * as vscode from "vscode";
import { IndexingState } from "./state-manager";

/**
 * Defines valid state transitions for the code indexing system
 */
type ValidTransitions = {
  Standby: ("Indexing" | "Migrating" | "Error")[];
  Indexing: ("Indexed" | "Stopping" | "Error")[];
  Migrating: ("Indexed" | "Stopping" | "Error")[];
  Indexed: ("Indexing" | "Migrating" | "Standby")[];
  Stopping: ("Standby")[];
  Error: ("Standby" | "Indexing" | "Migrating")[];
};

/**
 * A finite state machine implementation for code indexing
 */
export class CodeIndexStateMachine {
  private currentState: IndexingState = "Standby";
  private transitions: Map<IndexingState, Set<IndexingState>>;
  private readonly _onStateChange = new vscode.EventEmitter<{ 
    oldState: IndexingState; 
    newState: IndexingState; 
    message?: string 
  }>();
  
  public readonly onStateChange = this._onStateChange.event;

  constructor() {
    this.transitions = new Map();
    this.initializeTransitions();
  }

  private initializeTransitions(): void {
    const validTransitions: ValidTransitions = {
      Standby: ["Indexing", "Error"],
      Indexing: ["Indexed", "Stopping", "Error"],
      Indexed: ["Indexing", "Standby"],
      Stopping: ["Standby"],
      Error: ["Standby", "Indexing"]
    };

    Object.entries(validTransitions).forEach(([from, toStates]) => {
      this.transitions.set(from as IndexingState, new Set(toStates));
    });
  }

  /**
   * Validates if a state transition is allowed
   */
  validateTransition(from: IndexingState, to: IndexingState): boolean {
    const validToStates = this.transitions.get(from);
    return validToStates ? validToStates.has(to) : false;
  }

  /**
   * Transitions to a new state if the transition is valid
   * @param to The target state
   * @param message Optional message to log with the transition
   * @returns boolean indicating if the transition was successful
   */
  transition(to: IndexingState, message?: string): boolean {
    if (!this.validateTransition(this.currentState, to)) {
      console.warn(`[CodeIndexStateMachine] Invalid state transition: ${this.currentState} -> ${to}`);
      return false;
    }

    const oldState = this.currentState;
    this.currentState = to;
    
    console.log(`[CodeIndexStateMachine] State transition: ${oldState} -> ${to}${message ? ` - ${message}` : ''}`);
    
    // Notify listeners of state change
    this._onStateChange.fire({ oldState, newState: to, message });
    
    return true;
  }

  /**
   * Gets the current state
   */
  getState(): IndexingState {
    return this.currentState;
  }

  /**
   * Gets valid transitions from the current state
   */
  getValidTransitions(): IndexingState[] {
    const validToStates = this.transitions.get(this.currentState);
    return validToStates ? Array.from(validToStates) : [];
  }
  
  /**
   * Disposes of the state machine resources
   */
  dispose(): void {
    this._onStateChange.dispose();
  }
}