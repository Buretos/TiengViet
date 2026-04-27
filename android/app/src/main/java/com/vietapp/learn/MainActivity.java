package com.vietapp.learn;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.vietapp.plugin.BackgroundTtsPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BackgroundTtsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
