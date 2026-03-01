# Command Deny Reason Enhancement Design

## 1. Problem Statement

### 1.1 Current Issue

The current auto-reject configuration for commands has a critical flaw: when a command is auto-denied without providing a reason, the LLM tends to circumvent the restriction by executing equivalent operations through alternative means. This defeats the purpose of the denylist feature.

**Example scenarios:**
- `git reset` is denied → LLM suggests manually deleting branches or force-pushing
- `head` command is denied → LLM suggests using `sed -n '1,10p'` instead
- `rm -rf` is denied → LLM suggests using file write tools to truncate files

### 1.2 Root Cause

The current implementation returns a simple `"auto_deny"` decision without context. The LLM receives no explanation for _why_ a command is denied, leading it to:
1. Assume the restriction is arbitrary
2. Attempt to find workarounds to achieve the same goal
3. Potentially execute more dangerous operations in the process

## 2. Proposed Solution

Extend the denylist configuration to include **rejection reasons** that are:
1. **Attached to the tool execution result** when a command is denied
2. **Clearly communicated to the LLM** explaining the restriction rationale
3. **Actionable** - suggesting alternative approaches or requiring user intervention

### 2.1 Design Goals

- **Transparency**: LLM understands _why_ a command is denied
- **Guidance**: Provide safe alternatives or escalation paths
- **Flexibility**: Support different reason categories (technical limitation, safety policy, etc.)
- **UI Consistency**: Match existing code-index allowed projects UI pattern

## 3. Implementation Design

### 3.1 Data Structure Changes

#### 3.1.1 Configuration Schema Extension

**Current:**
```typescript
deniedCommands?: string[]
```

**Proposed:**
```typescript
interface DeniedCommandEntry {
  pattern: string           // Command prefix pattern
  reason: string            // Reason shown to LLM (stored in English)
  reasonI18nKey?: string    // Optional i18n key for UI translation
  suggestion?: string       // Optional alternative approach
}

deniedCommands?: (string | DeniedCommandEntry)[]
```

**Backward Compatibility:** String entries are automatically converted to entries with default reasons.

#### 3.1.2 Command Decision Result Extension

**Current:**
```typescript
export type CommandDecision = "auto_approve" | "auto_deny" | "ask_user"
```

**Proposed:**
```typescript
interface CommandDecisionResult {
  decision: "auto_approve" | "auto_deny" | "ask_user"
  reason?: string           // Denial reason (if denied)
  suggestion?: string       // Alternative approach (optional)
  matchedPattern?: string   // Which pattern matched
}
```

### 3.2 Backend Changes

#### 3.2.1 File: `src/core/auto-approval/commands.ts`

**Changes:**
1. Extend `getCommandDecision()` to return structured result with reason
2. Update `getSingleCommandDecision()` to include matched pattern
3. Add reason lookup logic based on matched denylist entry

```typescript
export interface CommandDecisionResult {
  decision: "auto_approve" | "auto_deny" | "ask_user"
  reason?: string
  suggestion?: string
  matchedPattern?: string
}

export function getCommandDecision(
  command: string,
  allowedCommands: (string | DeniedCommandEntry)[],
  deniedCommands?: (string | DeniedCommandEntry)[],
): CommandDecisionResult {
  // ... existing logic ...
  
  if (isAutoDenied) {
    const deniedEntry = findDeniedEntry(deniedCommands, matchedPattern)
    return {
      decision: "auto_deny",
      reason: deniedEntry?.reason || getDefaultDenialReason(matchedPattern),
      suggestion: deniedEntry?.suggestion,
      matchedPattern
    }
  }
}
```

#### 3.2.2 File: `src/core/auto-approval/index.ts`

**Changes:**
1. Update `checkAutoApproval()` to handle structured denial result
2. Pass denial reason to `denyAsk()` method

```typescript
if (ask === "command") {
  if (!text) {
    return { decision: "ask" }
  }

  if (state.alwaysAllowExecute === true) {
    const result = getCommandDecision(text, state.allowedCommands || [], state.deniedCommands || [])

    if (result.decision === "auto_approve") {
      return { decision: "approve" }
    } else if (result.decision === "auto_deny") {
      return { 
        decision: "deny",
        reason: result.reason,
        suggestion: result.suggestion
      }
    } else {
      return { decision: "ask" }
    }
  }
}
```

#### 3.2.3 File: `src/core/task/Task.ts`

**Changes:**
1. Update `denyAsk()` to accept and store reason
2. Include reason in the tool response sent to LLM

```typescript
public denyAsk(options: { 
  text?: string
  images?: string[]
  reason?: string
  suggestion?: string
} = {}) {
  this.handleWebviewAskResponse(
    "noButtonClicked", 
    options.text, 
    options.images,
    options.reason,
    options.suggestion
  )
}
```

#### 3.2.4 File: `src/core/tools/executeCommandTool.ts`

**Changes:**
1. Capture denial reason from approval flow
2. Format and return denial message with reason to LLM

```typescript
const didApprove = await askApproval("command", canonicalCommand)

if (!didApprove) {
  // Include denial reason in result
  const denialMessage = buildDenialMessage(approval.reason, approval.suggestion)
  pushToolResult(denialMessage)
  return
}
```

### 3.3 Frontend Changes (Webview UI)

#### 3.3.1 File: `webview-ui/src/components/settings/AutoApproveSettings.tsx`

**Changes:**
1. Transform denied commands list into table/list format
2. Add reason input field for each denied command
3. Add optional suggestion field
4. Reference code-index allowed projects UI pattern

**UI Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│ Denied Commands                                              │
├─────────────────────────────────────────────────────────────┤
│ [Add Command] [Add with Reason]                             │
├─────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ git reset                                    [Remove]   │ │
│ │ Reason: This will rewrite git history. Use...           │ │
│ │ Suggestion: Use 'git revert' instead for safe undo.     │ │
│ └─────────────────────────────────────────────────────────┘ │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ rm -rf                                       [Remove]   │ │
│ │ Reason: Dangerous recursive delete operation.           │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Component Structure:**
```tsx
interface DeniedCommandEntry {
  pattern: string
  reason: string
  suggestion?: string
}

// New list-based UI component
<div className="space-y-2">
  {(deniedCommands ?? []).map((entry, index) => (
    <div key={index} className="p-3 border border-vscode-dropdown-border rounded-md bg-vscode-input-background">
      <div className="flex items-center justify-between mb-2">
        <code className="text-sm font-mono">{entry.pattern}</code>
        <Button variant="ghost" size="sm" onClick={() => removeEntry(index)}>
          <X className="w-4 h-4" />
        </Button>
      </div>
      <div className="text-xs text-vscode-descriptionForeground mb-1">
        <strong>Reason:</strong> {entry.reason}
      </div>
      {entry.suggestion && (
        <div className="text-xs text-vscode-descriptionForeground">
          <strong>Alternative:</strong> {entry.suggestion}
        </div>
      )}
    </div>
  ))}
</div>
```

#### 3.3.2 File: `webview-ui/src/i18n/locales/en/settings.json`

**Add new translation keys:**
```json
{
  "autoApprove": {
    "execute": {
      "deniedCommandReasonLabel": "Denial Reason",
      "deniedCommandReasonPlaceholder": "Explain why this command is denied",
      "deniedCommandSuggestionLabel": "Alternative (Optional)",
      "deniedCommandSuggestionPlaceholder": "Suggest a safe alternative",
      "addWithReasonButton": "Add with Reason"
    }
  }
}
```

### 3.4 Type Definitions

#### 3.4.1 File: `packages/types/src/global-settings.ts`

```typescript
export interface DeniedCommandEntry {
  pattern: string
  reason: string
  reasonI18nKey?: string
  suggestion?: string
}

export const globalSettingsSchema = z.object({
  // ... existing fields ...
  deniedCommands: z.array(
    z.union([
      z.string(),
      z.object({
        pattern: z.string(),
        reason: z.string(),
        reasonI18nKey: z.string().optional(),
        suggestion: z.string().optional()
      })
    ])
  ).optional()
})
```

#### 3.4.2 File: `packages/types/src/vscode-extension-host/webview-messages.ts`

```typescript
export type ClineAskResponse = 
  | "yesButtonClicked"
  | "noButtonClicked"
  | "messageResponse"
  | "failed"
  | "rejected"

export interface WebviewAskResponse {
  response: ClineAskResponse
  text?: string
  images?: string[]
  reason?: string        // New: denial reason
  suggestion?: string    // New: alternative suggestion
}
```

## 4. Default Denial Reasons Library

Provide pre-defined reasons for common dangerous commands:

| Command Pattern | Reason | Suggestion |
|----------------|--------|------------|
| `rm -rf` | "Dangerous recursive delete operation that can cause irreversible data loss." | "Use file explorer to delete specific files, or use version control to manage cleanup." |
| `git reset --hard` | "This command rewrites git history and discards uncommitted changes permanently." | "Use 'git revert' to safely undo commits, or 'git stash' to temporarily save changes." |
| `:(){ :|:& };:` | "Fork bomb detected - this creates infinite processes and will crash the system." | "This command should never be executed. It is malicious." |
| `mkfs` | "This command formats disk partitions and will destroy all data on the target device." | "Use file-level operations instead. Disk formatting requires manual user confirmation." |
| `dd if=/dev/zero` | "Low-level disk write operation that can overwrite critical system data." | "Use file creation tools for legitimate data writing needs." |
| `chmod -R 777` | "Grants full permissions recursively, creating severe security vulnerabilities." | "Use specific permission values based on actual requirements (e.g., 755 for directories, 644 for files)." |
| `head` (when bash unavailable) | "The 'head' command is not available in the current shell environment." | "Use 'sed -n '1,10p'' or 'awk 'NR<=10'' to view the first lines of a file." |

## 5. LLM Prompt Integration

### 5.1 System Prompt Enhancement

Add guidance about command restrictions to mode role definitions:

```
When a command is denied, you will receive a denial reason explaining why. 
You must:
1. Acknowledge the restriction
2. NOT attempt to circumvent it via alternative commands
3. Either:
   - Use the suggested alternative if provided
   - Ask the user for manual intervention if the operation is necessary
   - Propose a different approach that achieves the goal safely
```

### 5.2 Tool Response Format

When a command is denied, the tool response includes:

```
[Command Denied: git reset --hard HEAD~1]

Reason: This command rewrites git history and discards uncommitted changes permanently.

Suggested Alternative: Use 'git revert' to safely undo commits, or 'git stash' to temporarily save changes.

Please choose an alternative approach or ask the user for manual assistance.
```

## 6. Migration Strategy

### 6.1 Backward Compatibility

1. **String → Object Migration**: Existing string entries in `deniedCommands` are automatically wrapped:
   ```typescript
   function migrateDeniedCommands(commands: (string | DeniedCommandEntry)[]): DeniedCommandEntry[] {
     return commands.map(cmd => 
       typeof cmd === 'string' 
         ? { pattern: cmd, reason: getDefaultDenialReason(cmd) }
         : cmd
     )
   }
   ```

2. **Default Reasons**: Commands without explicit reasons get context-aware defaults based on pattern matching.

### 6.2 Configuration Upgrade

Add migration logic in `ConfigurationService.ts`:

```typescript
private migrateDeniedCommands(): void {
  const commands = this.globalState.get<string[]>('deniedCommands')
  if (commands && commands.length > 0) {
    const migrated = commands.map(pattern => ({
      pattern,
      reason: this.getDefaultDenialReason(pattern)
    }))
    this.globalState.update('deniedCommands', migrated)
  }
}
```

## 7. Testing Strategy

### 7.1 Unit Tests

**File: `src/core/auto-approval/__tests__/commands.spec.ts`**

```typescript
describe("getCommandDecision with reasons", () => {
  it("should return denial reason for explicitly denied commands", () => {
    const deniedCommands = [
      { pattern: "git reset", reason: "Rewrites history", suggestion: "Use git revert" }
    ]
    
    const result = getCommandDecision("git reset --hard", [], deniedCommands)
    
    expect(result.decision).toBe("auto_deny")
    expect(result.reason).toBe("Rewrites history")
    expect(result.suggestion).toBe("Use git revert")
  })

  it("should handle backward-compatible string entries", () => {
    const deniedCommands = ["rm -rf"]
    
    const result = getCommandDecision("rm -rf /tmp", [], deniedCommands)
    
    expect(result.decision).toBe("auto_deny")
    expect(result.reason).toBeDefined()
  })
})
```

### 7.2 Integration Tests

1. Test full flow: command execution → denial → reason display → LLM receives message
2. Test UI: add/edit/remove denied commands with reasons
3. Test migration: existing configs upgrade correctly

### 7.3 E2E Tests

1. User adds `git reset` with custom reason
2. LLM attempts to execute `git reset --hard`
3. Verify LLM receives denial with reason
4. Verify LLM does not attempt workaround

## 8. Implementation Phases

### Phase 1: Core Backend (Week 1)
- [ ] Extend type definitions
- [ ] Update `getCommandDecision()` to return structured results
- [ ] Update `checkAutoApproval()` to propagate reasons
- [ ] Update `denyAsk()` to accept and store reasons

### Phase 2: Tool Integration (Week 1)
- [ ] Update `executeCommandTool.ts` to format denial messages
- [ ] Test LLM receives and processes denial reasons
- [ ] Add default reason library

### Phase 3: Frontend UI (Week 2)
- [ ] Redesign denied commands UI to match code-index pattern
- [ ] Add reason/suggestion input fields
- [ ] Add translation keys
- [ ] Test backward compatibility migration

### Phase 4: Documentation & Testing (Week 2)
- [ ] Write unit/integration tests
- [ ] Update user documentation
- [ ] Add LLM prompt guidance
- [ ] Perform security review

## 9. Success Metrics

1. **LLM Behavior**: LLM acknowledges denial reasons and does not attempt workarounds in >90% of test cases
2. **User Experience**: Users can easily configure denial reasons via intuitive UI
3. **Backward Compatibility**: Existing configurations work without manual migration
4. **Safety**: Reduction in dangerous command circumvention attempts

## 10. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| LLM ignores reasons | High | Include in system prompt, test extensively |
| UI complexity | Medium | Keep design simple, match existing patterns |
| Migration issues | Low | Automatic migration with fallback to defaults |
| Performance overhead | Low | Reason lookup is O(n) with small n (<50 entries) |

## 11. Related Files

### Backend
- `src/core/auto-approval/commands.ts` - Core decision logic
- `src/core/auto-approval/index.ts` - Auto-approval handler
- `src/core/task/Task.ts` - Ask response handling
- `src/core/tools/executeCommandTool.ts` - Command execution
- `src/core/webview/ConfigurationService.ts` - Config migration

### Frontend
- `webview-ui/src/components/settings/AutoApproveSettings.tsx` - Settings UI
- `webview-ui/src/i18n/locales/en/settings.json` - Translations

### Types
- `packages/types/src/global-settings.ts` - Settings schema
- `packages/types/src/vscode-extension-host/webview-messages.ts` - Message types
