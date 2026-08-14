declare const config: {
  readonly detectUpdateChannel: boolean
  readonly extraResources: readonly {
    readonly from: string
    readonly to: string
    readonly filter: readonly string[]
  }[]
  readonly mac: { readonly target: readonly { readonly target: string }[] }
  readonly publish: { readonly provider: string, readonly url: string }
  readonly win: { readonly target: readonly { readonly target: string }[] }
}

export default config
