import { describe, expect, it } from 'vitest';
import nativeFiles from './nativeFiles.ts?raw';
import nativeShell from './native.ts?raw';
import plugin from '../../android/app/src/main/java/com/sundayeleven/se27/Se27FilesPlugin.java?raw';
import careerFiles from '../../android/app/src/main/java/com/sundayeleven/se27/CareerFiles.java?raw';
import mainActivity from '../../android/app/src/main/java/com/sundayeleven/se27/MainActivity.java?raw';

/**
 * The seam between the game and the shell that writes its career files.
 *
 * Everything else about the Android write is tested where it lives: the name
 * rules in `android/app/src/test/.../CareerFilesTest.java`, and the claim the
 * game makes in `ui/saveTransfer.test.ts`. What cannot be tested from either
 * side is the *agreement between them* — a plugin the page calls by one name and
 * the shell answers to by another is a career file that is never written, and it
 * fails silently, at runtime, on a device only. So the two names are read here
 * out of the files that state them and held together.
 *
 * This is the same approach as `release.test.ts`: these are facts about this
 * repository's Android project, and the files are the source of truth for them.
 */

/** The plugin's registered name, as the shell announces it. */
function pluginName(): string | null {
  return /@CapacitorPlugin\(name\s*=\s*"([^"]+)"\)/.exec(plugin)?.[1] ?? null;
}

/** The name the page asks for. */
function requestedName(): string | null {
  return /registerPlugin<[^>]*>\('([^']+)'\)/.exec(nativeFiles)?.[1] ?? null;
}

/** The one method the page calls on it. */
function requestedMethod(): string | null {
  const call = /Se27Files\.(\w+)\(/.exec(nativeFiles)?.[1] ?? null;
  return call;
}

describe('the file writer the packaged build brings with it', () => {
  it('is one plugin, named once, on both sides of the bridge', () => {
    expect(requestedName()).toBe('Se27Files');
    expect(pluginName()).toBe(requestedName());
  });

  it('answers the one method the game calls, and only that one', () => {
    expect(requestedMethod()).toBe('writeCareerFile');
    expect(plugin).toMatch(/public void writeCareerFile\(PluginCall call\)/);
    // The method the page calls is the whole of the plugin's surface: an
    // interface that can be asked for more than a file write is one that will
    // eventually be asked.
    expect([...plugin.matchAll(/@PluginMethod/g)]).toHaveLength(1);
  });

  it('is registered by the application, before the page can ask for it', () => {
    // A plugin written in the application itself is in nobody's generated list,
    // so the application registers it — and before `super.onCreate`, because the
    // bridge is built during that call.
    const registration = mainActivity.indexOf('registerPlugin(Se27FilesPlugin.class)');
    const start = mainActivity.indexOf('super.onCreate(');
    expect(registration).toBeGreaterThan(-1);
    expect(start).toBeGreaterThan(-1);
    expect(registration).toBeLessThan(start);
  });

  it('is installed into the game by the shell, not claimed by a screen', () => {
    // The shell installs the host as it starts — the moment the application is
    // known to be a packaged one — so a screen never has to decide whether this
    // build can write a file.
    expect(nativeFiles).toMatch(/export function installNativeFileHost/);
    expect(nativeShell).toMatch(/installNativeFileHost\(\)/);
    expect(nativeShell).toMatch(/startNativeShell/);
    // And only inside a native shell: a browser keeps the download it had.
    expect(nativeFiles).toMatch(/if \(!Capacitor\.isNativePlatform\(\)\) return;/);
  });

  it('refuses in a result rather than throwing at the game', () => {
    // A refusal has to arrive as something the game can put into its own
    // sentence. A rejected bridge call would surface as a plugin error to a
    // manager who asked for a backup.
    expect(plugin).not.toMatch(/call\.reject\(/);
    expect(plugin).toMatch(/refused\(/);
    // Nothing is resolved as written until the bytes are actually there.
    expect(plugin).toMatch(/out\.write\(bytes\)/);
    expect(nativeFiles).toMatch(/result\?\.written !== true/);
  });

  it('writes into a place the manager can find, and says where it was', () => {
    expect(plugin).toMatch(/MediaStore\.Downloads\.getContentUri/);
    expect(plugin).toMatch(/RELATIVE_PATH/);
    expect(plugin).toMatch(/Environment\.DIRECTORY_DOWNLOADS/);
    // The place is part of the answer, because the sentence the manager reads
    // names it.
    expect(plugin).toMatch(/result\.put\("location", location\)/);
  });

  it('takes its name from the one rule, and that rule is tested on its own', () => {
    // The write itself cannot be unit tested off a device, but the name it is
    // written under can be, and it lives in its own class for that reason.
    expect(plugin).toMatch(/CareerFiles\.fileName\(/);
    expect(careerFiles).toMatch(/static String fileName\(/);
  });
});
