package com.sundayeleven.se27;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * The name a career file is written under.
 *
 * This is the one piece of the Android write that can be held to account without
 * a device, and it is worth holding: the name comes from the page, and a name
 * from a page that reaches a file system unexamined is how a file ends up
 * somewhere other than where it was meant to go — or somewhere the manager
 * cannot see it. The game builds its own names carefully; this is the layer that
 * does not have to take that on trust.
 *
 * Run with `./gradlew testDebugUnitTest`.
 */
public class CareerFilesTest {

    /** The shape the game itself sends: `sunday-eleven-27-career-<club>-<date>.json`. */
    private static final String GAME_NAME = "sunday-eleven-27-career-bramford-rovers-2026-10-09.json";

    @Test
    public void keepsTheGamesOwnNameExactly() {
        // The sentence the manager is shown quotes this name back to him, and he
        // then goes looking for it — so the common case must not be rewritten.
        assertEquals(GAME_NAME, CareerFiles.fileName(GAME_NAME));
    }

    @Test
    public void givesAnEmptyNameSomewhereToGo() {
        assertEquals("sunday-eleven-27-career.json", CareerFiles.fileName(""));
        assertEquals("sunday-eleven-27-career.json", CareerFiles.fileName(null));
        assertEquals("sunday-eleven-27-career.json", CareerFiles.fileName("   "));
        assertEquals("sunday-eleven-27-career.json", CareerFiles.fileName(".json"));
    }

    @Test
    public void addsTheExtensionTheGameReads() {
        assertEquals("my-career.json", CareerFiles.fileName("my-career"));
        assertEquals("my-career.json", CareerFiles.fileName("my-career.json"));
        // Recognised whatever case it arrives in, and written in the one case the
        // game's own names use.
        assertEquals("MY-CAREER.json", CareerFiles.fileName("MY-CAREER.JSON"));
    }

    @Test
    public void neverNamesAPath() {
        // A separator in a name is a name that decides which folder it lands in.
        assertEquals("passwd.json", CareerFiles.fileName("../../etc/passwd"));
        assertEquals("career.json", CareerFiles.fileName("C:\\Users\\alex\\career"));
        assertEquals("career.json", CareerFiles.fileName("/sdcard/Download/career.json"));
        assertFalse(CareerFiles.fileName("a/b/c.json").contains("/"));
    }

    @Test
    public void keepsTheNameReservedCharactersOutOf() {
        // Android accepts these; a computer the file is later copied to may not.
        // Everything that can be written is left exactly as the page wrote it,
        // which is why the space in the middle of this one survives.
        assertEquals("bramford-rovers -reserves--2026-10-09.json",
            CareerFiles.fileName("bramford:rovers \"reserves\"|2026-10-09"));
        assertEquals("a-b-c.json", CareerFiles.fileName("a<b>c.json"));
        assertFalse(CareerFiles.fileName("a<b>c?d*e.json").matches(".*[<>?*\"|\\\\].*"));
    }

    @Test
    public void hidesNothing() {
        // A leading dot is a hidden file, which is a backup nobody finds.
        assertEquals("career.json", CareerFiles.fileName(".career"));
        assertEquals("career.json", CareerFiles.fileName(" ..career"));
    }

    @Test
    public void staysWithinALengthAnyFileSystemWillTake() {
        String longName = CareerFiles.fileName("x".repeat(400) + ".json");
        assertTrue(longName.length() <= 120);
        assertTrue(longName.endsWith(".json"));
    }

    @Test
    public void dropsControlCharactersRatherThanTruncatingTheName() {
        assertEquals("career.json", CareerFiles.fileName("car\u0000eer.json"));
        assertEquals("ab.json", CareerFiles.fileName("a\r\nb.json"));
    }
}
