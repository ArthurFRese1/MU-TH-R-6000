import { describe, expect, it } from 'vitest'
import { nextWorkspaceMode } from './workspace-mode'

describe('nextWorkspaceMode', () => {
  it('opens the crew context for anonymous player sessions', () => {
    expect(nextWorkspaceMode('command', 'SIGNED_IN', true)).toBe('crew')
  })

  it('opens the command context for a registered account sign-in', () => {
    expect(nextWorkspaceMode('crew', 'SIGNED_IN', false)).toBe('command')
  })

  it('keeps the selected role when a registered session refreshes', () => {
    expect(nextWorkspaceMode('crew', 'TOKEN_REFRESHED', false)).toBe('crew')
  })

  it('returns to command after sign-out', () => {
    expect(nextWorkspaceMode('crew', 'SIGNED_OUT', null)).toBe('command')
  })

  it('restores crew context when an anonymous session is initialized', () => {
    expect(nextWorkspaceMode('command', 'INITIAL_SESSION', true)).toBe('crew')
  })
})
