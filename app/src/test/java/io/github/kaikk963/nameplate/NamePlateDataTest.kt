package io.github.kaikk963.nameplate

import org.junit.Assert.assertEquals
import org.junit.Test

class NamePlateDataTest {

    @Test
    fun outputMatchesNewtonsoftIndentedFormat() {
        val expected = listOf(
            "{",
            "  \"name\": [",
            "    \"どんちゃん\",",
            "    \"かっちゃん\"",
            "  ],",
            "  \"title\": [",
            "    \"どんちゃん大好き！\",",
            "    \"かっちゃん大好き！\"",
            "  ],",
            "  \"dan\": [",
            "    \"初段\",",
            "    \"達人\"",
            "  ],",
            "  \"danGold\": [",
            "    false,",
            "    false",
            "  ],",
            "  \"danType\": [",
            "    0,",
            "    0",
            "  ],",
            "  \"titleType\": [",
            "    0,",
            "    0",
            "  ]",
            "}",
        ).joinToString("\r\n")
        assertEquals(expected, NamePlateData.DEFAULT.toJson())
    }

    @Test
    fun roundTrip() {
        val data = NamePlateData(
            listOf(
                PlayerPlate("A\"B\\C", "称号\n改行", "", true, 2, 1),
                PlayerPlate("2P", "t", "十段", false, 1, 2),
            )
        )
        assertEquals(data, NamePlateData.fromJson(data.toJson()))
    }

    @Test
    fun readsBomAndFillsMissingFields() {
        val json = "﻿{\"name\":[\"X\"],\"danType\":[5,-1]}"
        val data = NamePlateData.fromJson(json)
        assertEquals("X", data.players[0].name)
        assertEquals(NamePlateData.DEFAULT.players[1].name, data.players[1].name)
        assertEquals(2, data.players[0].danType)
        assertEquals(0, data.players[1].danType)
    }
}
