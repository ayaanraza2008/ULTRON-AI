package com.ultron.companion.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val UltronDarkColorScheme = darkColorScheme(
    primary = UltronCyan,
    onPrimary = UltronVoidBlack,
    secondary = UltronCrimson,
    onSecondary = UltronTextPrimary,
    tertiary = UltronPurple,
    background = UltronVoidBlack,
    onBackground = UltronTextPrimary,
    surface = UltronDarkObsidian,
    onSurface = UltronTextPrimary,
    surfaceVariant = UltronSurfaceCard,
    onSurfaceVariant = UltronTextSecondary,
    outline = UltronBorderGlow
)

@Composable
fun UltronTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = UltronDarkColorScheme,
        content = content
    )
}
