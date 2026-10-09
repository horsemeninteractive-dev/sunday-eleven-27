package com.sundayeleven.se27;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * The application, and the one plugin of its own that it brings with it.
 *
 * Capacitor's own plugins are found for it — they are listed in the generated
 * `capacitor.plugins.json` inside the module that ships them — but a plugin
 * written *here*, in the application itself, is not in anybody's list, so the
 * application registers it. That is the whole reason this file exists at all.
 *
 * `Se27FilesPlugin` is the application's own answer to a question the game asks
 * of every host it runs inside: *put this career file somewhere the manager can
 * keep it*. A WebView cannot, which is why the answer has to come from here. See
 * that plugin for the defect it closes.
 *
 * Registered before `super.onCreate`, deliberately: the plugins are handed to
 * the bridge while the bridge is being built, and registering afterwards would
 * be registering a plugin the page could already have asked for.
 */
public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(Se27FilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
