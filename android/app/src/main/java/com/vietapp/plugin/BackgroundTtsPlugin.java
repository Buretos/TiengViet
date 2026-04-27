package com.vietapp.plugin;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Binder;
import android.os.Build;
import android.os.IBinder;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.util.Log;
import android.os.PowerManager;

import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;

/**
 * Background TTS Plugin for Capacitor
 * Provides TTS via Android's native TextToSpeech API with ForegroundService support
 * for background (screen-off) playback.
 */
@CapacitorPlugin(name = "BackgroundTts")
public class BackgroundTtsPlugin extends Plugin {
    private static final String TAG = "BackgroundTts";
    private static final String CHANNEL_ID = "vietapp_tts";
    private static final int NOTIFICATION_ID = 1001;

    private TextToSpeech tts;
    private boolean ttsReady = false;
    private boolean backgroundMode = false;
    private PowerManager.WakeLock wakeLock;
    private PluginCall pendingSpeakCall = null;
    private String currentUtteranceId = null;

    @Override
    public void load() {
        initTts();
    }

    private void initTts() {
        tts = new TextToSpeech(getContext(), status -> {
            if (status == TextToSpeech.SUCCESS) {
                ttsReady = true;
                Log.d(TAG, "TTS initialized successfully");
            } else {
                Log.e(TAG, "TTS initialization failed: " + status);
                ttsReady = false;
            }
        });

        tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {
                Log.d(TAG, "TTS started: " + utteranceId);
            }

            @Override
            public void onDone(String utteranceId) {
                Log.d(TAG, "TTS done: " + utteranceId);
                notifyListeners("ttsDone", new JSObject().put("utteranceId", utteranceId));
            }

            @Override
            public void onError(String utteranceId) {
                Log.e(TAG, "TTS error: " + utteranceId);
                notifyListeners("ttsError", new JSObject().put("utteranceId", utteranceId));
            }
        });
    }

    @PluginMethod
    public void speak(PluginCall call) {
        String text = call.getString("text", "");
        String lang = call.getString("lang", "vi");
        float rate = call.getFloat("rate", 0.85f);

        if (!ttsReady) {
            call.reject("TTS not ready");
            return;
        }

        if (text.isEmpty()) {
            call.resolve();
            return;
        }

        // Set language
        Locale locale = lang.equals("vi") ? new Locale("vi", "VN") : new Locale("ru", "RU");
        int langResult = tts.setLanguage(locale);
        if (langResult == TextToSpeech.LANG_MISSING_DATA || langResult == TextToSpeech.LANG_NOT_SUPPORTED) {
            // Fallback to available language
            Log.w(TAG, "Language not supported: " + lang + ", using default");
        }

        tts.setSpeechRate(rate);
        currentUtteranceId = "utt_" + System.currentTimeMillis();

        HashMap<String, String> params = new HashMap<>();
        params.put(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, currentUtteranceId);

        // Update notification text if in background mode
        if (backgroundMode) {
            updateNotification(text);
        }

        tts.speak(text, TextToSpeech.QUEUE_FLUSH, params);
        call.resolve(new JSObject().put("utteranceId", currentUtteranceId));
    }

    @PluginMethod
    public void stop(PluginCall call) {
        if (tts != null) tts.stop();
        call.resolve();
    }

    @PluginMethod
    public void enableBackground(PluginCall call) {
        backgroundMode = true;
        acquireWakeLock();
        startForegroundService();
        call.resolve();
    }

    @PluginMethod
    public void disableBackground(PluginCall call) {
        backgroundMode = false;
        releaseWakeLock();
        stopForegroundService();
        call.resolve();
    }

    @PluginMethod
    public void isReady(PluginCall call) {
        call.resolve(new JSObject().put("ready", ttsReady));
    }

    private void acquireWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) return;
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "VietApp:TtsPLaying");
        wakeLock.acquire(3600000L); // Max 1 hour
    }

    private void releaseWakeLock() {
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
            wakeLock = null;
        }
    }

    private void startForegroundService() {
        Intent serviceIntent = new Intent(getContext(), TtsForegroundService.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            getContext().startForegroundService(serviceIntent);
        } else {
            getContext().startService(serviceIntent);
        }
    }

    private void stopForegroundService() {
        Intent serviceIntent = new Intent(getContext(), TtsForegroundService.class);
        getContext().stopService(serviceIntent);
    }

    private void updateNotification(String text) {
        NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Notification notification = new NotificationCompat.Builder(getContext(), CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_media_play)
                .setContentTitle("Tiếng Việt — воспроизведение")
                .setContentText(text.length() > 60 ? text.substring(0, 57) + "..." : text)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
            nm.notify(NOTIFICATION_ID, notification);
        }
    }

    @Override
    protected void handleOnDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        releaseWakeLock();
        super.handleOnDestroy();
    }
}
