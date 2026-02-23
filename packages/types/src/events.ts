import { z } from "zod"

import { clineMessageSchema, queuedMessageSchema, tokenUsageSchema } from "./message.js"
import { modelInfoSchema } from "./model.js"
import { toolNamesSchema, toolUsageSchema } from "./tool.js"

/**
 * CoderEventName
 */

export enum CoderEventName {
	// Task Provider Lifecycle
	TaskCreated = "taskCreated",

	// Task Lifecycle
	TaskStarted = "taskStarted",
	TaskCompleted = "taskCompleted",
	TaskAborted = "taskAborted",
	TaskFocused = "taskFocused",
	TaskUnfocused = "taskUnfocused",
	TaskActive = "taskActive",
	TaskInteractive = "taskInteractive",
	TaskResumable = "taskResumable",
	TaskIdle = "taskIdle",

	// Subtask Lifecycle
	TaskPaused = "taskPaused",
	TaskUnpaused = "taskUnpaused",
	TaskSpawned = "taskSpawned",
	TaskDelegated = "taskDelegated",
	TaskDelegationCompleted = "taskDelegationCompleted",
	TaskDelegationResumed = "taskDelegationResumed",

	// Task Execution
	Message = "message",
	TaskModeSwitched = "taskModeSwitched",
	TaskAskResponded = "taskAskResponded",
	TaskUserMessage = "taskUserMessage",
	QueuedMessagesUpdated = "queuedMessagesUpdated",

	// Task Analytics
	TaskTokenUsageUpdated = "taskTokenUsageUpdated",
	TaskToolFailed = "taskToolFailed",

	// Configuration Changes
	ModeChanged = "modeChanged",
	ProviderProfileChanged = "providerProfileChanged",

	// Query Responses
	CommandsResponse = "commandsResponse",
	ModesResponse = "modesResponse",
	ModelsResponse = "modelsResponse",

	// Evals
	EvalPass = "evalPass",
	EvalFail = "evalFail",
}

/**
 * CoderEvents
 */

export const coderEventsSchema = z.object({
	[CoderEventName.TaskCreated]: z.tuple([z.string()]),

	[CoderEventName.TaskStarted]: z.tuple([z.string()]),
	[CoderEventName.TaskCompleted]: z.tuple([
		z.string(),
		tokenUsageSchema,
		toolUsageSchema,
		z.object({
			isSubtask: z.boolean(),
		}),
	]),
	[CoderEventName.TaskAborted]: z.tuple([z.string()]),
	[CoderEventName.TaskFocused]: z.tuple([z.string()]),
	[CoderEventName.TaskUnfocused]: z.tuple([z.string()]),
	[CoderEventName.TaskActive]: z.tuple([z.string()]),
	[CoderEventName.TaskInteractive]: z.tuple([z.string()]),
	[CoderEventName.TaskResumable]: z.tuple([z.string()]),
	[CoderEventName.TaskIdle]: z.tuple([z.string()]),

	[CoderEventName.TaskPaused]: z.tuple([z.string()]),
	[CoderEventName.TaskUnpaused]: z.tuple([z.string()]),
	[CoderEventName.TaskSpawned]: z.tuple([z.string(), z.string()]),
	[CoderEventName.TaskDelegated]: z.tuple([
		z.string(), // parentTaskId
		z.string(), // childTaskId
	]),
	[CoderEventName.TaskDelegationCompleted]: z.tuple([
		z.string(), // parentTaskId
		z.string(), // childTaskId
		z.string(), // completionResultSummary
	]),
	[CoderEventName.TaskDelegationResumed]: z.tuple([
		z.string(), // parentTaskId
		z.string(), // childTaskId
	]),

	[CoderEventName.Message]: z.tuple([
		z.object({
			taskId: z.string(),
			action: z.union([z.literal("created"), z.literal("updated")]),
			message: clineMessageSchema,
		}),
	]),
	[CoderEventName.TaskModeSwitched]: z.tuple([z.string(), z.string()]),
	[CoderEventName.TaskAskResponded]: z.tuple([z.string()]),
	[CoderEventName.TaskUserMessage]: z.tuple([z.string()]),
	[CoderEventName.QueuedMessagesUpdated]: z.tuple([z.string(), z.array(queuedMessageSchema)]),

	[CoderEventName.TaskToolFailed]: z.tuple([z.string(), toolNamesSchema, z.string()]),
	[CoderEventName.TaskTokenUsageUpdated]: z.tuple([z.string(), tokenUsageSchema, toolUsageSchema]),

	[CoderEventName.ModeChanged]: z.tuple([z.string()]),
	[CoderEventName.ProviderProfileChanged]: z.tuple([z.object({ name: z.string(), provider: z.string() })]),

	[CoderEventName.CommandsResponse]: z.tuple([
		z.array(
			z.object({
				name: z.string(),
				source: z.enum(["global", "project", "built-in"]),
				filePath: z.string().optional(),
				description: z.string().optional(),
				argumentHint: z.string().optional(),
			}),
		),
	]),
	[CoderEventName.ModesResponse]: z.tuple([z.array(z.object({ slug: z.string(), name: z.string() }))]),
	[CoderEventName.ModelsResponse]: z.tuple([z.record(z.string(), modelInfoSchema)]),
})

export type CoderEvents = z.infer<typeof coderEventsSchema>

/**
 * TaskEvent
 */

export const taskEventSchema = z.discriminatedUnion("eventName", [
	// Task Provider Lifecycle
	z.object({
		eventName: z.literal(CoderEventName.TaskCreated),
		payload: coderEventsSchema.shape[CoderEventName.TaskCreated],
		taskId: z.number().optional(),
	}),

	// Task Lifecycle
	z.object({
		eventName: z.literal(CoderEventName.TaskStarted),
		payload: coderEventsSchema.shape[CoderEventName.TaskStarted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.TaskCompleted),
		payload: coderEventsSchema.shape[CoderEventName.TaskCompleted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.TaskAborted),
		payload: coderEventsSchema.shape[CoderEventName.TaskAborted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.TaskFocused),
		payload: coderEventsSchema.shape[CoderEventName.TaskFocused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.TaskUnfocused),
		payload: coderEventsSchema.shape[CoderEventName.TaskUnfocused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.TaskActive),
		payload: coderEventsSchema.shape[CoderEventName.TaskActive],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.TaskInteractive),
		payload: coderEventsSchema.shape[CoderEventName.TaskInteractive],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.TaskResumable),
		payload: coderEventsSchema.shape[CoderEventName.TaskResumable],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.TaskIdle),
		payload: coderEventsSchema.shape[CoderEventName.TaskIdle],
		taskId: z.number().optional(),
	}),

	// Subtask Lifecycle
	z.object({
		eventName: z.literal(CoderEventName.TaskPaused),
		payload: coderEventsSchema.shape[CoderEventName.TaskPaused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.TaskUnpaused),
		payload: coderEventsSchema.shape[CoderEventName.TaskUnpaused],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.TaskSpawned),
		payload: coderEventsSchema.shape[CoderEventName.TaskSpawned],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.TaskDelegated),
		payload: coderEventsSchema.shape[CoderEventName.TaskDelegated],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.TaskDelegationCompleted),
		payload: coderEventsSchema.shape[CoderEventName.TaskDelegationCompleted],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.TaskDelegationResumed),
		payload: coderEventsSchema.shape[CoderEventName.TaskDelegationResumed],
		taskId: z.number().optional(),
	}),

	// Task Execution
	z.object({
		eventName: z.literal(CoderEventName.Message),
		payload: coderEventsSchema.shape[CoderEventName.Message],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.TaskModeSwitched),
		payload: coderEventsSchema.shape[CoderEventName.TaskModeSwitched],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.TaskAskResponded),
		payload: coderEventsSchema.shape[CoderEventName.TaskAskResponded],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.QueuedMessagesUpdated),
		payload: coderEventsSchema.shape[CoderEventName.QueuedMessagesUpdated],
		taskId: z.number().optional(),
	}),

	// Task Analytics
	z.object({
		eventName: z.literal(CoderEventName.TaskToolFailed),
		payload: coderEventsSchema.shape[CoderEventName.TaskToolFailed],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.TaskTokenUsageUpdated),
		payload: coderEventsSchema.shape[CoderEventName.TaskTokenUsageUpdated],
		taskId: z.number().optional(),
	}),

	// Query Responses
	z.object({
		eventName: z.literal(CoderEventName.CommandsResponse),
		payload: coderEventsSchema.shape[CoderEventName.CommandsResponse],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.ModesResponse),
		payload: coderEventsSchema.shape[CoderEventName.ModesResponse],
		taskId: z.number().optional(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.ModelsResponse),
		payload: coderEventsSchema.shape[CoderEventName.ModelsResponse],
		taskId: z.number().optional(),
	}),

	// Evals
	z.object({
		eventName: z.literal(CoderEventName.EvalPass),
		payload: z.undefined(),
		taskId: z.number(),
	}),
	z.object({
		eventName: z.literal(CoderEventName.EvalFail),
		payload: z.undefined(),
		taskId: z.number(),
	}),
])

export type TaskEvent = z.infer<typeof taskEventSchema>
