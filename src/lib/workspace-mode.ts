import type { AuthChangeEvent } from '@supabase/supabase-js'

export type WorkspaceMode = 'command' | 'crew'

export function nextWorkspaceMode(
  current: WorkspaceMode,
  event: AuthChangeEvent,
  isAnonymous: boolean | null,
): WorkspaceMode {
  if (event === 'SIGNED_OUT' || ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && !isAnonymous)) {
    return 'command'
  }
  if (isAnonymous) return 'crew'
  return current
}
