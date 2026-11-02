package io.github.kaikk963.nameplate

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.os.Bundle
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme = if (isSystemInDarkTheme()) darkColorScheme() else lightColorScheme()) {
                EditorScreen()
            }
        }
    }
}

private const val PREFS = "nameplate"
private const val KEY_JSON = "json"
private const val KEY_SHEET = "sheet_uri"
private const val KEY_TEXT = "draw_text"

private fun Context.toast(msg: String) = Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()

private fun loadSheet(context: Context, uri: Uri): Bitmap? = runCatching {
    context.contentResolver.openInputStream(uri)?.use {
        BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inScaled = false })
    }
}.getOrNull()

@Composable
private fun EditorScreen() {
    val context = LocalContext.current
    val prefs = remember { context.getSharedPreferences(PREFS, Context.MODE_PRIVATE) }

    var data by remember {
        mutableStateOf(
            prefs.getString(KEY_JSON, null)
                ?.let { runCatching { NamePlateData.fromJson(it) }.getOrNull() }
                ?: NamePlateData.DEFAULT
        )
    }
    var sheetUri by remember { mutableStateOf(prefs.getString(KEY_SHEET, null)?.let(Uri::parse)) }
    var sheet by remember { mutableStateOf<Bitmap?>(null) }
    var drawText by remember { mutableStateOf(prefs.getBoolean(KEY_TEXT, true)) }
    var tab by remember { mutableIntStateOf(0) }

    LaunchedEffect(sheetUri) { sheet = sheetUri?.let { loadSheet(context, it) } }
    LaunchedEffect(data, drawText) {
        prefs.edit().putString(KEY_JSON, data.toJson()).putBoolean(KEY_TEXT, drawText).apply()
    }

    val pickSheet = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            runCatching {
                context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            if (loadSheet(context, uri) == null) {
                context.toast("画像を読み込めませんでした")
            } else {
                sheetUri = uri
                prefs.edit().putString(KEY_SHEET, uri.toString()).apply()
            }
        }
    }
    val openJson = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) {
            runCatching {
                val text = context.contentResolver.openInputStream(uri)!!.use { it.readBytes().toString(Charsets.UTF_8) }
                NamePlateData.fromJson(text)
            }.onSuccess {
                data = it
                context.toast("JSONを読み込みました")
            }.onFailure { context.toast("JSONを読み込めませんでした: ${it.message}") }
        }
    }
    val saveJson = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")) { uri ->
        if (uri != null) {
            runCatching {
                context.contentResolver.openOutputStream(uri, "wt")!!.use { it.write(data.toJson().toByteArray(Charsets.UTF_8)) }
            }.onSuccess { context.toast("NamePlate.json を保存しました") }
                .onFailure { context.toast("保存できませんでした: ${it.message}") }
        }
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
            .safeDrawingPadding()
            .imePadding()
    ) {
        // プレビュー（スクロールしても常に見えるよう上部に固定）
        Card(Modifier.fillMaxWidth().padding(12.dp)) {
            val preview = remember(sheet, data, drawText) { NamePlatePreview.render(sheet, data, drawText) }
            Image(
                bitmap = preview.asImageBitmap(),
                contentDescription = "プレビュー",
                contentScale = ContentScale.FillWidth,
                filterQuality = FilterQuality.Medium,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFF808080))
                    .padding(8.dp)
            )
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    if (sheet == null) "NamePlate.png 未選択（簡易表示）" else "NamePlate.png 使用中",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.weight(1f)
                )
                Text("文字表示", style = MaterialTheme.typography.bodySmall)
                Switch(checked = drawText, onCheckedChange = { drawText = it }, modifier = Modifier.padding(start = 4.dp))
            }
            Spacer(Modifier.height(4.dp))
        }

        TabRow(selectedTabIndex = tab) {
            Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("1P") })
            Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("2P") })
        }

        Column(
            Modifier
                .weight(1f)
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            PlayerEditor(data.players[tab]) { data = data.withPlayer(tab, it) }

            Spacer(Modifier.height(8.dp))
            Button(onClick = { saveJson.launch("NamePlate.json") }, modifier = Modifier.fillMaxWidth()) {
                Text("ネームプレートをJSONに変換して保存")
            }
            OutlinedButton(onClick = { openJson.launch(arrayOf("application/json", "text/plain", "application/octet-stream", "*/*")) }, modifier = Modifier.fillMaxWidth()) {
                Text("JSONを読み込む")
            }
            OutlinedButton(onClick = { pickSheet.launch(arrayOf("image/png", "image/*")) }, modifier = Modifier.fillMaxWidth()) {
                Text("プレビュー用の NamePlate.png を選ぶ")
            }
        }
    }
}

@Composable
private fun PlayerEditor(p: PlayerPlate, onChange: (PlayerPlate) -> Unit) {
    OutlinedTextField(
        value = p.name, onValueChange = { onChange(p.copy(name = it)) },
        label = { Text("名前") }, singleLine = true, modifier = Modifier.fillMaxWidth()
    )
    OutlinedTextField(
        value = p.title, onValueChange = { onChange(p.copy(title = it)) },
        label = { Text("称号") }, singleLine = true, modifier = Modifier.fillMaxWidth()
    )
    Choice("称号の種類", NamePlateData.TITLE_TYPES, p.titleType) { onChange(p.copy(titleType = it)) }
    OutlinedTextField(
        value = p.dan, onValueChange = { onChange(p.copy(dan = it)) },
        label = { Text("段位（空欄で段位なし）") }, singleLine = true, modifier = Modifier.fillMaxWidth()
    )
    Choice("段位背景の種類", NamePlateData.DAN_TYPES, p.danType) { onChange(p.copy(danType = it)) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked = p.danGold, onCheckedChange = { onChange(p.copy(danGold = it)) })
        Text("金合格")
    }
}

@Composable
private fun Choice(label: String, options: List<String>, selected: Int, onSelect: (Int) -> Unit) {
    Column {
        Text(label, style = MaterialTheme.typography.labelLarge)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            options.forEachIndexed { i, s ->
                FilterChip(selected = selected == i, onClick = { onSelect(i) }, label = { Text(s) })
            }
        }
    }
}
