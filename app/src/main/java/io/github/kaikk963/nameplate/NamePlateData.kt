package io.github.kaikk963.nameplate

import org.json.JSONArray
import org.json.JSONObject

/** 1人分のネームプレート設定 */
data class PlayerPlate(
    val name: String,
    val title: String,
    val dan: String,
    val danGold: Boolean,
    /** 段位背景の種類: 0=白, 1=金, 2=虹 */
    val danType: Int,
    /** 称号の種類: 0=木, 1=金, 2=紫 */
    val titleType: Int,
)

/**
 * TJAPlayer3-Develop-ReWrite の NamePlate.json 形式。
 *
 * ```
 * {
 *   "name": [1P, 2P],
 *   "title": [1P, 2P],
 *   "dan": [1P, 2P],
 *   "danGold": [1P, 2P],
 *   "danType": [1P, 2P],
 *   "titleType": [1P, 2P]
 * }
 * ```
 */
data class NamePlateData(val players: List<PlayerPlate>) {

    init {
        require(players.size == 2) { "players must contain 1P and 2P" }
    }

    fun withPlayer(index: Int, player: PlayerPlate): NamePlateData =
        NamePlateData(players.toMutableList().also { it[index] = player })

    /** Newtonsoft.Json の Formatting.Indented と同じ見た目（2スペース・CRLF）で出力する */
    fun toJson(): String {
        val nl = "\r\n"
        fun strings(values: List<String>) = values.joinToString(",$nl") { "    " + quote(it) }
        fun raw(values: List<Any>) = values.joinToString(",$nl") { "    $it" }
        val fields = listOf(
            "name" to strings(players.map { it.name }),
            "title" to strings(players.map { it.title }),
            "dan" to strings(players.map { it.dan }),
            "danGold" to raw(players.map { it.danGold }),
            "danType" to raw(players.map { it.danType }),
            "titleType" to raw(players.map { it.titleType }),
        )
        return fields.joinToString(prefix = "{$nl", separator = ",$nl", postfix = "$nl}") { (key, body) ->
            "  \"$key\": [$nl$body$nl  ]"
        }
    }

    companion object {
        val DEFAULT = NamePlateData(
            listOf(
                PlayerPlate("どんちゃん", "どんちゃん大好き！", "初段", false, 0, 0),
                PlayerPlate("かっちゃん", "かっちゃん大好き！", "達人", false, 0, 0),
            )
        )

        val TITLE_TYPES = listOf("木", "金", "紫")
        val DAN_TYPES = listOf("白", "金", "虹")

        /** NamePlate.json を読み込む。足りない項目は既定値で補う。 */
        fun fromJson(text: String): NamePlateData {
            val obj = JSONObject(text.removePrefix("﻿"))

            fun arr(vararg keys: String): JSONArray? =
                keys.firstNotNullOfOrNull { k -> obj.keys().asSequence().firstOrNull { it.equals(k, ignoreCase = true) } }
                    ?.let { obj.optJSONArray(it) }

            val name = arr("name")
            val title = arr("title")
            val dan = arr("dan")
            val danGold = arr("danGold")
            val danType = arr("danType")
            val titleType = arr("titleType")

            return NamePlateData(
                (0..1).map { i ->
                    val d = DEFAULT.players[i]
                    PlayerPlate(
                        name = name?.optString(i, d.name) ?: d.name,
                        title = title?.optString(i, d.title) ?: d.title,
                        dan = dan?.optString(i, d.dan) ?: d.dan,
                        danGold = danGold?.optBoolean(i, d.danGold) ?: d.danGold,
                        danType = (danType?.optInt(i, d.danType) ?: d.danType).coerceIn(0, 2),
                        titleType = (titleType?.optInt(i, d.titleType) ?: d.titleType).coerceIn(0, 2),
                    )
                }
            )
        }

        private fun quote(s: String): String = buildString {
            append('"')
            for (c in s) {
                when (c) {
                    '"' -> append("\\\"")
                    '\\' -> append("\\\\")
                    '\n' -> append("\\n")
                    '\r' -> append("\\r")
                    '\t' -> append("\\t")
                    '\b' -> append("\\b")
                    '\u000C' -> append("\\f")
                    else -> if (c < ' ') append("\\u%04x".format(c.code)) else append(c)
                }
            }
            append('"')
        }
    }
}
