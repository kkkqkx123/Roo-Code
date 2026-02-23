export interface GitRepositoryInfo {
	repositoryUrl?: string
	repositoryName?: string
	defaultBranch?: string
}

export interface GitCommit {
	hash: string
	shortHash: string
	subject: string
	author: string
	date: string
}

/**
 * GitProperties
 */

export interface GitProperties {
	repositoryInfo?: GitRepositoryInfo
	commit?: GitCommit
}

/**
 * StaticAppProperties
 */

export interface StaticAppProperties {
	appName: string
	appVersion: string
	vscodeVersion: string
	platform: string
	editorName: string
}

/**
 * DynamicAppProperties
 */

export interface DynamicAppProperties {
	language: string
	mode: string
}

/**
 * TaskProperties
 */

export interface TaskProperties {
	taskId?: string
	parentTaskId?: string
	apiProvider?: string
	modelId?: string
	diffStrategy?: string
	isSubtask?: boolean
	todos?: {
		total: number
		completed: number
		inProgress: number
		pending: number
	}
}
