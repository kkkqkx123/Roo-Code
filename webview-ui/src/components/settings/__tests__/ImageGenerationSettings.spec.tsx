import { render } from "@testing-library/react"

import { ImageGenerationSettings } from "../ImageGenerationSettings"
import type { ImageGenerationConfigEntry } from "@coder/types"

// Mock the translation context
vi.mock("@/i18n/TranslationContext", () => ({
	useAppTranslation: () => ({
		t: (key: string) => key,
	}),
}))

describe("ImageGenerationSettings", () => {
	const mockOnChange = vi.fn()
	const mockOnSelectConfig = vi.fn()
	const mockOnDeleteConfig = vi.fn()
	const mockOnRenameConfig = vi.fn()
	const mockOnUpsertConfig = vi.fn()
	const mockOnUpdateConfig = vi.fn()
	const mockOnUpdateApiKey = vi.fn()

	const defaultProps = {
		enabled: false,
		onChange: mockOnChange,
		currentImageGenerationConfigName: undefined,
		listImageGenerationConfigMeta: undefined,
		imageGenerationApiKey: undefined,
		onSelectConfig: mockOnSelectConfig,
		onDeleteConfig: mockOnDeleteConfig,
		onRenameConfig: mockOnRenameConfig,
		onUpsertConfig: mockOnUpsertConfig,
		onUpdateConfig: mockOnUpdateConfig,
		onUpdateApiKey: mockOnUpdateApiKey,
	}

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("Initial Mount Behavior", () => {
		it("should not call setter functions on initial mount with empty configuration", () => {
			render(<ImageGenerationSettings {...defaultProps} />)

			// Should NOT call setter functions on initial mount to prevent dirty state
			expect(mockOnChange).not.toHaveBeenCalled()
			expect(mockOnSelectConfig).not.toHaveBeenCalled()
			expect(mockOnDeleteConfig).not.toHaveBeenCalled()
		})
	})

	describe("Conditional Rendering", () => {
		it("should render config manager when enabled is true", () => {
			const mockConfigs: ImageGenerationConfigEntry[] = [
				{ id: "1", name: "Config 1", provider: "openai", modelId: "gpt-4o" },
			]
			const { container } = render(
				<ImageGenerationSettings
					{...defaultProps}
					enabled={true}
					currentImageGenerationConfigName="Config 1"
					listImageGenerationConfigMeta={mockConfigs}
				/>,
			)

			expect(container.querySelector('[data-testid="config-manager"]')).toBeInTheDocument()
		})

		it("should not render config manager when enabled is false", () => {
			const { container } = render(<ImageGenerationSettings {...defaultProps} enabled={false} />)

			expect(container.querySelector('[data-testid="config-manager"]')).not.toBeInTheDocument()
		})
	})
})
