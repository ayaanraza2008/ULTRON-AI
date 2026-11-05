package com.ultron.companion.service

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.ultron.companion.DeviceTokenStore
import com.ultron.companion.network.UltronApiClient

class UltronSyncWorker(
    appContext: Context,
    workerParams: WorkerParameters
) : CoroutineWorker(appContext, workerParams) {

    override suspend fun doWork(): Result {
        if (!DeviceTokenStore.isPaired(applicationContext)) {
            return Result.success()
        }

        return try {
            val client = UltronApiClient(applicationContext)

            // 1. Gather battery telemetry
            val batteryStatus: Intent? = IntentFilter(Intent.ACTION_BATTERY_CHANGED).let { filter ->
                applicationContext.registerReceiver(null, filter)
            }
            val level: Int = batteryStatus?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
            val scale: Int = batteryStatus?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
            if (level < 0 || scale <= 0) {
                return Result.retry()
            }
            val batteryPct = (level * 100 / scale).coerceIn(0, 100)
            val status: Int = batteryStatus?.getIntExtra(BatteryManager.EXTRA_STATUS, -1) ?: -1
            val isCharging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
                    status == BatteryManager.BATTERY_STATUS_FULL

            if (!client.sendTelemetry(batteryPct, isCharging)) {
                return Result.retry()
            }
            if (!client.syncPendingStateEvents()) {
                return Result.retry()
            }
            Result.success()
        } catch (_: Exception) {
            Result.retry()
        }
    }
}
