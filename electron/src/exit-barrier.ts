/** Coordinates Electron exit with shutdown of application-owned processes. */

/** Prevents Electron from exiting until one shared process-shutdown operation succeeds. */
export class ExitBarrier {
  #ready = false
  #stopping: Promise<void> | undefined

  /** Whether a subsequent `before-quit` event may proceed without prevention. */
  get canExit(): boolean {
    return this.#ready
  }

  /**
   * Start or join the process-shutdown operation required before exit.
   * @param stop - quiesces the application-owned process tree.
   * @returns after shutdown succeeds; a failed attempt may be retried.
   */
  prepare(stop: () => Promise<void>): Promise<void> {
    if (this.#ready) return Promise.resolve()
    if (this.#stopping !== undefined) return this.#stopping

    const operation = Promise.resolve()
      .then(stop)
      .then(() => { this.#ready = true })
      .finally(() => {
        if (this.#stopping === operation) this.#stopping = undefined
      })
    this.#stopping = operation
    return operation
  }
}
