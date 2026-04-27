#!/bin/bash
# =========================================================
#  BUILD SCRIPT for Tiếng Việt Android App
#  Requires: Java 17+, Android SDK, Node.js
# =========================================================

set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
log() { echo -e "${GREEN}[BUILD]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1"; exit 1; }

# ---- 1. Check prerequisites ----
log "Checking prerequisites..."

if ! command -v node &>/dev/null; then
    err "Node.js not found. Install from https://nodejs.org"
fi

if ! command -v java &>/dev/null; then
    warn "Java not found. Attempting to install..."
    if command -v apt-get &>/dev/null; then
        sudo apt-get install -y openjdk-17-jdk
    else
        err "Install JDK 17: https://adoptium.net"
    fi
fi

JAVA_VER=$(java -version 2>&1 | head -1 | grep -oP '\d+' | head -1)
if [ "${JAVA_VER:-0}" -lt 17 ]; then
    err "Java 17+ required. Current: Java $JAVA_VER"
fi

log "Node: $(node --version), Java: $(java -version 2>&1 | head -1)"

# ---- 2. Install Android SDK if needed ----
ANDROID_SDK="${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}"
if [ ! -d "$ANDROID_SDK" ]; then
    log "Installing Android SDK command-line tools..."
    mkdir -p "$ANDROID_SDK/cmdline-tools"
    TMPDIR=$(mktemp -d)

    # Download SDK tools
    SDK_URL="https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip"
    wget -q --show-progress "$SDK_URL" -O "$TMPDIR/sdk-tools.zip"
    unzip -q "$TMPDIR/sdk-tools.zip" -d "$ANDROID_SDK/cmdline-tools"
    mv "$ANDROID_SDK/cmdline-tools/cmdline-tools" "$ANDROID_SDK/cmdline-tools/latest" 2>/dev/null || true
    rm -rf "$TMPDIR"

    export ANDROID_SDK_ROOT="$ANDROID_SDK"
    export PATH="$ANDROID_SDK/cmdline-tools/latest/bin:$ANDROID_SDK/platform-tools:$PATH"

    # Install required SDK components
    log "Installing Android SDK components (API 34)..."
    yes | sdkmanager --licenses > /dev/null 2>&1 || true
    sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools"
    log "Android SDK installed to $ANDROID_SDK"
fi

export ANDROID_SDK_ROOT="$ANDROID_SDK"
export PATH="$ANDROID_SDK/cmdline-tools/latest/bin:$ANDROID_SDK/platform-tools:$PATH"

# ---- 3. Generate lesson data ----
log "Generating lesson data from HTML files..."
python3 scripts/extract_data.py

# Convert JSON to JS
python3 - << 'PYEOF'
import json, os
data_file = 'www/data/lessons.json'
js_file = 'www/js/lessons_data.js'
with open(data_file, 'r', encoding='utf-8') as f:
    data = json.load(f)
with open(js_file, 'w', encoding='utf-8') as f:
    f.write('/* Auto-generated lesson data */\nwindow.LESSONS_DATA = ')
    json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';')
print(f"Generated {js_file}: {os.path.getsize(js_file)//1024} KB")
PYEOF

# ---- 4. Install npm dependencies ----
log "Installing npm dependencies..."
npm install

# ---- 5. Initialize Capacitor (first run only) ----
if [ ! -d "android" ]; then
    log "Initializing Capacitor..."
    npx cap init "TiengViet" "com.vietapp.learn" --web-dir www

    log "Adding Android platform..."
    npx cap add android

    # ---- 6. Copy custom Android plugin files ----
    log "Installing custom BackgroundTTS plugin..."
    PLUGIN_DEST="android/app/src/main/java/com/vietapp/plugin"
    mkdir -p "$PLUGIN_DEST"
    cp android_plugin/src/main/java/com/vietapp/plugin/*.java "$PLUGIN_DEST/"

    # ---- 7. Patch AndroidManifest.xml ----
    log "Patching AndroidManifest.xml..."
    MANIFEST="android/app/src/main/AndroidManifest.xml"

    # Add permissions before </manifest>
    python3 - << 'PYEOF2'
import re

manifest_path = 'android/app/src/main/AndroidManifest.xml'
with open(manifest_path, 'r') as f:
    content = f.read()

permissions = """
    <!-- Background audio permissions -->
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_MEDIA_PLAYBACK" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
"""

service_decl = """
        <!-- Background TTS Foreground Service -->
        <service
            android:name="com.vietapp.plugin.TtsForegroundService"
            android:enabled="true"
            android:exported="false"
            android:foregroundServiceType="mediaPlayback" />
"""

# Insert permissions before <application>
if '<uses-permission android:name="android.permission.FOREGROUND_SERVICE"' not in content:
    content = content.replace('<application', permissions + '\n    <application', 1)

# Insert service before </application>
if 'TtsForegroundService' not in content:
    content = content.replace('</application>', service_decl + '    </application>', 1)

with open(manifest_path, 'w') as f:
    f.write(content)
print("AndroidManifest.xml patched")
PYEOF2

    # ---- 8. Register custom plugin in MainActivity ----
    log "Registering BackgroundTTS plugin..."
    python3 - << 'PYEOF3'
import os, re, glob

# Find MainActivity
main_activity = None
for f in glob.glob('android/app/src/main/java/**/*.java', recursive=True):
    if 'MainActivity' in f:
        main_activity = f
        break

if not main_activity:
    print("MainActivity not found")
    exit(0)

with open(main_activity, 'r') as f:
    content = f.read()

# Add import and plugin registration
if 'BackgroundTtsPlugin' not in content:
    content = content.replace(
        'import com.getcapacitor.BridgeActivity;',
        'import com.getcapacitor.BridgeActivity;\nimport com.vietapp.plugin.BackgroundTtsPlugin;'
    )
    # Register plugin in onCreate or add() call
    if 'registerPlugin' not in content:
        content = content.replace(
            'public class MainActivity extends BridgeActivity {',
            'public class MainActivity extends BridgeActivity {\n    @Override\n    public void onCreate(android.os.Bundle savedInstanceState) {\n        registerPlugin(BackgroundTtsPlugin.class);\n        super.onCreate(savedInstanceState);\n    }'
        )

with open(main_activity, 'w') as f:
    f.write(content)
print(f"Registered plugin in {main_activity}")
PYEOF3

    # ---- 9. Add notification channel setup ----
    log "Setting up Android build config..."
    # Add compileSdkVersion if needed
    python3 - << 'PYEOF4'
with open('android/app/build.gradle', 'r') as f:
    content = f.read()

# Ensure minSdkVersion is at least 24
content = re.sub(r'minSdkVersion\s+\d+', 'minSdkVersion 24', content) if __import__('re').search(r'minSdkVersion\s+\d+', content) else content

with open('android/app/build.gradle', 'w') as f:
    f.write(content)
print("build.gradle updated")
PYEOF4

else
    log "Android project already exists, syncing..."
fi

# ---- 10. Sync web assets ----
log "Syncing web assets to Android..."
npx cap sync android

# ---- 11. Build APK ----
log "Building debug APK..."
cd android
chmod +x gradlew
./gradlew assembleDebug 2>&1 | tail -30
cd ..

# ---- Find and copy APK ----
APK_PATH=$(find android -name "*.apk" | head -1)
if [ -n "$APK_PATH" ]; then
    cp "$APK_PATH" "TiengViet.apk"
    log "✅ APK built successfully: TiengViet.apk"
    log "   File size: $(du -h TiengViet.apk | cut -f1)"
    log ""
    log "   To install on Android device:"
    log "   1. Enable 'Unknown sources' in Android settings"
    log "   2. Transfer TiengViet.apk to your phone"
    log "   3. Open the file on your phone to install"
    log ""
    log "   To install via ADB: adb install TiengViet.apk"
else
    err "APK not found after build. Check build errors above."
fi
