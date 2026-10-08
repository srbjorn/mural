package com.bjornyoshiro.mural

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import com.google.firebase.auth.FirebaseAuth

/** Tela do app: o mesmo mural da web, dentro de um WebView. */
class MainActivity : Activity() {
    private lateinit var web: WebView

    override fun onCreate(estado: Bundle?) {
        super.onCreate(estado)
        web = WebView(this)
        setContentView(web)
        with(web.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true
            cacheMode = WebSettings.LOAD_DEFAULT
        }
        web.addJavascriptInterface(Ponte(applicationContext), "AndroidBridge")
        val host = Uri.parse(BuildConfig.SITE).host
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, req: WebResourceRequest): Boolean {
                if (req.url.host == host) return false
                startActivity(Intent(Intent.ACTION_VIEW, req.url))
                return true
            }
        }
        if (estado == null) web.loadUrl(BuildConfig.SITE + atalho(intent)) else web.restoreState(estado)

        if (Build.VERSION.SDK_INT >= 33 &&
            checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) {
            requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1)
        }
        Sync.agendar(this)
        Sync.agora(this)
    }

    override fun onNewIntent(novo: Intent) {
        super.onNewIntent(novo)
        val a = atalho(novo)
        if (a.isNotEmpty()) web.evaluateJavascript("location.hash='${a.drop(1)}'", null)
    }

    override fun onSaveInstanceState(saida: Bundle) {
        super.onSaveInstanceState(saida)
        web.saveState(saida)
    }

    override fun onPause() {
        super.onPause()
        Sync.agora(this)
    }

    @Deprecated("Voltar do sistema")
    override fun onBackPressed() {
        if (web.canGoBack()) web.goBack() else super.onBackPressed()
    }

    private fun atalho(i: Intent?): String = when (i?.getStringExtra("abrir")) {
        "novo" -> "#novo"
        "aviso" -> "#aviso"
        else -> ""
    }
}

/** O que a página pode pedir ao app (window.AndroidBridge). */
class Ponte(private val ctx: Context) {
    @JavascriptInterface
    fun entrar(email: String, senha: String) {
        FirebaseAuth.getInstance().signInWithEmailAndPassword(email, senha)
            .addOnCompleteListener { Sync.agora(ctx) }
    }

    @JavascriptInterface
    fun sair() {
        FirebaseAuth.getInstance().signOut()
        Sync.agora(ctx)
    }

    @JavascriptInterface
    fun nativoLogado(): Boolean = FirebaseAuth.getInstance().currentUser != null

    @JavascriptInterface
    fun atualizarWidget() = Sync.agora(ctx)
}
