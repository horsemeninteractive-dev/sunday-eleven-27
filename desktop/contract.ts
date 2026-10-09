/**
 * What crosses the preload bridge, written down once.
 *
 * Types only, and that is the point: this module is imported by the shell's main
 * process, by the shell's preload script and by the game's renderer, so the
 * three cannot disagree about the shape of a message. A bridge whose two ends
 * were described separately is a bridge that works until somebody changes one
 * end, and the failure — a career that is never written — happens on a
 * manager's machine rather than in a test.
 *
 * The reply deliberately mirrors `HostWriteResult` in `src/platform/files.ts`,
 * which is the game's own, older description of what a host did with a file:
 * `written` says whether it landed, `location` says where in the manager's
 * terms, and `reason` is for the log rather than for the screen. The game's
 * sentence is the game's own; a shell never invents one.
 */

/** The game asking the shell to write a career file. */
export interface DesktopWriteRequest {
  /** The name the game wants, which the shell sanitises again before use. */
  name: string;
  /** The file's whole contents, already serialised by the game. */
  text: string;
}

/** What the shell did with it. */
export interface DesktopWriteReply {
  /** True only when the bytes are on the disk. */
  written: boolean;
  /** The folder it was written into, when it was. Shown to the manager. */
  location?: string;
  /** Why not, when it was not. For the log; the game has its own sentence. */
  reason?: string;
}

/**
 * The whole of what the renderer is given.
 *
 * Three members, and there is no fourth: no file system, no shell, no arbitrary
 * IPC, no `require`. Everything the game can ask of the desktop is on this
 * interface, which means the answer to "what can a compromised page reach?" is
 * readable in eight lines.
 */
export interface DesktopShellBridge {
  readonly platform: 'desktop';
  /** Write one career file into the manager's own career folder. */
  saveCareerFile: (name: string, text: string) => Promise<DesktopWriteReply>;
  /**
   * Be told that the shell is about to close the window.
   *
   * The game answers `flushDone` when its last write has landed, and the shell
   * waits for that before it closes. Returns the way to stop listening, because
   * an application that is restarted many times must not accumulate handlers.
   */
  onFlushRequested: (handler: () => void) => () => void;
  /** Hand the shell back to itself: the write it asked for has been made. */
  flushDone: () => void;
}
