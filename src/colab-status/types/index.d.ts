/** 走っている Colab の鎖 1 本（hooks/register.tsx に埋め込んだ Python が出す 1 件）。 */
export interface ColabChain {
  kind: 'image' | 'video' | 'music'
  name: string
  line: string
  vm_sec: number | null
  yen: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'colab-status': { chains: readonly ColabChain[] }
  }
}
