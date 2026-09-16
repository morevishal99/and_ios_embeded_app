import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  ActivityIndicator,
  BackHandler,
  TouchableOpacity,
  StatusBar,
  NativeModules,
  PermissionsAndroid,
  Platform,
  Animated,
  AppState,
  Alert,
  Linking,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

const { FileDownloadModule } = NativeModules;
// Direct URL: if authenticated it opens My Customers; if not, ProtectedRoute redirects to /login:
const TARGET_URL = 'https://dev-productv3.markytics.ai/portal/my-customers';
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
          var val = localStorage.getItem(PREFIX + k) || localStorage.getItem(k);
          if (val) {
            sessionStorage.setItem(k, val);
            localStorage.setItem(PREFIX + k, val);
            localStorage.setItem(k, val);
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

      // Direct tap listener on <a> elements with download or file extensions
      document.addEventListener('click', function(e) {
        var el = e.target;
        var a = el && el.closest ? el.closest('a') : null;
        if (!a) return;
        var href = a.href || a.getAttribute('href') || '';
        var downloadAttr = a.getAttribute('download') || a.download;
        var hasDownload = downloadAttr !== null && downloadAttr !== undefined && downloadAttr !== false;
        var isBlob = href.indexOf('blob:') === 0;
        var isData = href.indexOf('data:') === 0;
        var isFileUrl = /\\.(xlsx|xls|csv|pdf|docx|zip)(\\?.*)?$/i.test(href) || href.indexOf('sample_') !== -1;

        if (isBlob || isData || hasDownload || isFileUrl) {
          var filename = typeof downloadAttr === 'string' && downloadAttr.length > 0 && downloadAttr !== 'true'
            ? downloadAttr
            : (href.split('/').pop().split('?')[0] || ('download_' + Date.now() + '.csv'));

          if (isBlob) {
            e.preventDefault();
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

          var absoluteUrl = a.href || href;
          if (absoluteUrl.indexOf('/') === 0) {
            absoluteUrl = window.location.origin + absoluteUrl;
          }
          if (absoluteUrl.indexOf('http') === 0 && window.ReactNativeWebView) {
            e.preventDefault();
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'FILE_DOWNLOAD_URL',
              filename: filename,
              url: absoluteUrl,
              mimeType: 'application/octet-stream'
            }));
          }
        }
      }, true);

      // 7. Dynamic Permission Interception for WebRTC, Camera (Feedback), and Location
      window.__pendingPermissionRequests = window.__pendingPermissionRequests || {};

      window.__resolvePermissionRequest = function(reqId, granted) {
        var req = window.__pendingPermissionRequests[reqId];
        if (req) {
          delete window.__pendingPermissionRequests[reqId];
          if (granted) {
            req.resolve(true);
          } else {
            req.reject(new DOMException('Permission denied', 'NotAllowedError'));
          }
        }
      };

      function requestNativePermissions(permissions) {
        return new Promise(function(resolve, reject) {
          if (!window.ReactNativeWebView) {
            resolve(true);
            return;
          }
          var reqId = 'perm_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
          window.__pendingPermissionRequests[reqId] = { resolve: resolve, reject: reject };

          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'REQUEST_PERMISSIONS',
            reqId: reqId,
            permissions: permissions
          }));

          // Safety timeout: if native takes more than 15 seconds, resolve anyway so browser can try
          setTimeout(function() {
            if (window.__pendingPermissionRequests[reqId]) {
              delete window.__pendingPermissionRequests[reqId];
              resolve(true);
            }
          }, 15000);
        });
      }

      // WebRTC: Intercept navigator.mediaDevices.getUserMedia
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        var origGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia = function(constraints) {
          var perms = [];
          if (constraints) {
            if (constraints.audio) perms.push('RECORD_AUDIO');
            if (constraints.video) perms.push('CAMERA');
          }
          if (perms.length > 0 && window.ReactNativeWebView) {
            return requestNativePermissions(perms).then(function() {
              return origGetUserMedia(constraints);
            }).catch(function(err) {
              throw err;
            });
          }
          return origGetUserMedia(constraints);
        };
      }

      // Legacy WebRTC getUserMedia support
      if (navigator.getUserMedia) {
        navigator.getUserMedia = function(constraints, success, error) {
          if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            navigator.mediaDevices.getUserMedia(constraints)
              .then(function(stream) { if (success) success(stream); })
              .catch(function(err) { if (error) error(err); });
          }
        };
      }
      if (navigator.webkitGetUserMedia) {
        navigator.webkitGetUserMedia = navigator.getUserMedia;
      }

      // Geolocation: Intercept navigator.geolocation
      if (navigator.geolocation) {
        var origGetCurrentPosition = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
        var origWatchPosition = navigator.geolocation.watchPosition.bind(navigator.geolocation);

        navigator.geolocation.getCurrentPosition = function(success, error, options) {
          if (window.ReactNativeWebView) {
            requestNativePermissions(['ACCESS_FINE_LOCATION']).then(function() {
              origGetCurrentPosition(success, error, options);
            }).catch(function(err) {
              if (error) {
                error({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
              }
            });
          } else {
            origGetCurrentPosition(success, error, options);
          }
        };

        navigator.geolocation.watchPosition = function(success, error, options) {
          if (window.ReactNativeWebView) {
            requestNativePermissions(['ACCESS_FINE_LOCATION']).then(function() {
              return origWatchPosition(success, error, options);
            }).catch(function(err) {
              if (error) {
                error({ code: 1, message: 'User denied Geolocation', PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 });
              }
              return 0;
            });
          } else {
            return origWatchPosition(success, error, options);
          }
        };
      }

      // Feedback / Camera Trigger: Detect user interactions with camera elements or image file inputs
      document.addEventListener('click', function(e) {
        try {
          var el = e.target;
          if (!el) return;

          var isImageInput = el.tagName === 'INPUT' && el.type === 'file' &&
            (!el.accept || el.accept.indexOf('image') !== -1 || el.hasAttribute('capture'));

          var isCameraAction = false;
          var curr = el;
          for (var d = 0; d < 4 && curr && curr !== document.body; d++) {
            var text = (curr.innerText || curr.textContent || '').toLowerCase();
            var aria = (curr.getAttribute('aria-label') || '').toLowerCase();
            var id = (curr.id || '').toLowerCase();
            var cls = (curr.className || '').toString().toLowerCase();

            if (text.indexOf('camera') !== -1 || text.indexOf('take photo') !== -1 || text.indexOf('take picture') !== -1 ||
                aria.indexOf('camera') !== -1 || aria.indexOf('photo') !== -1 ||
                id.indexOf('camera') !== -1 || id.indexOf('photo') !== -1 ||
                cls.indexOf('camera') !== -1 || cls.indexOf('photo') !== -1) {
              isCameraAction = true;
              break;
            }
            curr = curr.parentElement;
          }

          if ((isImageInput || isCameraAction) && !window.__cameraPermissionGranted) {
            requestNativePermissions(['CAMERA']).then(function() {
              window.__cameraPermissionGranted = true;
            }).catch(function() {});
          }
        } catch(err) {}
      });
    } catch(e) {}
  })();
  true;
`;

let permissionQueue = Promise.resolve();

const requestNativePermissionsAsync = async permissions => {
  return new Promise(resolve => {
    permissionQueue = permissionQueue.then(async () => {
      if (Platform.OS !== 'android') {
        resolve(true);
        return;
      }
      try {
        const toRequest = [];
        for (const perm of permissions) {
          let androidPerm = null;
          if (perm === 'RECORD_AUDIO') {
            androidPerm = PermissionsAndroid.PERMISSIONS.RECORD_AUDIO;
          } else if (perm === 'CAMERA') {
            androidPerm = PermissionsAndroid.PERMISSIONS.CAMERA;
          } else if (perm === 'ACCESS_FINE_LOCATION') {
            androidPerm = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
          }

          if (androidPerm) {
            const has = await PermissionsAndroid.check(androidPerm);
            if (!has) {
              toRequest.push(androidPerm);
              if (androidPerm === PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION) {
                toRequest.push(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION);
              }
            }
          }
        }

        if (toRequest.length === 0) {
          resolve(true);
          return;
        }

        const results = await PermissionsAndroid.requestMultiple(toRequest);
        let allGranted = true;
        for (const p of toRequest) {
          if (p === PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION) continue;
          if (results[p] !== PermissionsAndroid.RESULTS.GRANTED) {
            allGranted = false;
          }
        }
        resolve(allGranted);
      } catch (err) {
        console.warn('Native permission request error:', err);
        resolve(false);
      }
    });
  });
};

const isMicrosoftOAuthUrl = (url = '') => {
  if (!url || typeof url !== 'string') return false;
  const lower = url.toLowerCase();

  // Internal app or auth endpoints under markytics.ai are NEVER external Microsoft OAuth
  if (lower.includes('markytics.ai')) {
    return false;
  }

  // Strictly match genuine Microsoft OAuth / Azure AD login hosts
  return (
    lower.includes('login.microsoftonline.com') ||
    lower.includes('login.microsoft.com') ||
    lower.includes('login.live.com') ||
    lower.includes('account.live.com')
  );
};

function MainApp() {
  const webViewRef = useRef(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isOfflineModeActive, setIsOfflineModeActive] = useState(false);

  // True only when the top frame is genuinely on Microsoft's OAuth login page
  const [inMicrosoftAuth, setInMicrosoftAuth] = useState(false);
  // Animation value for smooth fade/slide
  const msBackAnim = useRef(new Animated.Value(0)).current;
  // Lock to prevent back-button flicker during return transition
  const isReturningToLoginRef = useRef(false);

  useEffect(() => {
    Animated.timing(msBackAnim, {
      toValue: inMicrosoftAuth ? 1 : 0,
      duration: inMicrosoftAuth ? 220 : 120,
      useNativeDriver: true,
    }).start();
  }, [inMicrosoftAuth]);

  // Check and request Camera, Microphone, and Location permissions upfront
  // and prompt user if any essential permission is denied.
  const checkAndEnsureAllPermissions = useCallback(async (showPromptOnDenied = true) => {
    if (Platform.OS !== 'android') return true;

    try {
      const required = [
        PermissionsAndroid.PERMISSIONS.CAMERA,
        PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      ];

      const needRequest = [];
      for (const perm of required) {
        const has = await PermissionsAndroid.check(perm);
        if (!has) {
          needRequest.push(perm);
        }
      }

      if (needRequest.includes(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)) {
        needRequest.push(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION);
      }

      if (needRequest.length > 0) {
        await PermissionsAndroid.requestMultiple(needRequest);
      }

      // Verify all 3 core permissions
      const hasCam = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
      const hasMic = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
      const hasLoc =
        (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION)) ||
        (await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION));

      if ((!hasCam || !hasMic || !hasLoc) && showPromptOnDenied) {
        const missing = [];
        if (!hasCam) missing.push('Camera');
        if (!hasMic) missing.push('Microphone');
        if (!hasLoc) missing.push('Location');

        Alert.alert(
          'Permissions Required',
          `Mark One requires ${missing.join(', ')} access to function properly (photo capture, voice features, and location verification). Please grant these permissions to continue.`,
          [
            {
              text: 'Open Settings',
              onPress: () => Linking.openSettings(),
            },
            {
              text: 'Allow Permissions',
              onPress: () => checkAndEnsureAllPermissions(true),
            },
          ],
          { cancelable: false }
        );
        return false;
      }
      return true;
    } catch (e) {
      console.warn('Failed to request initial permissions:', e);
      return false;
    }
  }, []);

  // Request all permissions upfront on app open
  useEffect(() => {
    const permTimer = setTimeout(() => {
      checkAndEnsureAllPermissions(true);
    }, 500);

    return () => clearTimeout(permTimer);
  }, [checkAndEnsureAllPermissions]);

  // Failsafe: ensure loading screen dismisses after 3 seconds even if website slow
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, []);

  // When app returns to foreground from background:
  // 1. Notify WebView to auto-submit pending feedbacks
  // 2. Silently verify permissions (e.g., if user came back from Settings)
  useEffect(() => {
    const subscription = AppState.addEventListener('change', nextAppState => {
      if (nextAppState === 'active') {
        if (webViewRef.current) {
          webViewRef.current.injectJavaScript(`
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('app_resumed_foreground'));
            }
            true;
          `);
        }
        if (Platform.OS === 'android') {
          checkAndEnsureAllPermissions(false);
        }
      }
    });
    return () => subscription.remove();
  }, [checkAndEnsureAllPermissions]);

  // Navigate back to the main login page (abort Microsoft auth)
  const returnToLogin = () => {
    // 1. Immediately hide the back button with ZERO delay
    setInMicrosoftAuth(false);
    isReturningToLoginRef.current = true;

    // 2. Smoothly replace URL in current webview without unmounting / flashing
    if (webViewRef.current) {
      try {
        webViewRef.current.stopLoading();
        webViewRef.current.injectJavaScript(
          `window.location.replace('${TARGET_URL}'); true;`
        );
      } catch (_) { }
    }

    // 3. Unlock after transition completes
    setTimeout(() => {
      isReturningToLoginRef.current = false;
    }, 2500);
  };

  // Handle Android Hardware Back Button
  useEffect(() => {
    const onBackPress = () => {
      // If in Microsoft auth flow, back = cancel auth and return to login
      if (inMicrosoftAuth) {
        returnToLogin();
        return true; // handled
      }
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
  }, [canGoBack, inMicrosoftAuth]);

  const handleRetry = () => {
    setHasError(false);
    setIsOfflineModeActive(false);
    setLoading(true);
    if (webViewRef.current) {
      webViewRef.current.reload();
    }
    setTimeout(() => setLoading(false), 3000);
  };

  const handleContinueOffline = () => {
    setHasError(false);
    setIsOfflineModeActive(true);
    setLoading(false);
    // Reload with cache mode active if webView is blank
    if (webViewRef.current) {
      webViewRef.current.reload();
    }
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
      } else if (message.type === 'REQUEST_PERMISSIONS') {
        const { reqId, permissions } = message;
        const granted = await requestNativePermissionsAsync(permissions || []);
        if (webViewRef.current && reqId) {
          const js = `if (window.__resolvePermissionRequest) { window.__resolvePermissionRequest('${reqId}', ${granted}); } true;`;
          webViewRef.current.injectJavaScript(js);
        }
      } else if (message.type === 'NETWORK_STATUS') {
        // Automatically switch back to LOAD_DEFAULT when online
        if (message.isOnline) {
          setIsOfflineModeActive(false);
        }
      }
    } catch (e) {
      // Ignored
    }
  };

  return (
    // Edges 'top' and 'bottom': Ensures UI starts below the network/battery status bar
    // and ends cleanly above bottom navigation buttons / gesture bar without overlapping.
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" translucent={false} />

      {/* When connection fails and user hasn't approved offline mode yet, prompt them */}
      {hasError && !isOfflineModeActive ? (
        <View style={styles.errorContainer}>
          <View style={styles.errorIconWrapper}>
            <Text style={styles.errorIcon}>📡</Text>
          </View>
          <Text style={styles.errorTitle}>Connection Notice</Text>
          <Text style={styles.errorMessage}>
            Your device does not have good internet connection. Are you still wish to continue?
          </Text>
          <View style={styles.buttonRow}>
            <TouchableOpacity
              style={[styles.actionButton, styles.retryButton]}
              onPress={handleRetry}
              activeOpacity={0.8}
            >
              <Text style={styles.retryButtonText}>No (Retry)</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.actionButton, styles.offlineButton]}
              onPress={handleContinueOffline}
              activeOpacity={0.8}
            >
              <Text style={styles.offlineButtonText}>Yes (Continue)</Text>
            </TouchableOpacity>
          </View>
        </View>
      ) : (
        <View style={styles.webviewContainer}>
          <WebView
            ref={webViewRef}
            source={{ uri: TARGET_URL }}
            style={styles.webview}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            databaseEnabled={true}
            // Offline Caching: When online, use standard LOAD_DEFAULT so API GETs are always fresh.
            // When offline, use LOAD_CACHE_ELSE_NETWORK to load cached resources.
            cacheEnabled={true}
            cacheMode={isOfflineModeActive ? 'LOAD_CACHE_ELSE_NETWORK' : 'LOAD_DEFAULT'}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
            startInLoadingState={false}
            allowFileAccess={true}
            allowFileAccessFromFileURLs={true}
            allowUniversalAccessFromFileURLs={true}
            mixedContentMode="always"
            allowsInlineMediaPlayback={true}
            mediaPlaybackRequiresUserAction={false}
            // Grant camera and microphone access to the WebView
            mediaCapturePermissionGrantType="grant"
            onPermissionRequest={request => {
              // Automatically grant WebChromeClient requested resources (camera/mic)
              if (request && typeof request.grant === 'function') {
                request.grant(request.resources);
              }
            }}
            geolocationEnabled={true}
            allowsProtectedMedia={true}
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
              const cleanUrl = url.split('?')[0].toLowerCase();
              // File downloads: intercept and hand off to native
              if (
                cleanUrl.endsWith('.csv') ||
                cleanUrl.endsWith('.xlsx') ||
                cleanUrl.endsWith('.xls') ||
                cleanUrl.endsWith('.pdf') ||
                cleanUrl.endsWith('.docx') ||
                cleanUrl.endsWith('.zip') ||
                url.includes('sample_') ||
                url.includes('/sample_scrub_file.csv')
              ) {
                if (FileDownloadModule) {
                  const filename = cleanUrl.split('/').pop() || 'download.csv';
                  FileDownloadModule.downloadUrl(url, filename, 'application/octet-stream');
                }
                return false;
              }
              // Only top-frame navigations dictate the Microsoft OAuth UI state
              if (!isReturningToLoginRef.current && request.isTopFrame !== false) {
                if (isMicrosoftOAuthUrl(url)) {
                  setInMicrosoftAuth(true);
                } else if (url.includes('markytics.ai')) {
                  setInMicrosoftAuth(false);
                }
              }
              return true;
            }}
            onLoadStart={syntheticEvent => {
              const url = syntheticEvent.nativeEvent.url || '';
              if (!isReturningToLoginRef.current) {
                if (isMicrosoftOAuthUrl(url)) {
                  setInMicrosoftAuth(true);
                } else if (url.includes('markytics.ai')) {
                  setInMicrosoftAuth(false);
                }
              }
            }}
            onNavigationStateChange={navState => {
              setCanGoBack(navState.canGoBack);
              const url = navState.url || '';
              if (!isReturningToLoginRef.current) {
                if (isMicrosoftOAuthUrl(url)) {
                  setInMicrosoftAuth(true);
                } else if (url.includes('markytics.ai')) {
                  setInMicrosoftAuth(false);
                }
              }
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
              // If offline mode is already triggered, do not hide webview
              if (!isOfflineModeActive) {
                setHasError(true);
                setLoading(false);
              }
            }}
            renderError={() => {
              // If offline mode is active, don't show WebView default dinosaur error
              if (isOfflineModeActive) {
                return <View style={styles.empty} />;
              }
              return null;
            }}
            onHttpError={syntheticEvent => {
              const { nativeEvent } = syntheticEvent;
              if (nativeEvent.statusCode >= 400) {
                console.warn('HTTP error status: ', nativeEvent.statusCode);
              }
            }}
          />

          {inMicrosoftAuth && (
            <Animated.View
              style={[
                styles.msBackOverlay,
                {
                  opacity: msBackAnim,
                  transform: [
                    {
                      translateY: msBackAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-10, 0],
                      }),
                    },
                  ],
                },
              ]}
              pointerEvents="box-none"
            >
              <TouchableOpacity
                style={styles.msBackButton}
                onPress={returnToLogin}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Back to Mark One login"
              >
                <Text style={styles.msBackArrow}>{'← '}</Text>
                <Text style={styles.msBackText}>Back to Mark One Login</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

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

export default function App() {
  return (
    <SafeAreaProvider>
      <MainApp />
    </SafeAreaProvider>
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
  empty: {
    width: 0,
    height: 0,
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
  errorIconWrapper: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(59, 130, 246, 0.3)',
  },
  errorIcon: {
    fontSize: 32,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#F8FAFC',
    marginBottom: 8,
  },
  errorMessage: {
    fontSize: 15,
    color: '#94A3B8',
    textAlign: 'center',
    marginBottom: 28,
    lineHeight: 22,
    maxWidth: 320,
  },
  buttonRow: {
    flexDirection: 'row',
    width: '100%',
    maxWidth: 340,
    gap: 12,
  },
  actionButton: {
    flex: 1,
    paddingVertical: 13,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
  },
  retryButton: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  retryButtonText: {
    color: '#CBD5E1',
    fontSize: 14,
    fontWeight: '700',
  },
  offlineButton: {
    backgroundColor: '#D97706', // warm amber for offline mode trigger
  },
  offlineButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  // Microsoft auth floating overlay — appears over WebView without resizing it
  msBackOverlay: {
    position: 'absolute',
    top: 12,
    left: 16,
    right: 16,
    zIndex: 9999,
    elevation: 9999,
  },
  msBackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#0F172A',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 6,
    alignSelf: 'flex-start',
  },
  msBackArrow: {
    color: '#60A5FA',
    fontSize: 18,
    fontWeight: '700',
    marginRight: 6,
  },
  msBackText: {
    color: '#F8FAFC',
    fontSize: 14,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
});