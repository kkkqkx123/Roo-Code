/**
 * Shared mocks for StreamProcessor tests
 */
import { vi } from "vitest"

// Export a mutable mock function that can be configured in tests
export const mockDetectImpl = vi.fn().mockReturnValue({ detected: false })
