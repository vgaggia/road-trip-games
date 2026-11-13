plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val syncWebAssets by tasks.registering(Copy::class) {
    from(rootProject.projectDir.resolve("../docs"))
    into(layout.buildDirectory.dir("generated/assets/www/www"))
}

android {
    namespace = "com.roadtripgames.shotgun"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.roadtripgames.shotgun"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0"
    }

    signingConfigs {
        create("releaseCustom") {
            val ksPath = System.getenv("KEYSTORE_PATH")
            if (!ksPath.isNullOrBlank() && file(ksPath).exists()) {
                storeFile = file(ksPath)
                storePassword = System.getenv("KEYSTORE_PASSWORD") ?: "roadtrip123"
                keyAlias = System.getenv("KEY_ALIAS") ?: "shotgun"
                keyPassword = System.getenv("KEY_PASSWORD") ?: "roadtrip123"
                enableV1Signing = true
                enableV2Signing = true
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            val ksPath = System.getenv("KEYSTORE_PATH")
            signingConfig = if (!ksPath.isNullOrBlank() && file(ksPath).exists()) {
                signingConfigs.getByName("releaseCustom")
            } else {
                signingConfigs.getByName("debug")
            }
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
        debug {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    sourceSets {
        getByName("main") {
            assets.srcDir(layout.buildDirectory.dir("generated/assets/www"))
        }
    }

    testOptions {
        unitTests.isReturnDefaultValues = true
    }
}

tasks.named("preBuild") {
    dependsOn(syncWebAssets)
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.2")

    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")
}
