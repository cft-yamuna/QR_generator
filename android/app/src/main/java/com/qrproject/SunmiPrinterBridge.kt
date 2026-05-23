package com.qrproject

import android.app.Activity
import android.content.Context
import android.util.Log
import android.webkit.JavascriptInterface
import android.widget.Toast
import com.sunmi.peripheral.printer.SunmiPrinterService

class SunmiPrinterBridge(
    private val context: Context,
    private val serviceProvider: () -> SunmiPrinterService?
) {
    companion object {
        private const val TAG = "SunmiPrinterBridge"
    }

    @JavascriptInterface
    fun printText(text: String) {
        val printerService = serviceProvider()
        if (printerService == null) {
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
    fun printQR(qrData: String) {
        val printerService = serviceProvider()
        if (printerService == null) {
            showToast("Printer service not bound yet")
            Log.e(TAG, "printQR failed: printer service is null")
            return
        }
        try {
            Log.d(TAG, "Printing QR: $qrData")
            // Align center (1) for QR code
            printerService.setAlignment(1, null)
            // Print QR code: data, modulesize (4 = range 1-12, half of 8), errorlevel (2 = Q), callback
            printerService.printQRCode(qrData, 4, 2, null)
            // Feed a line after the QR code to separate it
            printerService.printText("\n", null)
        } catch (e: Exception) {
            Log.e(TAG, "Error printing QR", e)
            showToast("Print QR Error: ${e.message}")
        }
    }

    @JavascriptInterface
    fun cutPaper() {
        val printerService = serviceProvider()
        if (printerService == null) {
            showToast("Printer service not bound yet")
            Log.e(TAG, "cutPaper failed: printer service is null")
            return
        }
        try {
            Log.d(TAG, "Cutting paper (wrapping first)")
            // Feed 4 blank lines to push the output past the print head and tear bar/cutter
            printerService.lineWrap(4, null)
            printerService.cutPaper(null)
        } catch (e: Exception) {
            Log.e(TAG, "Error cutting paper", e)
            showToast("Cut Paper Error: ${e.message}")
        }
    }

    private fun showToast(message: String) {
        if (context is Activity) {
            context.runOnUiThread {
                Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
            }
        }
    }
}
