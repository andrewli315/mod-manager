export type ModInfo = {
  name: string
  version: string
  tier: string
  source: string
}

declare module 'claude-code' {
  interface PluginState {
    'mod-manager': {
      mods: ModInfo[]
      disabled: string[]
      pending: string[]
      isDirty: boolean
    }
  }
}
