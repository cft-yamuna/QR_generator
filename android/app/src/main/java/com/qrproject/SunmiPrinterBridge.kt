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
        // Sunmi 80mm thermal printer: 576 printable dots (203 DPI × 72mm printable width)
        private const val PRINTABLE_WIDTH_DOTS = 576
        // 38% of printable width → compact QR, clean margins, fully scannable
        private const val QR_PAPER_WIDTH_RATIO = 0.38
        private const val QR_MODULE_SIZE_MIN = 3
        private const val QR_MODULE_SIZE_MAX = 5
    }

    /**
     * Estimates the number of QR modules (cells) based on data length.
     * Corresponds to QR versions 3–7 covering typical URL lengths.
     */
    private fun estimateQrModuleCount(data: String): Int {
        return when {
            data.length <= 32  -> 29  // Version 3
            data.length <= 53  -> 33  // Version 4
            data.length <= 78  -> 37  // Version 5
            data.length <= 106 -> 41  // Version 6
            else               -> 45  // Version 7
        }
    }

    /**
     * Calculates the optimal module size so the QR fills [QR_PAPER_WIDTH_RATIO]
     * of the printable width while remaining fully scannable.
     */
    private fun getQrModuleSizeForPaper(data: String): Int {
        val targetDots = (PRINTABLE_WIDTH_DOTS * QR_PAPER_WIDTH_RATIO).toInt()
        val moduleSize = targetDots / estimateQrModuleCount(data)
        return moduleSize.coerceIn(QR_MODULE_SIZE_MIN, QR_MODULE_SIZE_MAX)
    }

    /**
     * Prints a QR code and cuts the paper in a single atomic AIDL call sequence.
     *
     * WHY ATOMIC: Calling printQR() + cutPaper() as two separate JS bridge calls
     * creates a race between two independent AIDL transactions. The line feeds in
     * cutPaper() then add non-deterministic offset before the next printerInit(),
     * causing the QR position to drift lower with every successive print job.
     *
     * By combining print + cut into ONE function, all commands execute in one
     * locked sequence with no inter-call state bleed — position is identical
     * on every single receipt.
     */
    @JavascriptInterface
    fun printQRAndCut(qrData: String) {
        val printerService = serviceProvider()
        if (printerService == null) {
            showToast("Printer service not bound yet")
            Log.e(TAG, "printQRAndCut failed: printer service is null")
            return
        }
        try {
            Log.d(TAG, "printQRAndCut — QR length: ${qrData.length} chars")

            // 1. Hard reset: clears all formatting, alignment, and buffered state
            printerService.printerInit(null)

            // 2. Center alignment — applied immediately after reset
            printerService.setAlignment(1, null)

            // 3. Print the QR code — no lineWrap before it so position is always
            //    flush with the paper-top after printerInit, giving consistent output
            val moduleSize = getQrModuleSizeForPaper(qrData)
            Log.d(TAG, "QR module size: $moduleSize dots/cell")
            printerService.printQRCode(qrData, moduleSize, 2, null)

            // 4. Feed exactly 3 lines to push the QR past the print head/cutter,
            //    then cut — all in the same atomic sequence as the print above
            printerService.lineWrap(3, null)
            printerService.cutPaper(null)

            Log.d(TAG, "printQRAndCut complete")
        } catch (e: Exception) {
            Log.e(TAG, "Error in printQRAndCut", e)
            showToast("Print Error: ${e.message}")
        }
    }

    // ── Legacy individual functions kept for backward compatibility ───────────

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
        // Delegates to the atomic combined function.
        // Kept for compatibility; JS should call printQRAndCut() directly.
        printQRAndCut(qrData)
    }

    @JavascriptInterface
    fun cutPaper() {
        // No-op when called after printQRAndCut() — the cut already happened.
        // Kept so existing JS calls don't throw a "method not found" error.
        Log.d(TAG, "cutPaper() called — cut was already handled by printQRAndCut()")
    }

    private fun showToast(message: String) {
        if (context is Activity) {
            context.runOnUiThread {
                Toast.makeText(context, message, Toast.LENGTH_SHORT).show()
            }
        }
    }
}
