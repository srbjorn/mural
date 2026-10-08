package com.bjornyoshiro.mural

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.LocalDate
import java.time.LocalDateTime
import java.util.concurrent.TimeUnit

/** Um item do mural, só com o que o widget e as notificações usam. */
data class Item(
    val id: String,
    val tipo: String,
    val titulo: String,
    val prioridade: Int,
    val data: String?,
    val hora: String,
    val autor: String,
    val criadoEm: Long,
    val feitos: Int,
    val total: Int,
) {
    val atrasado get() = data != null && data < LocalDate.now().toString()

    fun toJson(): JSONObject = JSONObject()
        .put("id", id).put("tipo", tipo).put("titulo", titulo).put("prioridade", prioridade)
        .put("data", data ?: "").put("hora", hora).put("autor", autor)
        .put("criadoEm", criadoEm).put("feitos", feitos).put("total", total)

    companion object {
        fun de(d: DocumentSnapshot): Item {
            @Suppress("UNCHECKED_CAST")
            val lista = d.get("checklist") as? List<Map<String, Any?>> ?: emptyList()
            return Item(
                id = d.id,
                tipo = d.getString("tipo") ?: "nota",
                titulo = d.getString("titulo") ?: "",
                prioridade = (d.getLong("prioridade") ?: 1L).toInt(),
                data = d.getString("data")?.takeIf { it.isNotBlank() },
                hora = d.getString("hora") ?: "",
                autor = d.getString("autor") ?: "",
                criadoEm = d.getLong("criadoEm") ?: 0L,
                feitos = lista.count { it["ok"] == true },
                total = lista.size,
            )
        }

        fun de(o: JSONObject) = Item(
            o.getString("id"), o.getString("tipo"), o.getString("titulo"), o.getInt("prioridade"),
            o.getString("data").ifBlank { null }, o.getString("hora"), o.getString("autor"),
            o.getLong("criadoEm"), o.getInt("feitos"), o.getInt("total"),
        )
    }
}

/** O que o widget mostra. */
data class Resumo(val logado: Boolean, val hoje: Int, val urgentes: Int, val atrasados: Int, val itens: List<Item>) {
    fun toJson(): String = JSONObject()
        .put("logado", logado).put("hoje", hoje).put("urgentes", urgentes).put("atrasados", atrasados)
        .put("itens", JSONArray(itens.map { it.toJson() }))
        .toString()

    companion object {
        val deslogado = Resumo(false, 0, 0, 0, emptyList())

        fun montar(pendentes: List<Item>): Resumo {
            val h = LocalDate.now().toString()
            val ordem = pendentes.sortedWith(
                compareBy<Item>(
                    { if (it.atrasado || it.data == h) 0 else 1 },
                    { -it.prioridade },
                    { it.data ?: "9999" },
                    { it.hora },
                ),
            )
            return Resumo(
                logado = true,
                hoje = pendentes.count { it.data == h },
                urgentes = pendentes.count { it.prioridade == 3 },
                atrasados = pendentes.count { it.atrasado },
                itens = ordem.take(20),
            )
        }

        fun deJson(s: String?): Resumo? = try {
            if (s.isNullOrBlank()) null else {
                val o = JSONObject(s)
                val arr = o.getJSONArray("itens")
                Resumo(
                    o.getBoolean("logado"), o.getInt("hoje"), o.getInt("urgentes"), o.getInt("atrasados"),
                    (0 until arr.length()).map { Item.de(arr.getJSONObject(it)) },
                )
            }
        } catch (e: Exception) {
            null
        }
    }
}

/** Busca o mural no Firebase, atualiza o widget e avisa das novidades. */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val user = FirebaseAuth.getInstance().currentUser
        if (user == null) {
            WidgetDados.salvar(ctx, Resumo.deslogado)
            return Result.success()
        }
        return try {
            val db = FirebaseFirestore.getInstance()
            val itens = db.collection("itens").whereEqualTo("feito", false).get().await()
                .documents.map { Item.de(it) }
            val eu = db.collection("pessoas").document(user.uid).get().await().getString("quem")
            val resumo = Resumo.montar(itens)
            WidgetDados.salvar(ctx, resumo)
            Avisos.novidades(ctx, itens, eu)
            if (inputData.getBoolean("resumoDoDia", false)) Avisos.resumoDoDia(ctx, resumo)
            Result.success()
        } catch (e: Exception) {
            if (runAttemptCount < 3) Result.retry() else Result.failure()
        }
    }
}

object Sync {
    private val rede = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    /** Sincroniza a cada 15 min e manda o resumo do dia às 8h. */
    fun agendar(ctx: Context) {
        val wm = WorkManager.getInstance(ctx)
        wm.enqueueUniquePeriodicWork(
            "mural-sync", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES).setConstraints(rede).build(),
        )
        val agora = LocalDateTime.now()
        var alvo = agora.toLocalDate().atTime(8, 0)
        if (!alvo.isAfter(agora)) alvo = alvo.plusDays(1)
        wm.enqueueUniquePeriodicWork(
            "mural-bomdia", ExistingPeriodicWorkPolicy.KEEP,
            PeriodicWorkRequestBuilder<SyncWorker>(1, TimeUnit.DAYS)
                .setInitialDelay(Duration.between(agora, alvo).toMinutes(), TimeUnit.MINUTES)
                .setInputData(workDataOf("resumoDoDia" to true))
                .setConstraints(rede)
                .build(),
        )
    }

    fun agora(ctx: Context, resumoDoDia: Boolean = false) {
        WorkManager.getInstance(ctx).enqueueUniqueWork(
            if (resumoDoDia) "mural-ligou" else "mural-agora", ExistingWorkPolicy.REPLACE,
            OneTimeWorkRequestBuilder<SyncWorker>()
                .setInputData(workDataOf("resumoDoDia" to resumoDoDia))
                .setConstraints(rede)
                .build(),
        )
    }
}

/** Ao ligar o celular: atualiza o widget e mostra o resumo do dia. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED) {
            Sync.agendar(ctx)
            Sync.agora(ctx, resumoDoDia = true)
        }
    }
}
