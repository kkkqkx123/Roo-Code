// npx vitest run __tests__/delegation-events.spec.ts

import { CoderEventName, coderEventsSchema, taskEventSchema } from "@coder/types"

describe("delegation event schemas", () => {
	test("coderEventsSchema validates tuples", () => {
		expect(() => (coderEventsSchema.shape as any)[CoderEventName.TaskDelegated].parse(["p", "c"])).not.toThrow()
		expect(() =>
			(coderEventsSchema.shape as any)[CoderEventName.TaskDelegationCompleted].parse(["p", "c", "s"]),
		).not.toThrow()
		expect(() =>
			(coderEventsSchema.shape as any)[CoderEventName.TaskDelegationResumed].parse(["p", "c"]),
		).not.toThrow()

		// invalid shapes
		expect(() => (coderEventsSchema.shape as any)[CoderEventName.TaskDelegated].parse(["p"])).toThrow()
		expect(() =>
			(coderEventsSchema.shape as any)[CoderEventName.TaskDelegationCompleted].parse(["p", "c"]),
		).toThrow()
		expect(() => (coderEventsSchema.shape as any)[CoderEventName.TaskDelegationResumed].parse(["p"])).toThrow()
	})

	test("taskEventSchema discriminated union includes delegation events", () => {
		expect(() =>
			taskEventSchema.parse({
				eventName: CoderEventName.TaskDelegated,
				payload: ["p", "c"],
				taskId: 1,
			}),
		).not.toThrow()

		expect(() =>
			taskEventSchema.parse({
				eventName: CoderEventName.TaskDelegationCompleted,
				payload: ["p", "c", "s"],
				taskId: 1,
			}),
		).not.toThrow()

		expect(() =>
			taskEventSchema.parse({
				eventName: CoderEventName.TaskDelegationResumed,
				payload: ["p", "c"],
				taskId: 1,
			}),
		).not.toThrow()
	})
})
