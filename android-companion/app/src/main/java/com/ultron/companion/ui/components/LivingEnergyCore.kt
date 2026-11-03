package com.ultron.companion.ui.components

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.ultron.companion.theme.*

enum class EnergyCoreState {
    STANDBY,
    LISTENING,
    THINKING,
    SPEAKING,
    EXECUTING,
    OFFLINE
}

@Composable
fun LivingEnergyCore(
    modifier: Modifier = Modifier,
    size: Dp = 180.dp,
    state: EnergyCoreState = EnergyCoreState.STANDBY
) {
    val infiniteTransition = rememberInfiniteTransition(label = "UltronCoreAnimation")

    val rotation by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 6000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "CoreRotation"
    )

    val counterRotation by infiniteTransition.animateFloat(
        initialValue = 360f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 4000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "CounterRotation"
    )

    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 0.85f,
        targetValue = 1.15f,
        animationSpec = infiniteRepeatable(
            animation = tween(
                durationMillis = when (state) {
                    EnergyCoreState.LISTENING -> 800
                    EnergyCoreState.SPEAKING -> 1200
                    EnergyCoreState.THINKING -> 600
                    EnergyCoreState.EXECUTING -> 500
                    else -> 2200
                },
                easing = FastOutSlowInEasing
            ),
            repeatMode = RepeatMode.Reverse
        ),
        label = "CorePulse"
    )

    val stateColors = when (state) {
        EnergyCoreState.LISTENING -> Pair(UltronStatusListening, UltronCrimson)
        EnergyCoreState.THINKING -> Pair(UltronPurple, UltronViolet)
        EnergyCoreState.SPEAKING -> Pair(UltronCyan, UltronPurple)
        EnergyCoreState.EXECUTING -> Pair(UltronCrimson, UltronStatusListening)
        EnergyCoreState.OFFLINE -> Pair(UltronTextMuted, Color(0xFF334155))
        EnergyCoreState.STANDBY -> Pair(UltronCyan, UltronPurple)
    }

    Box(
        modifier = modifier.size(size),
        contentAlignment = Alignment.Center
    ) {
        Canvas(modifier = Modifier.size(size)) {
            val center = Offset(size.toPx() / 2f, size.toPx() / 2f)
            val radius = size.toPx() / 2f - 12f

            // 1. Ambient outer glow gradient
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(
                        stateColors.first.copy(alpha = 0.25f * pulseScale),
                        stateColors.second.copy(alpha = 0.08f),
                        Color.Transparent
                    ),
                    center = center,
                    radius = radius * 1.2f
                ),
                radius = radius * 1.1f,
                center = center
            )

            // 2. Outer segmented tech ring (Rotating clockwise)
            drawCircle(
                color = stateColors.first.copy(alpha = 0.4f),
                radius = radius,
                center = center,
                style = Stroke(
                    width = 2.5f,
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(24f, 16f, 8f, 16f), rotation * 2f)
                )
            )

            // 3. Middle energy arc ring (Counter-clockwise rotation)
            drawArc(
                brush = Brush.sweepGradient(
                    listOf(
                        stateColors.first,
                        stateColors.second,
                        Color.Transparent,
                        stateColors.first
                    ),
                    center = center
                ),
                startAngle = counterRotation,
                sweepAngle = 240f,
                useCenter = false,
                style = Stroke(width = 3.5f),
                topLeft = Offset(center.x - radius * 0.75f, center.y - radius * 0.75f),
                size = androidx.compose.ui.geometry.Size(radius * 1.5f, radius * 1.5f)
            )

            // 4. Central Reactor Nucleus
            val coreRadius = radius * 0.35f * pulseScale
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(
                        Color.White,
                        stateColors.first,
                        stateColors.second
                    ),
                    center = center,
                    radius = coreRadius
                ),
                radius = coreRadius,
                center = center
            )
        }
    }
}
