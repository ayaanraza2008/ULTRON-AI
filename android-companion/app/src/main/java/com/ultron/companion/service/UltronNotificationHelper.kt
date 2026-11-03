package com.ultron.companion.service

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import com.ultron.companion.MainActivity

object UltronNotificationHelper {
    const val CHANNEL_COMMANDS = "ultron_commands_channel"
    const val CHANNEL_SYSTEM = "ultron_system_channel"

    fun createChannels(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return

        val cmdChannel = NotificationChannel(
            CHANNEL_COMMANDS,
            "ULTRON Commands & Tasks",
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "Notifications for cross-device remote actions and task execution"
            enableLights(true)
            enableVibration(true)
        }

        val sysChannel = NotificationChannel(
            CHANNEL_SYSTEM,
            "ULTRON System Presence",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Device connectivity and background sync status"
        }

        manager.createNotificationChannel(cmdChannel)
        manager.createNotificationChannel(sysChannel)
    }

    fun showTaskNotification(context: Context, id: Int, title: String, message: String) {
        createChannels(context)
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            context,
            id,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        val notification = android.app.Notification.Builder(context, CHANNEL_COMMANDS)
            .setContentTitle(title)
            .setContentText(message)
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .build()

        manager.notify(id, notification)
    }
}
