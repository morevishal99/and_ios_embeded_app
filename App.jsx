import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  ActivityIndicator,
  BackHandler,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  NativeModules,
} from 'react-native';
import { WebView } from 'react-native-webview';

const { FileDownloadModule } = NativeModules;
const TARGET_URL = 'https://productuat.markytics.ai/login';
const LOGO_IMG = require('./assets/app_logo.jpg');

// Script to lock viewport scale and prevent website zooming
const DISABLE_ZOOM_JS = `
  (function() {
    try {
      var meta = document.querySelector('meta[name="viewport"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'viewport';
        (document.head || document.documentElement).appendChild(meta);
      }
      meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover');
    } catch (e) {}
  })();
  true;
`;

// Bridge sessionStorage auth tokens and intercept downloads BEFORE web code executes
const PERSIST_SESSION_JS = `
  (function() {
    try {
      var AUTH_KEYS = [
        'auth_token',
        'auth_refresh_token',
        'auth_source',
        'kc_access_token',
        'kc_refresh_token',
        'kc_id_token',
        'auth_user',
        'selected_client',
        'rbac_client_id',
        'last_path'
      ];
      var PREFIX = '__app_persist_';

      // 1. Restore persisted tokens back into sessionStorage on app launch
      for (var i = 0; i < AUTH_KEYS.length; i++) {
        var k = AUTH_KEYS[i];
        try {
          var val = localStorage.getItem(PREFIX + k);
          if (val && !sessionStorage.getItem(k)) {
            sessionStorage.setItem(k, val);
          }
        } catch(e) {}
      }

      // 2. Mirror sessionStorage.setItem to persistent storage
      var origSet = sessionStorage.setItem.bind(sessionStorage);
      sessionStorage.setItem = function(k, v) {
        origSet(k, v);
        try {
          if (AUTH_KEYS.indexOf(k) !== -1 || k.indexOf('auth_') === 0) {
            localStorage.setItem(PREFIX + k, v);
          }
        } catch(e) {}
      };

      // 3. Mirror sessionStorage.removeItem on logout
      var origRemove = sessionStorage.removeItem.bind(sessionStorage);
      sessionStorage.removeItem = function(k) {
        origRemove(k);
        try {
          if (AUTH_KEYS.indexOf(k) !== -1 || k.indexOf('auth_') === 0) {
            localStorage.removeItem(PREFIX + k);
          }
        } catch(e) {}
      };

      // 4. Mirror sessionStorage.clear
      var origClear = sessionStorage.clear.bind(sessionStorage);
      sessionStorage.clear = function() {
        origClear();
        try {
          for (var j = 0; j < AUTH_KEYS.length; j++) {
            localStorage.removeItem(PREFIX + AUTH_KEYS[j]);
          }
        } catch(e) {}
      };

      // 5. Enable native app detection for Mark One UI
      window.Capacitor = window.Capacitor || {};
      window.Capacitor.isNativePlatform = function() { return true; };

      // 6. Global File & Blob Download Interceptor
      var origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() {
        var href = this.href || this.getAttribute('href') || '';
        var downloadAttr = this.getAttribute('download') || this.download;
        var hasDownload = downloadAttr !== null && downloadAttr !== undefined && downloadAttr !== false;
        var isBlob = href.indexOf('blob:') === 0;
        var isData = href.indexOf('data:') === 0;
        var isFileUrl = /\\.(xlsx|xls|csv|pdf|docx|zip)(\\?.*)?$/i.test(href) || href.indexOf('sample_') !== -1;

        if (isBlob || isData || hasDownload || isFileUrl) {
          var filename = typeof downloadAttr === 'string' && downloadAttr.length > 0 && downloadAttr !== 'true'
            ? downloadAttr
            : (href.split('/').pop().split('?')[0] || ('download_' + Date.now() + '.csv'));

          if (isBlob) {
            fetch(href)
              .then(function(res) { return res.blob(); })
              .then(function(blob) {
                var reader = new FileReader();
                reader.onloadend = function() {
                  if (window.ReactNativeWebView) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({
                      type: 'FILE_DOWNLOAD_BASE64',
                      filename: filename,
                      dataUrl: reader.result,
                      mimeType: blob.type || 'application/octet-stream'
                    }));
                  }
                };
                reader.readAsDataURL(blob);
              })
              .catch(function(e) {});
            return;
          }

          var absoluteUrl = this.href || href;
          if (absoluteUrl.indexOf('/') === 0) {
            absoluteUrl = window.location.origin + absoluteUrl;
          }

          if (absoluteUrl.indexOf('http') === 0) {
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({
                type: 'FILE_DOWNLOAD_URL',
                filename: filename,
                url: absoluteUrl,
                mimeType: 'application/octet-stream'
              }));
            }
            return;
          }
        }
        return origClick.apply(this, arguments);
      };

      // Also hook window.open for direct file links
      var origOpen = window.open;
      window.open = function(url) {
        if (url && (/\\.(xlsx|xls|csv|pdf|docx|zip)(\\?.*)?$/i.test(url) || url.indexOf('sample_') !== -1)) {
          var absUrl = url.indexOf('http') === 0 ? url : (window.location.origin + (url.indexOf('/') === 0 ? '' : '/') + url);
          var fname = absUrl.split('/').pop().split('?')[0] || 'download.csv';
          if (window.ReactNativeWebView) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'FILE_DOWNLOAD_URL',
              filename: fname,
              url: absUrl,
              mimeType: 'application/octet-stream'
            }));
          }
          return null;
        }
        return origOpen.apply(this, arguments);
      };
    } catch(e) {}
  })();
  true;
`;

export default function App() {
  const webViewRef = useRef(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  // Failsafe: ensure loading screen dismisses after 3 seconds even if website slow
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // Handle Android Hardware Back Button
  useEffect(() => {
    const onBackPress = () => {
      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true; // prevent exit
      }
      return false; // allow default back action
    };

    BackHandler.addEventListener('hardwareBackPress', onBackPress);

    return () => {
      BackHandler.removeEventListener('hardwareBackPress', onBackPress);
    };
  }, [canGoBack]);

  const handleRetry = () => {
    setHasError(false);
    setLoading(true);
    if (webViewRef.current) {
      webViewRef.current.reload();
    }
    setTimeout(() => setLoading(false), 3000);
  };

  const handleMessage = async event => {
    try {
      const message = JSON.parse(event.nativeEvent.data);
      if (message.type === 'FILE_DOWNLOAD_BASE64') {
        const { filename, dataUrl, mimeType } = message;
        if (FileDownloadModule) {
          await FileDownloadModule.saveBase64File(dataUrl, filename, mimeType || 'application/octet-stream');
        }
      } else if (message.type === 'FILE_DOWNLOAD_URL') {
        const { filename, url, mimeType } = message;
        if (FileDownloadModule) {
          await FileDownloadModule.downloadUrl(url, filename, mimeType || 'application/octet-stream');
        }
      }
    } catch (e) {
      // Ignored
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" />

      {hasError ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorTitle}>Connection Failed</Text>
          <Text style={styles.errorMessage}>
            Unable to connect to Mark One portal. Please check your internet connection and try again.
          </Text>
          <TouchableOpacity style={styles.retryButton} onPress={handleRetry}>
            <Text style={styles.retryButtonText}>Retry Connection</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.webviewContainer}>
          <WebView
            ref={webViewRef}
            source={{ uri: TARGET_URL }}
            style={styles.webview}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            startInLoadingState={false}
            allowFileAccess={true}
            allowFileAccessFromFileURLs={true}
            allowUniversalAccessFromFileURLs={true}
            mixedContentMode="always"
            allowsInlineMediaPlayback={true}
            mediaPlaybackRequiresUserAction={false}
            originWhitelist={['*']}
            setBuiltInZoomControls={false}
            setDisplayZoomControls={false}
            scalesPageToFit={false}
            webviewDebuggingEnabled={false}
            injectedJavaScriptBeforeContentLoaded={PERSIST_SESSION_JS}
            injectedJavaScript={DISABLE_ZOOM_JS}
            onMessage={handleMessage}
            onShouldStartLoadWithRequest={request => {
              const url = request.url || '';
              if (
                url.endsWith('.csv') ||
                url.endsWith('.xlsx') ||
                url.endsWith('.xls') ||
                url.endsWith('.pdf') ||
                url.includes('sample_') ||
                url.includes('/sample_scrub_file.csv')
              ) {
                if (FileDownloadModule) {
                  const filename = url.split('/').pop().split('?')[0] || 'sample_file.csv';
                  FileDownloadModule.downloadUrl(url, filename, 'application/octet-stream');
                }
                return false;
              }
              return true;
            }}
            onNavigationStateChange={navState => {
              setCanGoBack(navState.canGoBack);
            }}
            onLoadProgress={({ nativeEvent }) => {
              if (nativeEvent.progress >= 0.5) {
                setLoading(false);
              }
            }}
            onLoad={() => setLoading(false)}
            onLoadEnd={() => setLoading(false)}
            onError={syntheticEvent => {
              const { nativeEvent } = syntheticEvent;
              console.warn('WebView error: ', nativeEvent);
              setHasError(true);
              setLoading(false);
            }}
            onHttpError={syntheticEvent => {
              const { nativeEvent } = syntheticEvent;
              if (nativeEvent.statusCode >= 400) {
                console.warn('HTTP error status: ', nativeEvent.statusCode);
              }
            }}
          />

          {loading && (
            <View style={styles.loadingOverlay} pointerEvents="none">
              <Image source={LOGO_IMG} style={styles.logoImage} resizeMode="contain" />
              <ActivityIndicator size="large" color="#3B82F6" style={styles.spinner} />
              <Text style={styles.loadingText}>Loading Mark One...</Text>
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  webviewContainer: {
    flex: 1,
    position: 'relative',
  },
  webview: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
  },
  logoImage: {
    width: 80,
    height: 80,
    borderRadius: 18,
    marginBottom: 12,
  },
  spinner: {
    marginTop: 12,
  },
  loadingText: {
    marginTop: 12,
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: '600',
    letterSpacing: 0.3,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    backgroundColor: '#0F172A',
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 14,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  retryButton: {
    backgroundColor: '#2563EB',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    elevation: 3,
  },
  retryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
});

