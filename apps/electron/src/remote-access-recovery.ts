/** Fatal Electron remote-access recovery helpers. */

/**
 * Show one fatal failure before terminating the unusable desktop host.
 * @param showFailure - native error dialog that settles after user acknowledgement.
 * @param quit - application termination command.
 * @returns after the quit command has been issued.
 */
export async function quitAfterFatalRemoteAccessFailure(
  showFailure: () => Promise<unknown>,
  quit: () => void,
): Promise<void> {
  try {
    await showFailure()
  } catch (error) {
    console.error('Failed to show the fatal Electron remote-access error.', error)
  } finally {
    quit()
  }
}

/** Coalesces every fatal remote-access report into one dialog and one quit request. */
export class FatalRemoteAccessRecovery {
  #task: Promise<void> | undefined

  /**
   * Start or join the fatal recovery operation for this application process.
   * @param showFailure - native error dialog that settles after user acknowledgement.
   * @param quit - application termination command.
   * @returns the shared fatal recovery operation.
   */
  run(showFailure: () => Promise<unknown>, quit: () => void): Promise<void> {
    this.#task ??= quitAfterFatalRemoteAccessFailure(showFailure, quit)
    return this.#task
  }
}
