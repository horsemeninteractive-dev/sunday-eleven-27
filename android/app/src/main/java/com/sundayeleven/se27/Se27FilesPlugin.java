package com.sundayeleven.se27;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Writing an exported career to the device, because the WebView cannot.
 *
 * This is the native half of a defect that is worth stating plainly, since it is
 * the reason the file exists. A Capacitor Android WebView implements
 * `onShowFileChooser` — which is why *importing* a career file works on a phone
 * — and registers **no `DownloadListener` at all**. An export that went out as
 * the browser's own `<a download>` click therefore wrote nothing, anywhere, and
 * the page had no way to tell: the click returns normally even though nothing
 * catches it. The installed application told managers their career had been
 * exported while no file existed. A game is not allowed to lie about a backup.
 *
 * The game's own answer was to stop making that claim (`platform/files.ts`)
 * and to ask its host instead; this is the host. It writes where the manager
 * will actually look — the device's own **Downloads** collection, which the
 * Files application shows him and which survives being copied to a computer —
 * and it never writes anywhere else.
 *
 * Three rules it keeps, all of them about not over-promising:
 *
 *   - it **resolves, it does not reject**. A refusal is a result
 *     (`written: false`, and a `reason` for whoever is holding the device), so
 *     the game can put it into its own sentence rather than surfacing a plugin
 *     error to a manager who asked for a backup;
 *   - it reports **where** the file went, in the words the game will use, so the
 *     sentence the manager reads names a place and not just a file name;
 *   - and it writes **nothing but a career**: one JSON file, into Downloads,
 *     under a sanitised name (see {@link CareerFiles}).
 *
 * The write is done off the bridge's thread — a whole world serialised to text
 * is not instant — and the reply is sent from that thread, which Capacitor
 * allows precisely so that plugins can do this.
 */
@CapacitorPlugin(name = "Se27Files")
public class Se27FilesPlugin extends Plugin {

    /** Where the manager is told the file went, as a place he can picture. */
    static final String DOWNLOADS = "Downloads";

    /** The same sentence's place for a device older than the Downloads collection. */
    static final String APP_FOLDER = "the game's own folder on this device";

    /** A career file is JSON, and saying so is what makes a phone offer to open it. */
    private static final String MIME_TYPE = "application/json";

    private static final String TAG = "Se27Files";

    /**
     * Write one career file to the device.
     *
     * Expects `{ name, text }` and always resolves: `{ written: true, location }`
     * when the bytes are on the device, `{ written: false, reason }` when they
     * are not. There is deliberately no half-way answer — the manager's only
     * question about an export is whether he has a copy.
     */
    @PluginMethod
    public void writeCareerFile(PluginCall call) {
        String name = CareerFiles.fileName(call.getString("name"));
        String text = call.getString("text");
        if (text == null) {
            // Nothing to write is not the same as unable to write, and both are
            // the same to the manager: no copy exists.
            call.resolve(refused("there was nothing to write"));
            return;
        }

        Context context = getContext();
        // Off the bridge's thread: a career is megabytes of JSON, and the reply
        // is what the game is waiting on either way.
        new Thread(() -> {
            try {
                call.resolve(write(context, name, text));
            } catch (Exception error) {
                Log.e(TAG, "Could not write " + name + " to the device.", error);
                call.resolve(refused("the device would not take the file"));
            }
        }, "se27-career-file").start();
    }

    /** Put the bytes on the device, or say why they are not there. */
    private JSObject write(Context context, String name, String text) throws IOException {
        byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
        // The Downloads collection is the modern, permission-free, visible place
        // and the one a manager will find; the app's own external folder is what
        // a phone older than Android 10 has to offer instead.
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? writeToDownloads(context, name, bytes)
            : writeToAppFolder(context, name, bytes);
    }

    /**
     * Write into the device's Downloads collection.
     *
     * A row is inserted first and its bytes written second, with `IS_PENDING` set
     * in between, which is the platform's own way of saying "this file is not
     * finished yet" — Android 10 and later hide a pending file from other
     * applications, so a manager never copies half a career. If the bytes cannot
     * be written the row is taken back out again, because a pending row with
     * nothing behind it is exactly the disappeared-file failure this whole
     * feature exists to prevent.
     */
    private JSObject writeToDownloads(Context context, String name, byte[] bytes) throws IOException {
        ContentResolver resolver = context.getContentResolver();
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        values.put(MediaStore.MediaColumns.MIME_TYPE, MIME_TYPE);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri collection = MediaStore.Downloads.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri item = resolver.insert(collection, values);
        if (item == null) {
            throw new IOException("the device's file store would not take the file");
        }
        try (OutputStream out = resolver.openOutputStream(item)) {
            if (out == null) {
                throw new IOException("the file store would not open the file for writing");
            }
            out.write(bytes);
            out.flush();
        } catch (IOException error) {
            resolver.delete(item, null, null);
            throw error;
        }

        ContentValues finished = new ContentValues();
        finished.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(item, finished, null, null);

        return written(DOWNLOADS);
    }

    /**
     * The fallback for a phone that has no Downloads collection to write into.
     *
     * The application's own external folder needs no permission and is visible
     * to a file manager on those versions. A device with no external storage at
     * all is a refusal rather than a file written somewhere the manager cannot
     * reach: the point of the export is that he has a copy he can find.
     */
    private JSObject writeToAppFolder(Context context, String name, byte[] bytes) throws IOException {
        File folder = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (folder == null) {
            Log.w(TAG, "No external storage to write " + name + " into.");
            return refused("this device has no storage the game can write a career file to");
        }
        if (!folder.exists() && !folder.mkdirs()) {
            throw new IOException("the game could not make a folder to write the file into");
        }
        File target = new File(folder, name);
        try (FileOutputStream out = new FileOutputStream(target)) {
            out.write(bytes);
            out.flush();
        }
        return written(APP_FOLDER);
    }

    /** The bytes are on the device, and here is where. */
    private JSObject written(String location) {
        JSObject result = new JSObject();
        result.put("written", true);
        result.put("location", location);
        return result;
    }

    /** The bytes are not on the device, and here is why — for the log, not the manager. */
    private JSObject refused(String reason) {
        JSObject result = new JSObject();
        result.put("written", false);
        result.put("reason", reason);
        return result;
    }
}
