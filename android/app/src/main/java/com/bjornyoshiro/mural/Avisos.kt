package com.bjornyoshiro.mural

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat

object Avisos {
    private const val CANAL = "mural"
    private val NOME = mapOf("bjorn" to "Bjørn", "yoshiro" to "Yoshiro")

    /** Notifica o que o outro anotou desde a última sincronização. */
    fun novidades(ctx: Context, itens: List<Item>, eu: String?) {
        val prefs = ctx.getSharedPreferences("mural", Context.MODE_PRIVATE)
        val ultimo = prefs.getLong("ultimoVisto", 0L)
        val maior = maxOf(itens.maxOfOrNull { it.criadoEm } ?: 0L, ultimo)
        if (ultimo == 0L) {
            // Primeira vez neste celular: não despeja o mural inteiro como novidade.
            prefs.edit().putLong("ultimoVisto", maxOf(maior, System.currentTimeMillis())).apply()
            return
        }
        if (eu != null) {
            val novos = itens.filter { it.criadoEm > ultimo && it.autor.isNotEmpty() && it.autor != eu }
            if (novos.isNotEmpty()) {
                val quem = NOME[novos.first().autor] ?: "Alguém"
                val titulo = if (novos.size == 1) "$quem anotou no mural" else "$quem anotou ${novos.size} coisas"
                mostrar(ctx, 2, titulo, novos.joinToString("\n") { "• " + it.titulo }, "aviso")
            }
        }
        if (maior > ultimo) prefs.edit().putLong("ultimoVisto", maior).apply()
    }

    fun resumoDoDia(ctx: Context, r: Resumo) {
        val partes = buildList {
            add("${r.hoje} pra hoje")
            if (r.urgentes > 0) add("${r.urgentes} muito importante" + if (r.urgentes > 1) "s" else "")
            if (r.atrasados > 0) add("${r.atrasados} atrasad" + if (r.atrasados > 1) "as" else "a")
        }
        val niverHoje = r.itens.filter { it.diasParaNiver() == 0L }.map { it.titulo }
        val lista = r.itens.filter { it.diasParaNiver() != 0L }.take(4).joinToString("\n") { item ->
            val d = item.diasParaNiver()
            "• " + item.titulo + when (d) { null -> ""; 1L -> " (aniversário amanhã)"; else -> " (aniversário em $d dias)" }
        }
        val texto = partes.joinToString(" · ") + if (lista.isNotEmpty()) "\n$lista" else ""
        val titulo = if (niverHoje.isNotEmpty()) "Hoje é aniversário de ${niverHoje.joinToString(" e ")}" else "Mural de hoje"
        mostrar(ctx, 1, titulo, texto, "aviso")
    }

    /** "Nova versão do Mural": tocar abre o download do APK no navegador. */
    fun atualizacao(ctx: Context, apk: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(apk)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        notificar(ctx, 3, "Nova versão do Mural", "Toque para baixar e instalar por cima. As anotações não se perdem.",
            PendingIntent.getActivity(ctx, 3, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }

    private fun mostrar(ctx: Context, id: Int, titulo: String, texto: String, abrir: String) {
        val intent = Intent(ctx, MainActivity::class.java)
            .putExtra("abrir", abrir)
            .setData(Uri.parse("mural://$abrir/$id"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        notificar(ctx, id, titulo, texto,
            PendingIntent.getActivity(ctx, id, intent, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    }

    private fun notificar(ctx: Context, id: Int, titulo: String, texto: String, pi: PendingIntent) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        ctx.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CANAL, "Mural", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Novidades do mural e resumo do dia"
            },
        )
        val n = NotificationCompat.Builder(ctx, CANAL)
            .setSmallIcon(R.drawable.ic_notif)
            .setColor(0xFFA400FF.toInt())
            .setContentTitle(titulo)
            .setContentText(texto.lineSequence().first())
            .setStyle(NotificationCompat.BigTextStyle().bigText(texto))
            .setContentIntent(pi)
            .setAutoCancel(true)
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify(id, n)
        } catch (e: SecurityException) {
            // Permissão retirada no meio do caminho: só não notifica.
        }
    }
}
