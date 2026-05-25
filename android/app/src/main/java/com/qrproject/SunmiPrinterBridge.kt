package com.qrproject

import android.app.Activity
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Base64
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import com.sunmi.peripheral.printer.SunmiPrinterService
import java.io.ByteArrayOutputStream

/**
 * JavaScript ↔ Sunmi printer bridge.
 *
 * PRINT METHOD STRATEGY — tries three methods in order until one succeeds:
 *   1. sendRAWData()      — raw ESC/POS GS v 0 raster (most universal)
 *   2. printBitmapCustom()— Sunmi SDK v1 bitmap API  (mid-era firmware)
 *   3. printBitmap()      — Sunmi SDK v2 bitmap API  (newer firmware)
 *
 * PAPER FEED / CUT STRATEGY:
 *   lineWrap() and cutPaper() are each wrapped in their own try-catch.
 *   Many Sunmi handheld models (V2, L2, D2 mini…) have no paper cutter
 *   and throw "this model does not support this method!" for those calls.
 *   If they fail we silently skip them — the badge still prints correctly.
 *
 * CALLBACK CONTRACT:
 *   Kotlin reports the real result back into JS via evaluateJavascript:
 *     window.__onPrintDone(success: Boolean, errorMessage: String)
 *   JS only shows "success" when Kotlin has confirmed the print completed.
 */
class SunmiPrinterBridge(
    private val context: Context,
    private val webView: WebView,
    private val serviceProvider: () -> SunmiPrinterService?
) {
    companion object {
        private const val TAG = "SunmiPrinterBridge"
    }

    // ── JS callback helpers ───────────────────────────────────────────────────

    private fun reportSuccess() {
        (context as? Activity)?.runOnUiThread {
            webView.evaluateJavascript(
                "if(typeof window.__onPrintDone==='function') window.__onPrintDone(true,'');",
                null
            )
        }
    }

    private fun reportError(message: String) {
        val safe = message.replace("\\", "\\\\").replace("'", "\\'")
        (context as? Activity)?.runOnUiThread {
            webView.evaluateJavascript(
                "if(typeof window.__onPrintDone==='function') window.__onPrintDone(false,'$safe');",
                null
            )
        }
    }

    // ── Primary print method ─────────────────────────────────────────────────

    @JavascriptInterface
    fun printBitmapAndCut(base64Png: String) {
        Log.d(TAG, "printBitmapAndCut — base64 length: ${base64Png.length} chars")

        val printerService = serviceProvider()
        if (printerService == null) {
            val msg = "Printer service not connected. Is the Sunmi printer running?"
            Log.e(TAG, msg)
            showToast(msg)
            reportError(msg)
            return
        }

        try {
            // ── 1. Decode the PNG that html2canvas rendered ───────────────────
            val pngBytes = Base64.decode(base64Png, Base64.DEFAULT)
            val bitmap   = BitmapFactory.decodeByteArray(pngBytes, 0, pngBytes.size)
                ?: throw IllegalStateException(
                    "BitmapFactory returned null — base64 length was ${base64Png.length}"
                )
            Log.d(TAG, "Bitmap decoded: ${bitmap.width} × ${bitmap.height} px")

            // Build ESC/POS bytes now (needed for method 1; harmless if unused)
            val escPosBytes = bitmapToEscPosRaster(bitmap)
            Log.d(TAG, "ESC/POS raster: ${escPosBytes.size} bytes")

            // ── 2. Hard reset ─────────────────────────────────────────────────
            try {
                printerService.printerInit(null)
            } catch (e: Exception) {
                Log.w(TAG, "printerInit failed (non-fatal): ${e.message}")
            }

            // ── 3. Try to print — three methods, first one that works wins ────
            var printed     = false
            val methodErrors = mutableListOf<String>()

            // Method A: sendRAWData with ESC/POS GS v 0 raster
            if (!printed) {
                try {
                    printerService.sendRAWData(escPosBytes, null)
                    printed = true
                    Log.d(TAG, "sendRAWData succeeded")
                } catch (e: Exception) {
                    methodErrors += "sendRAWData: ${e.message}"
                    Log.w(TAG, "sendRAWData failed: ${e.message}")
                }
            }

            // Method B: printBitmapCustom (Sunmi SDK v1)
            if (!printed) {
                try {
                    printerService.printBitmapCustom(bitmap, 0, null)
                    printed = true
                    Log.d(TAG, "printBitmapCustom succeeded")
                } catch (e: Exception) {
                    methodErrors += "printBitmapCustom: ${e.message}"
                    Log.w(TAG, "printBitmapCustom failed: ${e.message}")
                }
            }

            // Method C: printBitmap (Sunmi SDK v2)
            if (!printed) {
                try {
                    printerService.printBitmap(bitmap, null)
                    printed = true
                    Log.d(TAG, "printBitmap succeeded")
                } catch (e: Exception) {
                    methodErrors += "printBitmap: ${e.message}"
                    Log.w(TAG, "printBitmap failed: ${e.message}")
                }
            }

            bitmap.recycle()

            if (!printed) {
                val allErrors = methodErrors.joinToString(" | ")
                reportError("No print method succeeded on this device. Tried: $allErrors")
                return
            }

            // ── 4. Feed + cut — non-fatal (handheld models have no cutter) ───
            try {
                printerService.lineWrap(1, null)
                Log.d(TAG, "lineWrap OK")
            } catch (e: Exception) {
                Log.w(TAG, "lineWrap not supported on this model (non-fatal): ${e.message}")
            }

            try {
                printerService.cutPaper(null)
                Log.d(TAG, "cutPaper OK")
            } catch (e: Exception) {
                Log.w(TAG, "cutPaper not supported on this model (non-fatal): ${e.message}")
            }

            Log.d(TAG, "printBitmapAndCut complete — notifying JS")
            reportSuccess()

        } catch (e: Exception) {
            val msg = "Print failed: ${e.message ?: e.javaClass.simpleName}"
            Log.e(TAG, "Unexpected error in printBitmapAndCut", e)
            showToast(msg)
            reportError(msg)
        }
    }

    // ── ESC/POS GS v 0 raster conversion ────────────────────────────────────

    /**
     * Converts an Android [Bitmap] to an ESC/POS GS v 0 raster command.
     *
     *   1D 76 30 00  xL xH  yL yH  [row data...]
     *
     * Each row byte: MSB = leftmost pixel, bit=1 → print dot.
     * Luminance threshold 128 for clean monochrome output.
     */
    private fun bitmapToEscPosRaster(bitmap: Bitmap): ByteArray {
        val width       = bitmap.width
        val height      = bitmap.height
        val bytesPerRow = (width + 7) / 8

        val pixels = IntArray(width * height)
        bitmap.getPixels(pixels, 0, width, 0, 0, width, height)

        val out = ByteArrayOutputStream(8 + bytesPerRow * height)

        out.write(0x1D); out.write(0x76); out.write(0x30); out.write(0x00)
        out.write(bytesPerRow and 0xFF);         out.write((bytesPerRow shr 8) and 0xFF)
        out.write(height and 0xFF);              out.write((height shr 8) and 0xFF)

        for (y in 0 until height) {
            val row = ByteArray(bytesPerRow)
            for (x in 0 until width) {
                val px  = pixels[y * width + x]
                val lum = (0.299 * ((px shr 16) and 0xFF) +
                           0.587 * ((px shr  8) and 0xFF) +
                           0.114 * ( px          and 0xFF)).toInt()
                if (lum < 128) row[x / 8] = (row[x / 8].toInt() or (0x80 ushr (x % 8))).toByte()
            }
            out.write(row)
        }
        return out.toByteArray()
    }

    // ── Legacy / compatibility stubs ─────────────────────────────────────────

    @Suppress("UNUSED_PARAMETER")
    @JavascriptInterface
    fun printBadgeAndCut(visitorName: String, employeeId: String, qrData: String) {
        Log.w(TAG, "printBadgeAndCut() deprecated — use printBitmapAndCut(). No-op.")
    }

    @Suppress("UNUSED_PARAMETER")
    @JavascriptInterface
    fun printQRAndCut(qrData: String) {
        Log.w(TAG, "printQRAndCut() deprecated — use printBitmapAndCut(). No-op.")
    }

    @Suppress("UNUSED_PARAMETER")
    @JavascriptInterface
    fun printQR(qrData: String) {
        Log.w(TAG, "printQR() deprecated — use printBitmapAndCut(). No-op.")
    }

    @JavascriptInterface
    fun printText(text: String) {
        val printerService = serviceProvider() ?: run {
            showToast("Printer service not bound yet")
            Log.e(TAG, "printText failed: printer service is null")
            return
        }
        try {
            Log.d(TAG, "Printing text: $text")
            printerService.printerInit(null)
            printerService.printText(text, null)
        } catch (e: Exception) {
            Log.e(TAG, "Error printing text", e)
            showToast("Print Error: ${e.message}")
        }
    }

    @JavascriptInterface
    fun cutPaper() {
        Log.d(TAG, "cutPaper() — cut handled atomically inside printBitmapAndCut().")
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private fun showToast(message: String) {
        (context as? Activity)?.runOnUiThread {
            Toast.makeText(context, message, Toast.LENGTH_LONG).show()
        }
    }
}
