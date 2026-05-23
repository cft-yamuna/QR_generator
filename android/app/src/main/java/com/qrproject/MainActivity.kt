package com.qrproject

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.net.http.SslError
import android.os.Bundle
import android.util.Log
import android.view.GestureDetector
import android.view.MotionEvent
import android.webkit.SslErrorHandler
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.EditText
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import com.qrproject.databinding.ActivityMainBinding
import com.sunmi.peripheral.printer.InnerPrinterCallback
import com.sunmi.peripheral.printer.InnerPrinterManager
import com.sunmi.peripheral.printer.SunmiPrinterService

class MainActivity : AppCompatActivity() {

    companion object {
        private const val TAG = "MainActivity"
        private const val PREFS_NAME = "QRProjectPrefs"
        private const val KEY_SERVER_URL = "serverUrl"
        private const val DEFAULT_URL = "https://192.168.0.65:5173/"
    }

    private lateinit var binding: ActivityMainBinding
    private var sunmiPrinterService: SunmiPrinterService? = null
    private lateinit var sharedPreferences: SharedPreferences

    private val innerPrinterCallback = object : InnerPrinterCallback() {
        override fun onConnected(service: SunmiPrinterService?) {
            Log.d(TAG, "Sunmi Printer Service Connected")
            sunmiPrinterService = service
            runOnUiThread {
                Toast.makeText(this@MainActivity, "Printer service connected", Toast.LENGTH_SHORT).show()
            }
        }

        override fun onDisconnected() {
            Log.d(TAG, "Sunmi Printer Service Disconnected")
            sunmiPrinterService = null
            runOnUiThread {
                Toast.makeText(this@MainActivity, "Printer service disconnected", Toast.LENGTH_SHORT).show()
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "ClickableViewAccessibility")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        sharedPreferences = getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val serverUrl = sharedPreferences.getString(KEY_SERVER_URL, DEFAULT_URL) ?: DEFAULT_URL

        // Initialize Sunmi Printer SDK
        bindPrinterService()

        // Setup WebView
        setupWebView()

        // Load URL
        binding.webView.loadUrl(serverUrl)

        // Setup two-finger double-tap to change loaded URL (developer feature)
        setupUrlChangeGesture()
    }

    private fun bindPrinterService() {
        try {
            val result = InnerPrinterManager.getInstance().bindService(this, innerPrinterCallback)
            if (!result) {
                Log.e(TAG, "Failed to bind Sunmi Printer Service")
                Toast.makeText(this, "Failed to connect to Sunmi Printer", Toast.LENGTH_LONG).show()
            }
        } catch (e: Exception) {
            Log.e(TAG, "Error binding Sunmi service", e)
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        val webSettings: WebSettings = binding.webView.settings
        webSettings.javaScriptEnabled = true
        webSettings.domStorageEnabled = true
        webSettings.databaseEnabled = true
        webSettings.useWideViewPort = true
        webSettings.loadWithOverviewMode = true
        webSettings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW

        // Expose JavaScript Interface
        binding.webView.addJavascriptInterface(
            SunmiPrinterBridge(this) { sunmiPrinterService },
            "Android"
        )

        binding.webView.webViewClient = object : WebViewClient() {
            @SuppressLint("WebViewClientOnReceivedSslError")
            override fun onReceivedSslError(
                view: WebView?,
                handler: SslErrorHandler?,
                error: SslError?
            ) {
                // Since this runs in a local environment (Vite with self-signed certificate),
                // we bypass SSL validation errors so it can load successfully.
                Log.w(TAG, "SSL Error bypassed: $error")
                handler?.proceed()
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                super.onPageFinished(view, url)
                Log.d(TAG, "Finished loading: $url")
            }
        }
    }

    @SuppressLint("ClickableViewAccessibility")
    private fun setupUrlChangeGesture() {
        val gestureDetector = GestureDetector(this, object : GestureDetector.SimpleOnGestureListener() {
            override fun onDoubleTap(e: MotionEvent): Boolean {
                showUrlSettingsDialog()
                return true
            }
        })

        // Capture touch events in WebView to detect double taps for settings
        binding.webView.setOnTouchListener { _, event ->
            gestureDetector.onTouchEvent(event)
            // Return false so WebView continues to handle standard scrolling/clicks
            false
        }
    }

    private fun showUrlSettingsDialog() {
        val currentUrl = sharedPreferences.getString(KEY_SERVER_URL, DEFAULT_URL) ?: DEFAULT_URL
        val input = EditText(this)
        input.setText(currentUrl)

        AlertDialog.Builder(this)
            .setTitle("Configure Server URL")
            .setMessage("Enter the URL of the Vite Dev Server or production web app:")
            .setView(input)
            .setPositiveButton("Save & Reload") { _, _ ->
                val newUrl = input.text.toString().trim()
                if (newUrl.isNotEmpty()) {
                    sharedPreferences.edit().putString(KEY_SERVER_URL, newUrl).apply()
                    binding.webView.loadUrl(newUrl)
                    Toast.makeText(this, "Loading: $newUrl", Toast.LENGTH_SHORT).show()
                }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    override fun onDestroy() {
        super.onDestroy()
        // Unbind Sunmi Printer Service to prevent memory leaks
        try {
            InnerPrinterManager.getInstance().unBindService(this, innerPrinterCallback)
        } catch (e: Exception) {
            Log.e(TAG, "Error unbinding Sunmi service", e)
        }
    }

    override fun onBackPressed() {
        if (binding.webView.canGoBack()) {
            binding.webView.goBack()
        } else {
            super.onBackPressed()
        }
    }
}
