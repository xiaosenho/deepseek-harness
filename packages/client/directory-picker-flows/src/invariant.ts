/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-directory-picker-flows`.
 * @module @deepseek-ai/dsh-client-directory-picker-flows/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-directory-picker-flows'

/** Cordis companion plugin name. */
export const name = 'client-directory-picker-flows-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this library provides inlined React components and
 * installer functions but mounts no plugin or shared runtime identity itself.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
