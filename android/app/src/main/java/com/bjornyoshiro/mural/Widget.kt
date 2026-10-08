package com.bjornyoshiro.mural

import android.appwidget.AppWidgetManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.action.Action
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.appwidget.state.updateAppWidgetState
import androidx.glance.background
import androidx.glance.currentState
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.state.PreferencesGlanceStateDefinition
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

private val FUNDO = Color(0xFF1E2120)
private val LINHA = Color(0xFF2A2E2C)
private val TEXTO = Color(0xFFF1F3F2)
private val TEXTO2 = Color(0xFFA9B2AD)
private val VERDE = Color(0xFF46C98F)
private val ROXO = Color(0xFFA400FF)
private val P3 = Color(0xFFFF6B6F)
private val P2 = Color(0xFFF2B33D)
private val P1 = Color(0xFF6F7974)

object WidgetDados {
    val CHAVE = stringPreferencesKey("resumo")

    suspend fun salvar(ctx: Context, r: Resumo) {
        val json = r.toJson()
        val ids = GlanceAppWidgetManager(ctx).getGlanceIds(MuralWidget::class.java)
        for (id in ids) {
            updateAppWidgetState(ctx, id) { it[CHAVE] = json }
            MuralWidget().update(ctx, id)
        }
    }
}

class MuralWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = MuralWidget()

    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        Sync.agendar(context)
        Sync.agora(context)
    }
}

class MuralWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Exact
    override val stateDefinition = PreferencesGlanceStateDefinition

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        provideContent {
            val prefs = currentState<Preferences>()
            Conteudo(Resumo.deJson(prefs[WidgetDados.CHAVE]))
        }
    }
}

private fun abrirApp(ctx: Context, extra: String?): Action {
    val i = Intent(ctx, MainActivity::class.java)
        .setData(Uri.parse("mural://widget/${extra ?: "abrir"}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (extra != null) i.putExtra("abrir", extra)
    return actionStartActivity(i)
}

private fun estilo(cor: Color, tam: Int, negrito: Boolean = false) =
    TextStyle(color = ColorProvider(cor), fontSize = tam.sp, fontWeight = if (negrito) FontWeight.Bold else FontWeight.Normal)

/** Rosto da figurinha (PNG já redondo), com anel na cor de cada um: Bjørn roxo, Yoshiro verde. */
@Composable
private fun Rosto(imagem: Int, nome: String, cor: Color, tam: Int = 34) {
    Box(
        GlanceModifier.size(tam.dp).background(cor).cornerRadius((tam / 2).dp).padding(2.dp),
        contentAlignment = Alignment.Center,
    ) {
        Image(ImageProvider(imagem), contentDescription = nome, modifier = GlanceModifier.size((tam - 4).dp))
    }
}

@Composable
private fun Conteudo(r: Resumo?) {
    val ctx = LocalContext.current
    val abrir = abrirApp(ctx, null)
    val hoje = LocalDate.now().format(DateTimeFormatter.ofPattern("EEE, d 'de' MMMM", Locale("pt", "BR")))
        .replaceFirstChar { it.uppercase() }

    Column(GlanceModifier.fillMaxSize().background(FUNDO).cornerRadius(22.dp).padding(12.dp)) {
        Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Rosto(R.drawable.rosto_bjorn, "Bjørn", ROXO)
            Spacer(GlanceModifier.width(4.dp))
            Rosto(R.drawable.rosto_yoshiro, "Yoshiro", VERDE)
            Column(GlanceModifier.defaultWeight().padding(horizontal = 10.dp).clickable(abrir)) {
                Text(hoje, style = estilo(TEXTO, 16, true), maxLines = 1)
                val sub = when {
                    r == null || !r.logado -> "Mural Bjørn & Yoshiro"
                    else -> buildList {
                        add("${r.hoje} pra hoje")
                        if (r.urgentes > 0) add("${r.urgentes} urgente" + if (r.urgentes > 1) "s" else "")
                        if (r.atrasados > 0) add("${r.atrasados} atrasad" + if (r.atrasados > 1) "as" else "a")
                    }.joinToString(" · ")
                }
                Text(sub, style = estilo(TEXTO2, 13), maxLines = 1)
            }
            Box(
                GlanceModifier.size(40.dp).background(TEXTO).cornerRadius(20.dp).clickable(abrirApp(ctx, "novo")),
                contentAlignment = Alignment.Center,
            ) {
                Text("+", style = estilo(FUNDO, 24, true))
            }
        }
        Spacer(GlanceModifier.height(10.dp))
        when {
            r == null || !r.logado -> Aviso("Abra o app Mural e entre com a sua conta.", abrir)
            r.itens.isEmpty() -> Aviso("Nada pendente. Dia livre!", abrir)
            else -> LazyColumn(GlanceModifier.fillMaxSize()) {
                items(r.itens, itemId = { it.id.hashCode().toLong() }) { item -> Linha(item, abrir) }
            }
        }
    }
}

@Composable
private fun Aviso(texto: String, abrir: Action) {
    Box(GlanceModifier.fillMaxSize().clickable(abrir), contentAlignment = Alignment.Center) {
        Text(texto, style = estilo(TEXTO2, 14))
    }
}

@Composable
private fun Linha(it: Item, abrir: Action) {
    val corPrio = when (it.prioridade) { 3 -> P3; 2 -> P2; else -> P1 }
    val corAutor = if (it.autor == "yoshiro") VERDE else ROXO
    val tipo = when (it.tipo) { "checklist" -> "Checklist"; "evento" -> "Evento"; "meta" -> "Meta"; else -> "Anotação" }
    val detalhe = buildString {
        append(tipo)
        if (it.total > 0) append(" · ${it.feitos}/${it.total}")
        append(if (it.autor == "yoshiro") " · Yoshiro" else " · Bjørn")
    }
    val h = LocalDate.now().toString()
    val quando = when {
        it.data == null -> ""
        it.atrasado -> "Atrasado"
        it.data == h -> if (it.hora.isNotEmpty()) it.hora else "Hoje"
        it.data == LocalDate.now().plusDays(1).toString() -> "Amanhã"
        else -> LocalDate.parse(it.data).format(DateTimeFormatter.ofPattern("d MMM", Locale("pt", "BR"))).replace(".", "")
    }
    Column(GlanceModifier.fillMaxWidth().padding(bottom = 6.dp)) {
        Row(
            GlanceModifier.fillMaxWidth().background(LINHA).cornerRadius(12.dp).padding(8.dp).clickable(abrir),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(GlanceModifier.width(4.dp).height(34.dp).background(corPrio).cornerRadius(2.dp)) {}
            Spacer(GlanceModifier.width(8.dp))
            Box(GlanceModifier.size(10.dp).background(corAutor).cornerRadius(5.dp)) {}
            Spacer(GlanceModifier.width(8.dp))
            Column(GlanceModifier.defaultWeight()) {
                Text(it.titulo, style = estilo(TEXTO, 14, true), maxLines = 1)
                Text(detalhe, style = estilo(TEXTO2, 12), maxLines = 1)
            }
            if (quando.isNotEmpty()) {
                Spacer(GlanceModifier.width(6.dp))
                Text(quando, style = estilo(if (it.atrasado) P3 else TEXTO, 12, true), maxLines = 1)
            }
        }
    }
}
