package io.github.kaikk963.nameplate

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.Typeface

/**
 * NamePlate.png（幅220・高さ54のコマが縦に並んだ画像）からプレビュー画像を合成する。
 *
 * コマの並び（上から）:
 *  0: 1P バッジ / 1: 1P バッジ（別色） / 2: 2P バッジ / 3: 土台
 *  4〜6: 称号（木・金・紫） / 7: 段位の土台 / 8〜10: 段位（白・金・虹） / 11: 金合格
 */
object NamePlatePreview {
    const val W = 220
    const val H = 54
    private const val GAP = 26 // 1P と 2P の間の余白

    private fun frame(index: Int) = Rect(0, H * index, W, H * (index + 1))

    fun render(sheet: Bitmap?, data: NamePlateData, drawText: Boolean): Bitmap {
        val out = Bitmap.createBitmap(W, H * 2 + GAP, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(out)
        data.players.forEachIndexed { i, p ->
            val top = i * (H + GAP)
            if (sheet != null) {
                drawPlate(canvas, sheet, p, badge = if (i == 0) 0 else 2, top = top)
            } else {
                drawFallback(canvas, p, i, top)
            }
            if (drawText) drawTexts(canvas, p, top)
        }
        return out
    }

    private fun drawPlate(canvas: Canvas, sheet: Bitmap, p: PlayerPlate, badge: Int, top: Int) {
        val paint = Paint(Paint.FILTER_BITMAP_FLAG)
        val dst = Rect(0, top, W, top + H)
        fun layer(index: Int) {
            val src = frame(index)
            if (src.bottom <= sheet.height) canvas.drawBitmap(sheet, src, dst, paint)
        }
        layer(3)
        layer(4 + p.titleType.coerceIn(0, 2))
        if (p.dan.isNotEmpty()) {
            layer(7)
            layer(8 + p.danType.coerceIn(0, 2))
            if (p.danGold) layer(11)
        }
        layer(badge)
    }

    /** NamePlate.png が未選択のときの簡易表示 */
    private fun drawFallback(canvas: Canvas, p: PlayerPlate, i: Int, top: Int) {
        val fill = Paint(Paint.ANTI_ALIAS_FLAG)
        val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE; strokeWidth = 3f; color = Color.BLACK
        }
        fill.color = Color.WHITE
        canvas.drawRoundRect(3f, top + 3f, W - 3f, top + H - 3f, 24f, 24f, fill)
        canvas.drawRoundRect(3f, top + 3f, W - 3f, top + H - 3f, 24f, 24f, stroke)
        fill.color = intArrayOf(0xFFD9A05B.toInt(), 0xFFE0B020.toInt(), 0xFFA020F0.toInt())[p.titleType.coerceIn(0, 2)]
        canvas.drawRoundRect(8f, top + 6f, W - 8f, top + 27f, 10f, 10f, fill)
        if (p.dan.isNotEmpty()) {
            fill.color = Color.BLACK
            canvas.drawRoundRect(10f, top + 27f, 92f, top + 48f, 6f, 6f, fill)
            fill.color = intArrayOf(Color.LTGRAY, 0xFFE0B020.toInt(), 0xFF40C0FF.toInt())[p.danType.coerceIn(0, 2)]
            canvas.drawOval(48f, top + 29f, 89f, top + 47f, fill)
        }
        fill.color = if (i == 0) 0xFFF0583A.toInt() else 0xFF5CC8C8.toInt()
        canvas.drawCircle(27f, top + 27f, 23f, fill)
        canvas.drawCircle(27f, top + 27f, 23f, stroke)
        fill.color = Color.WHITE
        fill.textAlign = Paint.Align.CENTER
        fill.typeface = Typeface.DEFAULT_BOLD
        fill.textSize = 18f
        canvas.drawText(if (i == 0) "1P" else "2P", 27f, top + 34f, fill)
    }

    /** 文字の位置はおおよその目安（実際のゲーム内表示とは多少ずれます） */
    private fun drawTexts(canvas: Canvas, p: PlayerPlate, top: Int) {
        fun paint(size: Float, bold: Boolean, color: Int) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            textSize = size
            textAlign = Paint.Align.CENTER
            typeface = if (bold) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            this.color = color
        }

        fun fitted(text: String, paint: Paint, maxWidth: Float) {
            val w = paint.measureText(text)
            if (w > maxWidth) paint.textScaleX = maxWidth / w
        }

        val title = paint(11f, true, Color.WHITE)
        val titleOutline = paint(11f, true, Color.BLACK).apply { style = Paint.Style.STROKE; strokeWidth = 2.5f }
        fitted(p.title, title, 150f); titleOutline.textScaleX = title.textScaleX
        canvas.drawText(p.title, 134f, top + 21f, titleOutline)
        canvas.drawText(p.title, 134f, top + 21f, title)

        val hasDan = p.dan.isNotEmpty()
        val name = paint(15f, true, Color.BLACK)
        val nameCenter = if (hasDan) 154f else 134f
        fitted(p.name, name, if (hasDan) 110f else 150f)
        canvas.drawText(p.name, nameCenter, top + 44f, name)

        if (hasDan) {
            val danColor = if (p.danGold) 0xFFFFD040.toInt() else Color.WHITE
            val dan = paint(10f, true, danColor)
            val danOutline = paint(10f, true, Color.BLACK).apply { style = Paint.Style.STROKE; strokeWidth = 2.5f }
            fitted(p.dan, dan, 38f); danOutline.textScaleX = dan.textScaleX
            canvas.drawText(p.dan, 68f, top + 42f, danOutline)
            canvas.drawText(p.dan, 68f, top + 42f, dan)
        }
    }
}
