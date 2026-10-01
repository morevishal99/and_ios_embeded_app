import React, { useState, useRef, useEffect } from 'react';
import {
  StyleSheet,
  View,
  Text,
  Image,
  BackHandler,
  TouchableOpacity,
  StatusBar,
  NativeModules,
  PermissionsAndroid,
  Platform,
  Animated,
  AppState,
  ToastAndroid,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView, initialWindowMetrics } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';

const { FileDownloadModule } = NativeModules;
// Direct Portal URL: Opens My Customers directly. If session is not active, ProtectedRoute redirects to /login:
const PORTAL_URL = 'https://auxilo.markytics.com/portal/my-customers';
const LOGIN_URL = 'https://auxilo.markytics.com/login';
const TARGET_URL = PORTAL_URL;

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
      meta.setAttribute('content', 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover, interactive-widget=resizes-content');
    } catch (e) {}
  })();
  true;
`;

// Bridge sessionStorage auth tokens, intercept downloads, handle offline/network, and bridge permissions
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
      window.__IS_NATIVE_APP__ = true;
      window.Capacitor = window.Capacitor || {};
      window.Capacitor.isNativePlatform = function() { return true; };
      window.openNativeSettings = function() {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'OPEN_SETTINGS' }));
        }
      };
      window.ensureNativePermission = function(type, options) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'PERMISSION_DENIED_ALERT',
            permissionType: type,
            title: options && options.title,
            message: options && options.message
          }));
        }
      };

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
        var isAppleDevice = /iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

        navigator.mediaDevices.getUserMedia = function(constraints) {
          var perms = [];
          if (constraints) {
            if (constraints.audio) perms.push('RECORD_AUDIO');
            if (constraints.video) perms.push('CAMERA');
          }
          if (perms.length > 0 && window.ReactNativeWebView && !isAppleDevice) {
            return requestNativePermissions(perms).then(function() {
              return origGetUserMedia(constraints);
            }).catch(function(err) {
              return origGetUserMedia(constraints);
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

      // Native Location Bridge: Bypass WebKit origin-permission caching by requesting directly from native LocationManager
      window.__nativeLocationPending = {};
      window.__resolveNativeLocation = function(reqId, loc) {
        var cb = window.__nativeLocationPending[reqId];
        if (cb) {
          delete window.__nativeLocationPending[reqId];
          if (loc && loc.latitude != null && loc.longitude != null) {
            cb.success({
              coords: {
                latitude: Number(loc.latitude),
                longitude: Number(loc.longitude),
                accuracy: loc.accuracy || 10,
              },
              timestamp: loc.time || Date.now()
            });
          } else {
            cb.fallback();
          }
        }
      };

      // Geolocation: Intercept navigator.geolocation
      if (navigator.geolocation) {
        var origGetCurrentPosition = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
        var origWatchPosition = navigator.geolocation.watchPosition.bind(navigator.geolocation);

        navigator.geolocation.getCurrentPosition = function(success, error, options) {
          if (window.ReactNativeWebView) {
            var reqId = 'loc_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            window.__nativeLocationPending[reqId] = {
              success: success,
              fallback: function() {
                origGetCurrentPosition(success, error, options);
              }
            };
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'GET_NATIVE_LOCATION', reqId: reqId }));
            setTimeout(function() {
              if (window.__nativeLocationPending[reqId]) {
                var pending = window.__nativeLocationPending[reqId];
                delete window.__nativeLocationPending[reqId];
                pending.fallback();
              }
            }, 6000);
          } else {
            origGetCurrentPosition(success, error, options);
          }
        };

        navigator.geolocation.watchPosition = function(success, error, options) {
          return origWatchPosition(success, error, options);
        };
      }
      // Feedback / Camera / Location Trigger: Detect user interactions with feedback modal, image capture, or camera
      document.addEventListener('click', function(e) {
        try {
          var el = e.target;
          if (!el) return;

          var isImageInput = el.tagName === 'INPUT' && el.type === 'file' &&
            (!el.accept || el.accept.indexOf('image') !== -1 || el.hasAttribute('capture'));

          var isCameraAction = false;
          var isFeedbackAction = false;
          var curr = el;
          for (var d = 0; d < 6 && curr && curr !== document.body; d++) {
            var text = (curr.innerText || curr.textContent || '').toLowerCase();
            var aria = (curr.getAttribute('aria-label') || '').toLowerCase();
            var title = (curr.getAttribute('title') || '').toLowerCase();
            var id = (curr.id || '').toLowerCase();
            var cls = (curr.className || '').toString().toLowerCase();
            var combined = text + ' ' + aria + ' ' + title + ' ' + id + ' ' + cls;

            if (combined.indexOf('camera') !== -1 || combined.indexOf('take photo') !== -1 ||
                combined.indexOf('take picture') !== -1 || combined.indexOf('photo') !== -1) {
              isCameraAction = true;
            }

            if (combined.indexOf('capture') !== -1 ||
                combined.indexOf('screenshot') !== -1 || combined.indexOf('location') !== -1 ||
                combined.indexOf('gps') !== -1) {
              isFeedbackAction = true;
            }

            if (isCameraAction && isFeedbackAction) break;
            curr = curr.parentElement;
          }

          var perms = [];
          if (isImageInput || isCameraAction) {
            perms.push('CAMERA');
          }
          // While in feedback modal, image capture, or camera action, proactively ensure location permission is asked
          if (isFeedbackAction || isImageInput || isCameraAction) {
            perms.push('ACCESS_FINE_LOCATION');
          }

          if (perms.length > 0) {
            requestNativePermissions(perms).catch(function() {});
          }
        } catch(err) {}
      }, true);

      // Network Status Monitor
      window.addEventListener('online', function() {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'NETWORK_STATUS', isOnline: true }));
        }
      });
      window.addEventListener('offline', function() {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'NETWORK_STATUS', isOnline: false }));
        }
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
        let askingLocation = false;

        for (const perm of permissions) {
          if (perm === 'RECORD_AUDIO') {
            const hasAudio = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
            if (!hasAudio) {
              toRequest.push(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
            }
          } else if (perm === 'CAMERA') {
            const hasCam = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA);
            if (!hasCam) {
              toRequest.push(PermissionsAndroid.PERMISSIONS.CAMERA);
            }
          } else if (perm === 'ACCESS_FINE_LOCATION' || perm === 'LOCATION') {
            askingLocation = true;
          }
        }

        let hasLocationAlready = false;
        if (askingLocation) {
          const hasFine = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
          const hasCoarse = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION);
          hasLocationAlready = hasFine || hasCoarse;
          if (!hasLocationAlready) {
            toRequest.push(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
            toRequest.push(PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION);
          }
        }

        if (toRequest.length === 0) {
          resolve(true);
          return;
        }

        const results = await PermissionsAndroid.requestMultiple(toRequest);

        // Verify non-location permissions
        let nonLocGranted = true;
        for (const p of toRequest) {
          if (
            p === PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION ||
            p === PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION
          ) {
            continue;
          }
          if (results[p] !== PermissionsAndroid.RESULTS.GRANTED) {
            nonLocGranted = false;
          }
        }

        // Verify location permissions (either fine or coarse counts as granted on Android 12+)
        let locGranted = true;
        if (askingLocation) {
          if (hasLocationAlready) {
            locGranted = true;
          } else {
            const fineOk = results[PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;
            const coarseOk = results[PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION] === PermissionsAndroid.RESULTS.GRANTED;
            locGranted = fineOk || coarseOk;
          }
        }

        resolve(nonLocGranted && locGranted);
      } catch (err) {
        console.warn('Native permission request error:', err);
        resolve(false);
      }
    });
  });
};

const isMicrosoftOAuthUrl = (url = '') => {
  if (!url || typeof url !== 'string') return false;
  try {
    // Extract hostname from URL
    const hostMatch = url.match(/^https?:\/\/([^/?#:]+)/i);
    const host = hostMatch ? hostMatch[1].toLowerCase() : url.toLowerCase();

    // If host itself belongs to markytics, it is an internal page, NOT external Microsoft OAuth
    if (host.includes('markytics.ai') || host.includes('markytics.com')) {
      return false;
    }

    // Match genuine Microsoft OAuth / Azure AD / Live / Windows SSO login hosts
    return (
      host.includes('microsoft') ||
      host.includes('live.com') ||
      host.includes('windows.net') ||
      host.includes('msftauth') ||
      host.includes('msauth')
    );
  } catch (e) {
    return false;
  }
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
  // Track last back-press timestamp for "Press back again to exit" toast
  const lastBackPressTimeRef = useRef(0);
  // Track current active URL to differentiate root/home screens from sub-pages
  const currentUrlRef = useRef(TARGET_URL);

  useEffect(() => {
    Animated.timing(msBackAnim, {
      toValue: inMicrosoftAuth ? 1 : 0,
      duration: inMicrosoftAuth ? 220 : 120,
      useNativeDriver: true,
    }).start();
  }, [inMicrosoftAuth]);



  // Failsafe: ensure static splash screen dismisses even if website or network is slow
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  // When app returns to foreground from background, notify WebView to auto-submit pending feedbacks
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
      }
    });
    return () => subscription.remove();
  }, []);

  // Navigate back to the main login page (abort Microsoft auth)
  const returnToLogin = () => {
    // 1. Immediately hide the back button with ZERO delay
    setInMicrosoftAuth(false);
    isReturningToLoginRef.current = true;

    // 2. Clear returning lock after short 350ms transition so subsequent clicks work immediately
    setTimeout(() => {
      isReturningToLoginRef.current = false;
    }, 350);

    // 3. Smoothly replace URL in current webview without unmounting / flashing
    if (webViewRef.current) {
      try {
        webViewRef.current.stopLoading();
        webViewRef.current.injectJavaScript(
          `window.location.replace('${LOGIN_URL}'); true;`
        );
      } catch (_) { }
    }
  };

  // Handle Android Hardware Back Button
  useEffect(() => {
    const onBackPress = () => {
      // 1. If in Microsoft auth flow, back = cancel auth and return to login
      if (inMicrosoftAuth) {
        returnToLogin();
        return true; // handled
      }

      const currentUrl = (currentUrlRef.current || '').toLowerCase();

      // Check if current screen is considered a root screen (Login or Logged-in Home screen)
      const isLoginScreen = currentUrl.includes('/login') || currentUrl === LOGIN_URL.toLowerCase();
      const isHomeScreen = currentUrl.includes('/portal/my-customers') ||
        currentUrl.endsWith('/portal') ||
        currentUrl.endsWith('/portal/');
      const isRootScreen = isLoginScreen || isHomeScreen || !canGoBack;

      // 2. If on a sub-page and not a root screen, let WebView go back
      if (canGoBack && !isRootScreen && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }

      // 3. On root screen (Login or Logged-in Home screen) or when nowhere to go back:
      // Double tap back within 2 seconds to exit app with toast prompt
      const now = Date.now();
      if (now - lastBackPressTimeRef.current < 2000) {
        BackHandler.exitApp();
        return true;
      }

      lastBackPressTimeRef.current = now;
      if (Platform.OS === 'android') {
        ToastAndroid.show('Press back again to exit', ToastAndroid.SHORT);
      }
      return true;
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
    setTimeout(() => setLoading(false), 2000);
  };

  const handleContinueOffline = () => {
    setHasError(false);
    setIsOfflineModeActive(true);
    setLoading(false);
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
        if (message.isOnline) {
          setIsOfflineModeActive(false);
        }
      } else if (message.type === 'GET_NATIVE_LOCATION') {
        const { reqId } = message;
        try {
          let loc = null;
          if (NativeModules.DeviceLocationModule && NativeModules.DeviceLocationModule.getLatestLocation) {
            loc = await NativeModules.DeviceLocationModule.getLatestLocation();
          }
          if (webViewRef.current && reqId) {
            const js = `if (window.__resolveNativeLocation) { window.__resolveNativeLocation('${reqId}', ${JSON.stringify(loc)}); } true;`;
            webViewRef.current.injectJavaScript(js);
          }
        } catch (e) {
          if (webViewRef.current && reqId) {
            const js = `if (window.__resolveNativeLocation) { window.__resolveNativeLocation('${reqId}', null); } true;`;
            webViewRef.current.injectJavaScript(js);
          }
        }
      } else if (message.type === 'OPEN_SETTINGS') {
        Linking.openSettings().catch(err => {
          console.warn('Failed to open settings:', err);
        });
      } else if (message.type === 'PERMISSION_DENIED_ALERT') {
        const { permissionType, title, message: alertMessage } = message;
        const normType = permissionType === 'audio' ? 'microphone' : (permissionType || 'location');
        const featureLabel =
          normType === 'camera'
            ? 'Camera'
            : normType === 'microphone'
              ? 'Microphone'
              : 'Location';

        const defaultTitle = title || `${featureLabel} Permission Required`;
        const defaultMsg =
          alertMessage ||
          (normType === 'camera'
            ? 'Mark One Mobile requires Camera access to capture visit verification photos. Please grant permission or enable it in Settings.'
            : normType === 'microphone'
              ? 'Mark One Mobile requires Microphone access to place phone and WebRTC calls. Please grant permission or enable it in Settings.'
              : 'Mark One Mobile requires Location access to verify visit locations. Please grant permission or enable it in Settings.');

        Alert.alert(
          defaultTitle,
          defaultMsg,
          [
            {
              text: 'Cancel',
              style: 'cancel',
            },
            {
              text: 'Try Again',
              onPress: () => {
                if (webViewRef.current) {
                  webViewRef.current.injectJavaScript(`
                    if (window.__onPermissionRetry) {
                      window.__onPermissionRetry('${normType}');
                    }
                    true;
                  `);
                }
              },
            },
            {
              text: 'Open Settings',
              onPress: () => {
                Linking.openSettings().catch(() => { });
              },
            },
          ],
          { cancelable: true }
        );
      }
    } catch (e) {
      // Ignored
    }
  };
  const updateAuthStatusFromUrl = url => {
    if (!url) return;
    currentUrlRef.current = url;
    if (isMicrosoftOAuthUrl(url)) {
      isReturningToLoginRef.current = false;
      setInMicrosoftAuth(true);
    } else if (!isReturningToLoginRef.current) {
      const hostMatch = url.match(/^https?:\/\/([^/?#:]+)/i);
      const host = hostMatch ? hostMatch[1].toLowerCase() : url.toLowerCase();
      if (host.includes('markytics.ai') || host.includes('markytics.com')) {
        setInMicrosoftAuth(false);
      }
    }
  };

  return (
    // Edges: On iOS, use ['top', 'bottom'] for notch and home indicator bar.
    // On Android, use ['top'] only.
    // Applying 'bottom' edge on Android causes a destructive layout cycle with gesture navigation:
    // when the keyboard opens, Android's adjustResize collapses the gesture bar inset to 0,
    // which triggers SafeAreaView to remove bottom padding, shifting the WebView, causing the input
    // to lose focus (blur). The blur triggers the keyboard to close, restoring the gesture inset,
    // which re-adds bottom padding, refocuses the input, and re-opens the keyboard in an infinite loop
    // that crashes the app.
    <SafeAreaView
      style={styles.container}
      edges={Platform.OS === 'ios' ? ['top', 'bottom'] : ['top']}
    >
      <StatusBar barStyle="light-content" backgroundColor="#0F172A" translucent={false} />

      {/* When connection fails and user hasn't approved offline mode yet, prompt them */}
      {hasError && !isOfflineModeActive ? (
        <View style={styles.errorContainer}>
          <View style={styles.errorIconWrapper}>
            <Text style={styles.errorIcon}>📡</Text>
          </View>
          <Text style={styles.errorTitle}>Connection Notice</Text>
          <Text style={styles.errorMessage}>
            Your device does not have good internet connection. Do you still wish to continue?
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
            applicationNameForUserAgent="MarkOneApp/1.0"
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
            mediaCapturePermissionGrantType="grant"
            onPermissionRequest={request => {
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
              if (request.isTopFrame !== false) {
                updateAuthStatusFromUrl(url);
              }
              return true;
            }}
            onLoadStart={syntheticEvent => {
              const url = syntheticEvent.nativeEvent.url || '';
              updateAuthStatusFromUrl(url);
            }}
            onNavigationStateChange={navState => {
              setCanGoBack(navState.canGoBack);
              const url = navState.url || '';
              updateAuthStatusFromUrl(url);
            }}
            onLoadProgress={({ nativeEvent }) => {
              if (nativeEvent.url) {
                updateAuthStatusFromUrl(nativeEvent.url);
              }
            }}
            onLoad={() => setLoading(false)}
            onLoadEnd={syntheticEvent => {
              setLoading(false);
              if (syntheticEvent.nativeEvent && syntheticEvent.nativeEvent.url) {
                updateAuthStatusFromUrl(syntheticEvent.nativeEvent.url);
              }
            }}
            onError={syntheticEvent => {
              const { nativeEvent } = syntheticEvent;
              console.warn('WebView error: ', nativeEvent);
              // If offline mode is active, do not hide webview
              if (!isOfflineModeActive) {
                setHasError(true);
                setLoading(false);
              }
            }}
            renderError={() => {
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
                <View style={styles.arrowBadge}>
                  <View style={styles.arrowContainer}>
                    <View style={styles.arrowStem} />
                    <View style={styles.arrowHead} />
                  </View>
                </View>
                <Text style={styles.msBackText}>Back to Mark One Login</Text>
              </TouchableOpacity>
            </Animated.View>
          )}

          {loading && (
            <View style={styles.staticSplashOverlay} pointerEvents="none">
              <Image source={LOGO_IMG} style={styles.staticSplashLogo} resizeMode="contain" />
            </View>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

export default function App() {
  return (
    <SafeAreaProvider initialWindowMetrics={initialWindowMetrics}>
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
  staticSplashOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 9999,
  },
  staticSplashLogo: {
    width: 90,
    height: 90,
    borderRadius: 20,
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
    backgroundColor: '#D97706',
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
    borderWidth: 1.5,
    borderColor: '#334155',
    paddingVertical: 7,
    paddingLeft: 8,
    paddingRight: 16,
    borderRadius: 22,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 6,
    elevation: 8,
    alignSelf: 'flex-start',
  },
  arrowBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(56, 189, 248, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.3)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  arrowContainer: {
    width: 14,
    height: 14,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  arrowStem: {
    width: 11,
    height: 2,
    backgroundColor: '#38BDF8',
    borderRadius: 1,
    position: 'absolute',
    left: 2,
    top: 6,
  },
  arrowHead: {
    width: 7,
    height: 7,
    borderLeftWidth: 2,
    borderBottomWidth: 2,
    borderColor: '#38BDF8',
    position: 'absolute',
    left: 2,
    top: 3.5,
    transform: [{ rotate: '45deg' }],
    borderBottomLeftRadius: 1,
  },
  msBackText: {
    color: '#F8FAFC',
    fontSize: 13.5,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginLeft: 10,
  },
});