package com.bjornyoshiro.mural

import android.content.Context
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/**
 * Confere em versao.json (publicado junto com o site) se saiu um app mais novo.
 * No máximo a cada 6 horas, e avisa uma vez só por versão.
 */
object Atualizacao {
    private const val INTERVALO = 6 * 60 * 60 * 1000L

    fun verificar(ctx: Context) {
        val prefs = ctx.getSharedPreferences("mural", Context.MODE_PRIVATE)
        val agora = System.currentTimeMillis()
        if (agora - prefs.getLong("versaoVistaEm", 0L) < INTERVALO) return
        try {
            val con = URL(BuildConfig.SITE + "versao.json?t=$agora").openConnection() as HttpURLConnection
            con.connectTimeout = 15000
            con.readTimeout = 15000
            con.useCaches = false
            val json = JSONObject(con.inputStream.bufferedReader().use { it.readText() })
            con.disconnect()
            prefs.edit().putLong("versaoVistaEm", agora).apply()
            val nova = json.optInt("app", 0)
            val apk = json.optString("apk")
            if (nova > BuildConfig.VERSION_CODE && apk.isNotBlank() && prefs.getInt("versaoAvisada", 0) < nova) {
                Avisos.atualizacao(ctx, apk)
                prefs.edit().putInt("versaoAvisada", nova).apply()
            }
        } catch (e: Exception) {
            // Sem internet ou arquivo fora do ar: tenta de novo na próxima sincronização.
        }
    }
}
