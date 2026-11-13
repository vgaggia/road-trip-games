package com.roadtripgames.shotgun

import android.annotation.SuppressLint
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.wifi.WifiManager
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.ViewGroup
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.appcompat.app.AppCompatActivity

object HotspotServerHolder {
    private var instance: HotspotGameServer? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var wifiLock: WifiManager.WifiLock? = null

    @Synchronized
    fun getOrStart(appContext: Context): HotspotGameServer {
        val existing = instance
        if (existing != null) return existing

        val srv = HotspotGameServer { relPath ->
            try {
                appContext.assets.open("www/$relPath")
            } catch (_: Exception) {
                null
            }
        }
        srv.start(8080)
        instance = srv
        return srv
    }

    @Synchronized
    fun setHotspotActive(appContext: Context, enabled: Boolean) {
        val srv = getOrStart(appContext)
        srv.setExternalHotspotOpen(enabled)
        if (enabled) {
            acquireLocks(appContext)
        } else {
            releaseLocks()
        }
    }

    @Synchronized
    fun shutdown() {
        releaseLocks()
        instance?.stop()
        instance = null
    }

    private fun acquireLocks(appContext: Context) {
        try {
            if (wakeLock == null) {
                val pm = appContext.getSystemService(Context.POWER_SERVICE) as? PowerManager
                wakeLock = pm?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ShotgunRoadTrip::HotspotServer")?.apply {
                    setReferenceCounted(false)
                    acquire(4 * 60 * 60 * 1000L) // up to 4h road trip safety cap
                }
            }
            if (wifiLock == null) {
                val wm = appContext.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
                @Suppress("DEPRECATION")
                val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                } else {
                    WifiManager.WIFI_MODE_FULL_HIGH_PERF
                }
                wifiLock = wm?.createWifiLock(mode, "ShotgunRoadTrip::WifiLock")?.apply {
                    setReferenceCounted(false)
                    acquire()
                }
            }
        } catch (_: Exception) {
        }
    }

    private fun releaseLocks() {
        try {
            wakeLock?.let { if (it.isHeld) it.release() }
        } catch (_: Exception) {
        }
        wakeLock = null

        try {
            wifiLock?.let { if (it.isHeld) it.release() }
        } catch (_: Exception) {
        }
        wifiLock = null
    }
}

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private var lastBackPressMs: Long = 0L

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

        val server = HotspotServerHolder.getOrStart(applicationContext)

        webView = WebView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT
            )
            setBackgroundColor(Color.parseColor("#11131C"))
            webViewClient = WebViewClient()
            webChromeClient = WebChromeClient()

            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                cacheMode = WebSettings.LOAD_NO_CACHE
                textZoom = 100
                setSupportZoom(false)
                builtInZoomControls = false
                displayZoomControls = false
            }

            addJavascriptInterface(NativeBridge(), "RoadTripNative")
        }

        setContentView(webView)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                webView.evaluateJavascript(
                    "(typeof window.onAndroidBackPressed === 'function') ? Boolean(window.onAndroidBackPressed()) : false"
                ) { result ->
                    if (result != "true") {
                        val now = System.currentTimeMillis()
                        if (now - lastBackPressMs < 2000L) {
                            HotspotServerHolder.shutdown()
                            finish()
                        } else {
                            lastBackPressMs = now
                            Toast.makeText(
                                this@MainActivity,
                                "Tap back again to exit Shotgun!",
                                Toast.LENGTH_SHORT
                            ).show()
                        }
                    }
                }
            }
        })

        if (savedInstanceState == null) {
            webView.loadUrl("http://127.0.0.1:${server.port}/?native=1")
        } else {
            webView.restoreState(savedInstanceState)
        }
    }

    override fun onResume() {
        super.onResume()
        // Refresh Hotspot IP automatically when returning from Android Settings!
        webView.evaluateJavascript(
            "if (typeof window.onNativeNetworkChanged === 'function') window.onNativeNetworkChanged();",
            null
        )
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onDestroy() {
        if (isFinishing) {
            HotspotServerHolder.shutdown()
        }
        webView.destroy()
        super.onDestroy()
    }

    inner class NativeBridge {

        @JavascriptInterface
        fun getServerInfo(): String {
            val srv = HotspotServerHolder.getOrStart(applicationContext)
            return srv.buildServerInfoJson()
        }

        @JavascriptInterface
        fun setHotspotEnabled(enabled: Boolean) {
            HotspotServerHolder.setHotspotActive(applicationContext, enabled)
        }

        @JavascriptInterface
        fun openHotspotSettings() {
            runOnUiThread {
                val intents = listOf(
                    Intent(Intent.ACTION_MAIN).apply {
                        component = ComponentName(
                            "com.android.settings",
                            "com.android.settings.TetherSettings"
                        )
                    },
                    Intent(Settings.ACTION_WIRELESS_SETTINGS),
                    Intent(Settings.ACTION_WIFI_SETTINGS)
                )
                for (intent in intents) {
                    try {
                        startActivity(intent)
                        return@runOnUiThread
                    } catch (_: Exception) {
                    }
                }
            }
        }
    }
}
