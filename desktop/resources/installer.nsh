/*
 * What the installer says, in Modern UI's own language.
 *
 * `electron-builder.yml` names this file (`nsis.include`) and the two bitmaps
 * beside it, and Electron's packer prepends this to the generated NSIS script —
 * before `MUI2.nsh` is even included, and long before the pages are inserted.
 * That position is the whole reason the file works: a `!define` that arrives
 * after `!insertmacro MUI_PAGE_*` is a page that ignores it.
 *
 * The artwork is `installerHeader.bmp` (the 150×57 plate in the header bar) and
 * `installerSidebar.bmp` (the 164×314 panel on the welcome and finish pages),
 * both drawn from the game's own favicon by `npm run desktop:art`. The icons are
 * already the game's: electron-builder defaults the installer's and the
 * uninstaller's to the application icon, which is the same mark.
 *
 * What is deliberately *not* done here is worth saying, because the framework
 * makes it look easy. MUI's `MUI_BGCOLOR` is one definition that paints three
 * things: the header bar, the welcome page and the finish page. The game is
 * dark everywhere, so a near-black wizard is tempting — and its own bug #443
 * refuses it: a themed check box ignores the text colour it is given, and MUI
 * only works around that in high-contrast mode, so the finish page's "Open
 * Sunday Eleven 27" would be black text on a near-black page. A dark finish page
 * without it means a hand-written page, replacing the framework's — a lot of
 * NSIS to own for one screen. So the chrome is left native and the identity is
 * carried by the two pictures, which is where a manager actually sees it.
 *
 * The welcome page, on the other hand, is *added* here. electron-builder's
 * assisted installer goes straight to a question — "Who should this application
 * be installed for?" — and a game that opens with a routing question has
 * introduced itself badly. One page, one paragraph, and then the questions.
 */

/*
 * The installer's first page.
 *
 * `customWelcomePage` is the framework's own hook (see `assistedInstaller.nsh`)
 * and is empty by default, so this is the installer saying hello rather than the
 * packer being worked around.
 */
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to Sunday Eleven 27"
  !define MUI_WELCOMEPAGE_TEXT "Sunday League football management, played on a muddy pitch in the rain.$\r$\n$\r$\nSetup will install Sunday Eleven 27 on this computer. The game runs offline, and every career stays on it."
  !insertmacro MUI_PAGE_WELCOME
!macroend

/*
 * And the uninstaller's, which exists by default and says nothing in particular.
 *
 * It is a page the manager will read at what is usually a bad moment, so it
 * answers the question he is asking it — whether the seasons he has played are
 * about to go with it. They are not: `deleteAppDataOnUninstall` is false, and
 * exported careers are in his own Documents folder, which no uninstaller has
 * ever looked in.
 */
!macro customUnWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Remove Sunday Eleven 27"
  !define MUI_WELCOMEPAGE_TEXT "Setup will remove the game and its shortcuts from this computer.$\r$\n$\r$\nYour careers are not touched: the ones you are playing live in the application's own data, and the ones you exported are in your Documents folder."
  !insertmacro MUI_UNPAGE_WELCOME
!macroend

/*
 * The finish page: the last thing read, and the only place the game's own voice
 * can be in a wizard.
 *
 * The run box is the framework's (electron-builder wires it to the launch link,
 * and passes `--updated` on a reinstall), so only its wording is ours. The link
 * is added because a finish page with a website on it is a finish page somebody
 * can do something with.
 */
!define MUI_FINISHPAGE_TITLE "Sunday Eleven 27 is installed"
!define MUI_FINISHPAGE_TEXT "The game is on your computer, and nothing has been sent anywhere.$\r$\n$\r$\nYour careers live on this machine: uninstalling will not take them with it."
!define MUI_FINISHPAGE_RUN_TEXT "Open Sunday Eleven 27"
!define MUI_FINISHPAGE_LINK "sundayeleven.pages.dev"
!define MUI_FINISHPAGE_LINK_LOCATION "https://sundayeleven.pages.dev/"
!define MUI_FINISHPAGE_LINK_COLOR "4CAF7D"

/*
 * Asking before throwing away a download and a minute of somebody's afternoon.
 *
 * MUI has an abort warning and does not show it unless a script asks for it;
 * electron-builder never does. Enabling it costs one dialog and buys the one
 * thing an installer should never do silently.
 */
!define MUI_ABORTWARNING
!define MUI_ABORTWARNING_TEXT "Leave Setup and not install Sunday Eleven 27?"
!define MUI_UNABORTWARNING_TEXT "Leave without removing Sunday Eleven 27?"
