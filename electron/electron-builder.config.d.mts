declare const config: {
  readonly detectUpdateChannel: boolean
  readonly files: readonly string[]
  readonly extraResources: readonly {
    readonly from: string
    readonly to: string
    readonly filter: readonly string[]
  }[]
  readonly mac: { readonly target: readonly { readonly target: string; readonly arch: readonly string[] }[] }
  readonly publish: { readonly provider: string, readonly url: string }
  readonly win: { readonly target: readonly { readonly target: string; readonly arch: readonly string[] }[] }
}

export default config
