package com.bjornyoshiro.mural

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.Year
import java.time.YearMonth
import java.time.ZoneId

/**
 * Lembrete antes do horário: alarme exato no celular, com os botões "Concluir" e "Adiar 10 min".
 * Os alarmes são (re)agendados a cada sincronização, para os próximos 3 dias.
 */
object Lembretes {
    private const val CANAL = "lembretes"
    private const val JANELA = 3L * 24 * 60 * 60 * 1000

    fun agendar(ctx: Context, itens: List<Item>) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        val prefs = ctx.getSharedPreferences("mural", Context.MODE_PRIVATE)
        val antigos = prefs.getStringSet("alarmes", emptySet()) ?: emptySet()
        val novos = mutableSetOf<String>()
        val agora = System.currentTimeMillis()
        for (it in itens) {
            val minutos = it.lembrete ?: continue
            if (it.data == null || it.hora.isBlank() || it.ehNiver) continue
            val inicio = try {
                LocalDateTime.of(LocalDate.parse(it.data), LocalTime.parse(it.hora))
            } catch (e: Exception) { continue }
            val quando = inicio.minusMinutes(minutos.toLong()).atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
            if (quando <= agora || quando > agora + JANELA) continue
            val chave = "${it.id}|$quando"
            novos += chave
            // Agenda de novo a cada sincronização (o mesmo alarme é substituído): o Android apaga os alarmes ao reiniciar.
            agendarExato(am, quando, alarme(ctx, chave, it.id, it.titulo, it.hora, minutos, adiado = false))
        }
        // Cancela o que mudou de horário, foi concluído ou excluído.
        for (chave in antigos - novos) {
            alarme(ctx, chave, chave.substringBefore("|"), "", "", 0, adiado = false, soBuscar = true)
                ?.let { pi -> am.cancel(pi); pi.cancel() }
        }
        prefs.edit().putStringSet("alarmes", novos).apply()
    }

    fun agendarExato(am: AlarmManager, quando: Long, pi: PendingIntent?) {
        if (pi == null) return
        val podeExato = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
        if (podeExato) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, quando, pi)
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, quando, pi)
    }

    fun alarme(
        ctx: Context, chave: String, id: String, titulo: String, hora: String, minutos: Int,
        adiado: Boolean, soBuscar: Boolean = false,
    ): PendingIntent? {
        val intent = Intent(ctx, LembreteReceiver::class.java)
            .setData(Uri.parse("mural://lembrete/" + Uri.encode(chave)))
            .putExtra("id", id).putExtra("chave", chave).putExtra("titulo", titulo)
            .putExtra("hora", hora).putExtra("minutos", minutos).putExtra("adiado", adiado)
        val flags = PendingIntent.FLAG_IMMUTABLE or (if (soBuscar) PendingIntent.FLAG_NO_CREATE else PendingIntent.FLAG_UPDATE_CURRENT)
        return PendingIntent.getBroadcast(ctx, chave.hashCode(), intent, flags)
    }

    private fun quandoTexto(minutos: Int) = when {
        minutos >= 1440 -> "Amanhã"
        minutos >= 120 -> "Daqui a ${minutos / 60} horas"
        minutos >= 60 -> "Daqui a 1 hora"
        else -> "Daqui a $minutos min"
    }

    fun mostrar(ctx: Context, i: Intent) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        ctx.getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CANAL, "Lembretes antes do horário", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "Avisam antes de eventos e anotações com hora"
            },
        )
        val chave = i.getStringExtra("chave") ?: return
        val id = i.getStringExtra("id") ?: return
        val titulo = i.getStringExtra("titulo") ?: ""
        val hora = i.getStringExtra("hora") ?: ""
        val minutos = i.getIntExtra("minutos", 60)
        val adiado = i.getBooleanExtra("adiado", false)
        val notifId = chave.hashCode()

        fun acao(tipo: String): PendingIntent = PendingIntent.getBroadcast(
            ctx, (chave + tipo).hashCode(),
            Intent(ctx, AcaoLembreteReceiver::class.java)
                .setData(Uri.parse("mural://acao/$tipo/" + Uri.encode(chave)))
                .putExtra("tipo", tipo).putExtra("id", id).putExtra("chave", chave)
                .putExtra("titulo", titulo).putExtra("hora", hora).putExtra("notif", notifId),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val abrir = PendingIntent.getActivity(
            ctx, notifId,
            Intent(ctx, MainActivity::class.java).setData(Uri.parse("mural://abrir/$notifId"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = NotificationCompat.Builder(ctx, CANAL)
            .setSmallIcon(R.drawable.ic_notif)
            .setColor(0xFFA400FF.toInt())
            .setContentTitle(if (adiado) "Lembrete: $titulo" else "${quandoTexto(minutos)}: $titulo")
            .setContentText(if (hora.isNotBlank()) "Às $hora" else "Mural")
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setContentIntent(abrir)
            .setAutoCancel(true)
            .addAction(0, "Concluir", acao("concluir"))
            .addAction(0, "Adiar 10 min", acao("adiar"))
            .build()
        try {
            NotificationManagerCompat.from(ctx).notify(notifId, n)
        } catch (e: SecurityException) {
        }
    }
}

/** O alarme tocou: mostra o lembrete. */
class LembreteReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) = Lembretes.mostrar(ctx, intent)
}

/** Botões da notificação: "Concluir" (grava no mural) e "Adiar 10 min" (toca de novo daqui a 10 min). */
class AcaoLembreteReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val notif = intent.getIntExtra("notif", 0)
        NotificationManagerCompat.from(ctx).cancel(notif)
        val id = intent.getStringExtra("id") ?: return
        val chave = intent.getStringExtra("chave") ?: return
        when (intent.getStringExtra("tipo")) {
            "adiar" -> {
                val quando = System.currentTimeMillis() + 10 * 60 * 1000
                val novaChave = "$chave|adiado$quando"
                Lembretes.agendarExato(
                    ctx.getSystemService(AlarmManager::class.java), quando,
                    Lembretes.alarme(ctx, novaChave, id, intent.getStringExtra("titulo") ?: "", intent.getStringExtra("hora") ?: "", 0, adiado = true),
                )
            }
            "concluir" -> {
                val pendente = goAsync()
                CoroutineScope(Dispatchers.IO).launch {
                    try {
                        Repeticao.concluir(id)
                        Sync.agora(ctx)
                    } catch (e: Exception) {
                        // Sem internet: o Firestore guarda e envia quando voltar; se falhar de vez, fica para concluir no app.
                    } finally {
                        pendente.finish()
                    }
                }
            }
        }
    }
}

/** As mesmas regras de repetição do site (web/app.js: proximaData e avancar). */
object Repeticao {
    /** Domingo = 0 … sábado = 6, como no JavaScript. */
    private fun diaDaSemana(d: LocalDate) = d.dayOfWeek.value % 7

    fun proxima(rep: Map<*, *>, depoisDe: LocalDate): LocalDate? {
        when (rep["tipo"]) {
            "diaria" -> return depoisDe.plusDays(1)
            "semanal" -> {
                val dias = (rep["dias"] as? List<*>)?.mapNotNull { (it as? Number)?.toInt() }?.takeIf { it.isNotEmpty() }
                    ?: listOf(diaDaSemana(depoisDe))
                for (i in 1..7) {
                    val x = depoisDe.plusDays(i.toLong())
                    if (diaDaSemana(x) in dias) return x
                }
            }
            "mensal" -> {
                val alvo = (rep["dia"] as? Number)?.toInt() ?: depoisDe.dayOfMonth
                var ym = YearMonth.from(depoisDe)
                repeat(14) {
                    val x = ym.atDay(minOf(alvo, ym.lengthOfMonth()))
                    if (x.isAfter(depoisDe)) return x
                    ym = ym.plusMonths(1)
                }
            }
            "anual" -> {
                val md = (rep["md"] as? String) ?: "%02d-%02d".format(depoisDe.monthValue, depoisDe.dayOfMonth)
                val (m, d) = md.split("-").map { it.toInt() }
                for (y in depoisDe.year..depoisDe.year + 2) {
                    val dia = if (m == 2 && d == 29 && !Year.isLeap(y.toLong())) 28 else d
                    val x = LocalDate.of(y, m, dia)
                    if (x.isAfter(depoisDe)) return x
                }
            }
        }
        return null
    }

    /** Conclui um item: se repete, guarda no histórico e vai para a próxima data; senão, marca como feito. */
    suspend fun concluir(id: String) {
        val db = FirebaseFirestore.getInstance()
        val ref = db.collection("itens").document(id)
        val doc = ref.get().await()
        if (!doc.exists()) return
        val agora = System.currentTimeMillis()
        val rep = doc.get("repetir") as? Map<*, *>
        val data = doc.getString("data")
        if (rep == null || rep["tipo"] == null || data.isNullOrBlank()) {
            ref.update(mapOf("feito" to true, "atualizadoEm" to agora)).await()
            return
        }
        val hoje = LocalDate.now()
        val atual = LocalDate.parse(data)
        val prox = proxima(rep, if (atual.isAfter(hoje)) atual else hoje)
        val uid = FirebaseAuth.getInstance().currentUser?.uid
        val quem = uid?.let { db.collection("pessoas").document(it).get().await().getString("quem") } ?: ""
        @Suppress("UNCHECKED_CAST")
        val historico = ((doc.get("historico") as? List<Map<String, Any>>) ?: emptyList()) +
            mapOf("data" to data, "feitoEm" to agora, "por" to quem)
        val upd = mutableMapOf<String, Any>("historico" to historico.takeLast(30), "atualizadoEm" to agora)
        val ate = rep["ate"] as? String
        if (prox == null || (!ate.isNullOrBlank() && prox.toString() > ate)) {
            upd["feito"] = true
        } else {
            upd["data"] = prox.toString()
            doc.getString("dataFim")?.takeIf { it.isNotBlank() }?.let {
                val delta = java.time.temporal.ChronoUnit.DAYS.between(atual, prox)
                upd["dataFim"] = LocalDate.parse(it).plusDays(delta).toString()
            }
            @Suppress("UNCHECKED_CAST")
            (doc.get("checklist") as? List<Map<String, Any>>)?.takeIf { it.isNotEmpty() }?.let { lista ->
                upd["checklist"] = lista.map { x -> x.toMutableMap().apply { put("ok", false) } }
            }
        }
        ref.update(upd).await()
    }
}
