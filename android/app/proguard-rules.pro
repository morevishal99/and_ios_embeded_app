# ProGuard / R8 configuration for Mark One

# React Native core rules
-keep,allowobfuscation @interface com.facebook.proguard.annotations.DoNotStrip
-keep,allowobfuscation @interface com.facebook.proguard.annotations.KeepGettersAndSetters
-keep,allowobfuscation @interface com.facebook.common.internal.DoNotStrip

-keep @com.facebook.proguard.annotations.DoNotStrip class *
-keep @com.facebook.common.internal.DoNotStrip class *
-keepclassmembers class * {
    @com.facebook.proguard.annotations.DoNotStrip *;
    @com.facebook.common.internal.DoNotStrip *;
}

-keepclassmembers class * {
    @com.facebook.react.bridge.ReactMethod *;
    @com.facebook.react.uimanager.annotations.ReactProp *;
    @com.facebook.react.uimanager.annotations.ReactPropGroup *;
}

-keep class com.facebook.react.** { *; }
-keep class com.facebook.hermes.** { *; }

# Custom app modules and download bridge
-keep class markone_mobile.app.** { *; }
-keepclassmembers class markone_mobile.app.DownloadModule { *; }

# React Native WebView rules
-keep class com.reactnativecommunity.webview.** { *; }
-keepclassmembers class com.reactnativecommunity.webview.** { *; }
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# React Native Safe Area Context
-keep class com.th3rdwave.safeareacontext.** { *; }

# Keep line numbers, source file, annotations and signatures for symbolication
-keepattributes SourceFile,LineNumberTable
-keepattributes *Annotation*
-keepattributes Signature
-dontwarn okio.**
-dontwarn javax.annotation.**
