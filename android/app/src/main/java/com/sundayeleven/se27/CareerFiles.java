package com.sundayeleven.se27;

import java.util.Locale;

/**
 * The name an exported career file is written under.
 *
 * This is the one part of the write that has nothing to do with Android, and it
 * is kept apart for that reason: it is where the thinking is, and it is the part
 * a JVM test can hold to account.
 *
 * The name arrives from the page — the game builds it from the club and the day
 * — and it is *not* trusted, for two reasons. The first is that a name is a
 * name: a string from a web page that reaches a file system unexamined can carry
 * a separator with it and name somewhere other than the folder it was meant for.
 * The second is that the manager will read this name back out of his Downloads
 * folder, so it has to survive being copied off an Android device and onto a
 * Windows or macOS one, whose file systems turn down characters that Android
 * accepts.
 *
 * What is *not* done here is inventing a different name from the game's own
 * (`state/careerFile.ts` builds it, and the sentence the manager is shown quotes
 * it back), so the rewrite is deliberately conservative: strip what cannot be
 * written, keep everything else.
 */
final class CareerFiles {

    /** The extension the game's own career files carry, and treats as one. */
    private static final String SUFFIX = ".json";

    /** Long enough for a club name and a date, short enough for any file system. */
    private static final int MAX_LENGTH = 120;

    /** Used only when the page sent nothing that could be written at all. */
    private static final String FALLBACK = "sunday-eleven-27-career";

    /** Characters a file system may refuse once the file is copied off a phone. */
    private static final String RESERVED = "\\/:*?\"<>|";

    private CareerFiles() {
    }

    /**
     * A file name that is safe to hand to the device's own file store.
     *
     * Returns a name ending in `.json` that contains no separator and no
     * character outside the ones a file system is happy to hold, and never
     * returns an empty string: a caller with an empty name gets the game's own
     * generic one rather than being refused, because the file it is writing is
     * a manager's season and the name is the least important thing about it.
     */
    static String fileName(String raw) {
        String name = raw == null ? "" : raw.trim();

        // Only the last segment. A name is not a path, and a page does not get
        // to say which folder a career is written into.
        int lastSeparator = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
        if (lastSeparator >= 0) {
            name = name.substring(lastSeparator + 1);
        }

        StringBuilder kept = new StringBuilder(name.length());
        for (int index = 0; index < name.length(); index++) {
            char character = name.charAt(index);
            // Control characters, including the null byte, have no place in a
            // name at all; the reserved ones become a dash so that a club called
            // "Bramford Rovers: Reserves" still reads as itself.
            if (Character.isISOControl(character)) {
                continue;
            }
            kept.append(RESERVED.indexOf(character) >= 0 ? '-' : character);
        }
        name = kept.toString().trim();

        // The stem, with the extension taken off if it already had one, so that
        // ".json" and "   " are the same thing to the rule below: a name with
        // nothing in it at all.
        String stem = name.toLowerCase(Locale.ROOT).endsWith(SUFFIX)
            ? name.substring(0, name.length() - SUFFIX.length())
            : name;

        // A name that begins with a dot is a hidden file, which is a backup the
        // manager would never see. Done on the stem rather than the whole name,
        // so that the dots come off whether or not an extension was there —
        // "..career" and ".json" are the same complaint.
        while (stem.startsWith(".")) {
            stem = stem.substring(1);
        }
        stem = stem.trim();

        if (stem.isEmpty()) {
            // The game's own generic name, rather than a refusal: a manager's
            // season is worth more than the argument about what to call it.
            stem = FALLBACK;
        }
        if (stem.length() > MAX_LENGTH - SUFFIX.length()) {
            // A plain cut. The limit is far above anything the game itself builds
            // (its longest possible name is 88 characters), so this guards a
            // future name rather than being reached by today's.
            stem = stem.substring(0, MAX_LENGTH - SUFFIX.length());
        }
        // The extension is written in one case and read in one case: the game
        // names its own files in lower case and looks for them the same way.
        return stem + SUFFIX;
    }
}
