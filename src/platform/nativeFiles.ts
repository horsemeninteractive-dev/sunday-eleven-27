import { Capacitor, registerPlugin } from '@capacitor/core';
import { installHostBridge, type HostWriteResult } from './files';

/**
 * The Android shell's answer to "put this career file somewhere I can keep it".
 *
 * A WebView has no download manager, so the browser's own answer — a blob behind
 * an `<a download>` — writes nothing at all inside the installed application.
 * The shell therefore has to do it, which is exactly what `platform/files.ts`
 * always described as the third way: *"a packaged build handing the bytes to its
 * host: a Capacitor app writing to the device's files"*. Nothing in the game
 * changes; the host it was written to expect now exists.
 *
 * The writing itself is deliberately *not* in JavaScript. A page cannot name a
 * place outside its own sandbox, and on Android the honest destination is the
 * device's Downloads collection — where the manager will actually look for a
 * file he exported, and where the Files application shows it to him. So there is
 * a small native plugin, `Se27FilesPlugin.java`, registered by `MainActivity`,
 * and this file is only the typed way in and the honest way back out:
 *
 *   - it never throws. A plugin that is missing, was not synced into the build,
 *     or refused the write has told us nothing except that this export did not
 *     happen, and the game's answer to that is a sentence rather than a crash;
 *   - it reports *where* the file went when the shell says so, because "your
 *     career has been exported" without a place is a manager hunting through a
 *     file manager on a phone;
 *   - and it installs itself only in a native shell. A browser keeps the
 *     download it already had.
 *
 * See `ANDROID.md` for the plugin, and `RELEASE_READINESS.md` for the defect
 * this closes.
 */

interface Se27FilesPlugin {
  /**
   * Write a JSON career file to a place the manager can find.
   *
   * Resolves `written: false` rather than rejecting when the file could not be
   * written, so the game can say so in its own words instead of surfacing a
   * plugin error to a manager who asked for a backup.
   */
  writeCareerFile(options: { name: string; text: string }): Promise<{
    written?: boolean;
    location?: string;
    reason?: string;
  }>;
}

/** The native writer. Registered on the Android side; a no-op anywhere else. */
const Se27Files = registerPlugin<Se27FilesPlugin>('Se27Files');

async function writeThroughHost(name: string, text: string): Promise<HostWriteResult> {
  try {
    const result = await Se27Files.writeCareerFile({ name, text });
    if (result?.written !== true) {
      // Logged rather than shown: the game's own sentence is what the manager
      // gets, and a plugin's diagnostic is for whoever is holding the device.
      console.warn(`The shell would not write ${name}:`, result?.reason ?? 'no reason given');
      return { written: false };
    }
    return result.location ? { written: true, location: result.location } : { written: true };
  } catch (error) {
    console.warn(`The shell could not write ${name}.`, error);
    return { written: false };
  }
}

/**
 * Give the packaged build a way to write a file. Does nothing in a browser.
 *
 * Called once, as the native shell starts, which is before any screen can offer
 * an export — so a manager who taps "Export career" is always talking to a host
 * that is there.
 */
export function installNativeFileHost(): void {
  if (!Capacitor.isNativePlatform()) return;
  installHostBridge({ saveTextFile: writeThroughHost });
}
