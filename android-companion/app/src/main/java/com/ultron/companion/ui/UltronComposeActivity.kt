package com.ultron.companion.ui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.ultron.companion.DeviceTokenStore
import com.ultron.companion.network.UltronApiClient
import com.ultron.companion.theme.*
import com.ultron.companion.ui.components.EnergyCoreState
import com.ultron.companion.ui.components.LivingEnergyCore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

class UltronComposeActivity : ComponentActivity() {
    private lateinit var apiClient: UltronApiClient

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        apiClient = UltronApiClient(this)

        setContent {
            UltronTheme {
                UltronMainDashboard(apiClient = apiClient)
            }
        }
    }
}

enum class NavigationTab(val title: String, val icon: String) {
    VOICE("Voice", "🎙️"),
    CHAT("Chat", "💬"),
    PC_CONTROL("PC Control", "💻"),
    PAIRING("Pairing", "⚡"),
    SETTINGS("Settings", "⚙️")
}

data class ChatMessage(val role: String, val content: String, val timestamp: String)
data class PcStatus(val online: Boolean, val name: String, val cpu: String, val ramPct: Int, val battery: Int, val activeWin: String)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UltronMainDashboard(apiClient: UltronApiClient) {
    var selectedTab by remember { mutableStateOf(NavigationTab.VOICE) }
    var coreState by remember { mutableStateOf(EnergyCoreState.STANDBY) }
    var voiceStatusText by remember { mutableStateOf("ULTRON ready. Tap Speak or use wake-word.") }
    val scope = rememberCoroutineScope()
    val context = androidx.compose.ui.platform.LocalContext.current

    // Shared PC status state
    var pcStatus by remember {
        mutableStateOf(PcStatus(false, "Windows PC", "AMD Ryzen 7 5700U", 45, 100, "Desktop"))
    }

    // Shared Chat messages
    val chatMessages = remember {
        mutableStateListOf(
            ChatMessage("assistant", "ULTRON Core online. Cross-device synchronization active.", "Now")
        )
    }

    // Periodic PC status polling
    LaunchedEffect(Unit) {
        while (true) {
            try {
                withContext(Dispatchers.IO) {
                    val raw = apiClient.fetchWindowsPcStatus()
                    pcStatus = PcStatus(
                        online = raw.optBoolean("online", false),
                        name = raw.optString("name", "Windows PC"),
                        cpu = "AMD Ryzen 7 5700U with Radeon Graphics",
                        ramPct = 42,
                        battery = raw.optJSONObject("battery")?.optInt("percent", 98) ?: 98,
                        activeWin = raw.optString("activeWindow", "Desktop")
                    )
                }
            } catch (_: Exception) {}
            kotlinx.coroutines.delay(8000)
        }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(10.dp)
                                .clip(CircleShape)
                                .background(if (pcStatus.online) UltronStatusOnline else UltronStatusOffline)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "ULTRON · MULTI-DEVICE ECOSYSTEM",
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            fontFamily = FontFamily.Monospace,
                            color = UltronTextPrimary
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = UltronVoidBlack
                )
            )
        },
        bottomBar = {
            NavigationBar(
                containerColor = UltronDarkObsidian,
                tonalElevation = 0.dp
            ) {
                NavigationTab.values().forEach { tab ->
                    NavigationBarItem(
                        selected = selectedTab == tab,
                        onClick = { selectedTab = tab },
                        icon = { Text(tab.icon, fontSize = 18.sp) },
                        label = {
                            Text(
                                tab.title,
                                fontSize = 11.sp,
                                fontFamily = FontFamily.Monospace,
                                color = if (selectedTab == tab) UltronCyan else UltronTextMuted
                            )
                        },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = UltronCyan,
                            unselectedIconColor = UltronTextMuted,
                            indicatorColor = UltronSurfaceCard
                        )
                    )
                }
            }
        },
        containerColor = UltronVoidBlack
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .background(UltronVoidBlack)
        ) {
            when (selectedTab) {
                NavigationTab.VOICE -> UltronVoiceScreen(
                    coreState = coreState,
                    statusText = voiceStatusText,
                    onSpeakClick = {
                        // Use the real Android SpeechRecognizer flow from MainActivity.
                        // The previous Compose-only handler simulated a successful command
                        // without recording speech or sending anything to ULTRON.
                        context.startActivity(
                            android.content.Intent(context, com.ultron.companion.MainActivity::class.java)
                                .putExtra(com.ultron.companion.MainActivity.EXTRA_START_VOICE_COMMAND, true)
                        )
                    }
                )
                NavigationTab.CHAT -> UltronChatScreen(
                    messages = chatMessages,
                    onSendMessage = { prompt ->
                        chatMessages.add(ChatMessage("user", prompt, "Just now"))
                        scope.launch {
                            try {
                                val res = withContext(Dispatchers.IO) {
                                    apiClient.processVoiceCommand(prompt, "hinglish")
                                }
                                val reply = res.optString("textResponse", "Command acknowledged.")
                                chatMessages.add(ChatMessage("assistant", reply, "Just now"))
                            } catch (e: Exception) {
                                chatMessages.add(ChatMessage("assistant", "Error: ${e.message}", "Just now"))
                            }
                        }
                    }
                )
                NavigationTab.PC_CONTROL -> UltronPcControlScreen(
                    pcStatus = pcStatus,
                    onActionClick = { action, appKey ->
                        scope.launch {
                            try {
                                val payload = if (appKey != null) JSONObject().put("app", appKey) else JSONObject()
                                val outcome = withContext(Dispatchers.IO) {
                                    apiClient.routeCommandToWindows(action, payload)
                                }
                                chatMessages.add(ChatMessage("assistant", "PC Action ($action): ${outcome.optString("status", "Dispatched")}", "Just now"))
                            } catch (e: Exception) {
                                chatMessages.add(ChatMessage("assistant", "PC Action Failed: ${e.message}", "Just now"))
                            }
                        }
                    }
                )
                NavigationTab.PAIRING -> UltronPairingScreen(apiClient = apiClient)
                NavigationTab.SETTINGS -> UltronSettingsScreen(pcStatus = pcStatus)
            }
        }
    }
}

@Composable
fun UltronVoiceScreen(
    coreState: EnergyCoreState,
    statusText: String,
    onSpeakClick: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.SpaceBetween
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text(
                "LIVING ENERGY CORE",
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                color = UltronCyan,
                letterSpacing = 2.sp
            )
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                "Unified Central Intelligence · Android Node",
                fontSize = 12.sp,
                color = UltronTextSecondary
            )
        }

        LivingEnergyCore(
            size = 200.dp,
            state = coreState
        )

        Column(
            modifier = Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                statusText,
                fontSize = 14.sp,
                color = UltronTextPrimary,
                fontFamily = FontFamily.Monospace
            )
            Spacer(modifier = Modifier.height(20.dp))
            Button(
                onClick = onSpeakClick,
                colors = ButtonDefaults.buttonColors(containerColor = UltronCyan),
                shape = RoundedCornerShape(24.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(52.dp)
            ) {
                Text(
                    "🎙️ SPEAK TO ULTRON",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace,
                    color = UltronVoidBlack
                )
            }
        }
    }
}

@Composable
fun UltronChatScreen(
    messages: List<ChatMessage>,
    onSendMessage: (String) -> Unit
) {
    var textInput by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        LazyColumn(
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth(),
            reverseLayout = true
        ) {
            items(messages.reversed()) { msg ->
                val isUser = msg.role == "user"
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp),
                    horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
                ) {
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(12.dp))
                            .background(if (isUser) UltronPurple else UltronSurfaceCard)
                            .border(1.dp, if (isUser) UltronViolet else UltronBorderGlow, RoundedCornerShape(12.dp))
                            .padding(12.dp)
                            .widthIn(max = 280.dp)
                    ) {
                        Column {
                            Text(
                                if (isUser) "OPERATOR" else "ULTRON",
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                fontFamily = FontFamily.Monospace,
                                color = if (isUser) UltronTextPrimary else UltronCyan
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                msg.content,
                                fontSize = 14.sp,
                                color = UltronTextPrimary
                            )
                        }
                    }
                }
            }
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            OutlinedTextField(
                value = textInput,
                onValueChange = { textInput = it },
                placeholder = { Text("Command ULTRON...", color = UltronTextMuted) },
                colors = OutlinedTextFieldDefaults.colors(
                    focusedTextColor = UltronTextPrimary,
                    unfocusedTextColor = UltronTextPrimary,
                    focusedBorderColor = UltronCyan,
                    unfocusedBorderColor = UltronBorderGlow
                ),
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.weight(1f)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Button(
                onClick = {
                    if (textInput.isNotBlank()) {
                        onSendMessage(textInput.trim())
                        textInput = ""
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = UltronCyan),
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.height(56.dp)
            ) {
                Text("➤", color = UltronVoidBlack, fontSize = 18.sp)
            }
        }
    }
}

@Composable
fun UltronPcControlScreen(
    pcStatus: PcStatus,
    onActionClick: (action: String, appKey: String?) -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp)
    ) {
        // PC Status Card
        Card(
            colors = CardDefaults.cardColors(containerColor = UltronDarkObsidian),
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier
                .fillMaxWidth()
                .border(1.dp, if (pcStatus.online) UltronCyan else UltronStatusOffline, RoundedCornerShape(16.dp))
                .padding(2.dp)
        ) {
            Column(modifier = Modifier.padding(16.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        pcStatus.name.uppercase(),
                        fontWeight = FontWeight.Bold,
                        fontFamily = FontFamily.Monospace,
                        color = UltronTextPrimary
                    )
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (pcStatus.online) UltronStatusOnline.copy(alpha = 0.2f) else UltronStatusOffline.copy(alpha = 0.2f))
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        Text(
                            if (pcStatus.online) "ONLINE · CONNECTED" else "OFFLINE · UNREACHABLE",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (pcStatus.online) UltronStatusOnline else UltronStatusOffline,
                            fontFamily = FontFamily.Monospace
                        )
                    }
                }
                Spacer(modifier = Modifier.height(12.dp))
                Text("CPU: ${pcStatus.cpu}", fontSize = 12.sp, color = UltronTextSecondary)
                Text("RAM Usage: ${pcStatus.ramPct}% · 8 GB RAM Safe", fontSize = 12.sp, color = UltronTextSecondary)
                Text("Active Window: ${pcStatus.activeWin}", fontSize = 12.sp, color = UltronTextSecondary)
            }
        }

        Spacer(modifier = Modifier.height(20.dp))
        Text(
            "APPROVED REMOTE COMMANDS",
            fontSize = 12.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Monospace,
            color = UltronCyan,
            letterSpacing = 1.sp
        )
        Spacer(modifier = Modifier.height(12.dp))

        val actions = listOf(
            Triple("🌐 Launch Chrome", "launch_app", "chrome"),
            Triple("🧭 Launch Edge", "launch_app", "msedge"),
            Triple("💻 Launch VS Code", "launch_app", "code"),
            Triple("📝 Launch Notepad", "launch_app", "notepad"),
            Triple("🧮 Launch Calculator", "launch_app", "calculator"),
            Triple("⚡ Launch Terminal", "launch_app", "terminal"),
            Triple("🔒 Lock Workstation", "lock_workstation", null),
            Triple("🔊 Volume Up", "set_volume", null),
            Triple("📸 Screen Capture", "screen_capture", null)
        )

        LazyColumn(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            items(actions) { (label, action, app) ->
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(UltronSurfaceCard)
                        .border(1.dp, UltronBorderGlow, RoundedCornerShape(12.dp))
                        .clickable(enabled = pcStatus.online) { onActionClick(action, app) }
                        .padding(14.dp)
                ) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            label,
                            fontSize = 13.sp,
                            fontFamily = FontFamily.Monospace,
                            color = if (pcStatus.online) UltronTextPrimary else UltronTextMuted
                        )
                        Text(
                            "RUN ➔",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (pcStatus.online) UltronCyan else UltronTextMuted,
                            fontFamily = FontFamily.Monospace
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun UltronPairingScreen(apiClient: UltronApiClient) {
    var pairingCodeInput by remember { mutableStateOf("") }
    var pairingResultText by remember { mutableStateOf("Ready to pair with Windows companion.") }
    val scope = rememberCoroutineScope()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Text(
            "DEVICE PAIRING & SECURITY",
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Monospace,
            color = UltronCyan,
            letterSpacing = 1.sp
        )
        Spacer(modifier = Modifier.height(16.dp))
        Text(
            "Scan the QR code displayed in your ULTRON Command Center or enter the 6-digit one-time code.",
            fontSize = 12.sp,
            color = UltronTextSecondary,
            lineHeight = 18.sp
        )
        Spacer(modifier = Modifier.height(24.dp))

        OutlinedTextField(
            value = pairingCodeInput,
            onValueChange = { pairingCodeInput = it },
            label = { Text("6-Digit Code", color = UltronTextMuted) },
            colors = OutlinedTextFieldDefaults.colors(
                focusedTextColor = UltronTextPrimary,
                unfocusedTextColor = UltronTextPrimary,
                focusedBorderColor = UltronCyan,
                unfocusedBorderColor = UltronBorderGlow
            ),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(modifier = Modifier.height(16.dp))

        Button(
            onClick = {
                scope.launch {
                    try {
                        withContext(Dispatchers.IO) {
                            apiClient.claimPairingCode(pairingCodeInput.trim())
                        }
                        pairingResultText = "Pairing successful! Token secured in Android Keystore."
                    } catch (e: Exception) {
                        pairingResultText = "Pairing failed: ${e.message}"
                    }
                }
            },
            colors = ButtonDefaults.buttonColors(containerColor = UltronCyan),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier.fillMaxWidth().height(48.dp)
        ) {
            Text("CLAIM PAIRING CODE", color = UltronVoidBlack, fontWeight = FontWeight.Bold)
        }

        Spacer(modifier = Modifier.height(24.dp))
        Text(
            pairingResultText,
            fontSize = 12.sp,
            color = UltronTextPrimary,
            fontFamily = FontFamily.Monospace
        )
    }
}

@Composable
fun UltronSettingsScreen(pcStatus: PcStatus) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp)
    ) {
        Text(
            "ECOSYSTEM SETTINGS",
            fontSize = 13.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Monospace,
            color = UltronCyan,
            letterSpacing = 1.sp
        )
        Spacer(modifier = Modifier.height(20.dp))

        Text("CONNECTIVITY MODES", fontSize = 11.sp, color = UltronTextMuted, fontFamily = FontFamily.Monospace)
        Spacer(modifier = Modifier.height(8.dp))
        Text("• Local Wi-Fi Mode (Same-LAN Direct WebSocket)", fontSize = 12.sp, color = UltronTextPrimary)
        Text("• Tailscale Private Network (100.x.y.z CGNAT)", fontSize = 12.sp, color = UltronTextPrimary)
        Text("• Encrypted Cloud Relay (Zero Public Windows Ports)", fontSize = 12.sp, color = UltronTextPrimary)

        Spacer(modifier = Modifier.height(24.dp))
        Text("HARDWARE SPECIFICATIONS", fontSize = 11.sp, color = UltronTextMuted, fontFamily = FontFamily.Monospace)
        Spacer(modifier = Modifier.height(8.dp))
        Text("• Host Processor: AMD Ryzen 7 5700U (8C/16T)", fontSize = 12.sp, color = UltronTextSecondary)
        Text("• System RAM: 8.00 GB DDR4 (Throttle ceiling: 85%)", fontSize = 12.sp, color = UltronTextSecondary)
        Text("• GPU: AMD Radeon Graphics (Integrated - No CUDA)", fontSize = 12.sp, color = UltronTextSecondary)
        Text("• Android Node: Keystore AES-256-GCM Encrypted", fontSize = 12.sp, color = UltronTextSecondary)
    }
}
