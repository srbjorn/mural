plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
    id("com.google.gms.google-services")
}

// Endereço do mural na web (GitHub Pages). O workflow passa MURAL_SITE; localmente usa o padrão.
val site = System.getenv("MURAL_SITE") ?: "https://srbjorn.github.io/mural/"
val numero = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
val chave = System.getenv("MURAL_KEYSTORE")

android {
    namespace = "com.bjornyoshiro.mural"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.bjornyoshiro.mural"
        minSdk = 26
        targetSdk = 34
        versionCode = numero
        versionName = "1.0.$numero"
        buildConfigField("String", "SITE", "\"$site\"")
    }

    signingConfigs {
        create("mural") {
            if (chave != null) {
                storeFile = file(chave)
                storeType = "pkcs12"
                storePassword = System.getenv("MURAL_KEYSTORE_SENHA")
                keyAlias = "mural"
                keyPassword = System.getenv("MURAL_KEYSTORE_SENHA")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (chave != null) signingConfigs.getByName("mural") else signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

dependencies {
    implementation(platform("com.google.firebase:firebase-bom:33.5.1"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-firestore")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.9.0")
    implementation("androidx.glance:glance-appwidget:1.1.1")
    implementation("androidx.datastore:datastore-preferences:1.1.1")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.core:core-ktx:1.13.1")
}
