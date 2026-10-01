package com.markone.app;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import androidx.core.content.ContextCompat;

import com.facebook.react.bridge.Arguments;
import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;
import com.facebook.react.bridge.WritableMap;

public class DeviceLocationModule extends ReactContextBaseJavaModule {
    private final ReactApplicationContext reactContext;

    public DeviceLocationModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @Override
    public String getName() {
        return "DeviceLocationModule";
    }

    @ReactMethod
    public void checkLocationPermission(Promise promise) {
        boolean fine = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean coarse = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        promise.resolve(fine || coarse);
    }

    @ReactMethod
    public void checkCameraPermission(Promise promise) {
        boolean cam = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED;
        promise.resolve(cam);
    }

    @ReactMethod
    public void checkMicrophonePermission(Promise promise) {
        boolean mic = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
        promise.resolve(mic);
    }

    @ReactMethod
    public void getLatestLocation(Promise promise) {
        boolean fine = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED;
        boolean coarse = ContextCompat.checkSelfPermission(reactContext, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;

        if (!fine && !coarse) {
            promise.resolve(null);
            return;
        }

        try {
            LocationManager lm = (LocationManager) reactContext.getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) {
                promise.resolve(null);
                return;
            }

            Location bestLocation = null;
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                Location gps = lm.getLastKnownLocation(LocationManager.GPS_PROVIDER);
                if (gps != null) bestLocation = gps;
            }

            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                Location net = lm.getLastKnownLocation(LocationManager.NETWORK_PROVIDER);
                if (net != null) {
                    if (bestLocation == null || net.getTime() > bestLocation.getTime() || (net.hasAccuracy() && bestLocation.hasAccuracy() && net.getAccuracy() < bestLocation.getAccuracy())) {
                        bestLocation = net;
                    }
                }
            }

            if (lm.isProviderEnabled(LocationManager.PASSIVE_PROVIDER)) {
                Location passive = lm.getLastKnownLocation(LocationManager.PASSIVE_PROVIDER);
                if (passive != null && bestLocation == null) {
                    bestLocation = passive;
                }
            }

            long now = System.currentTimeMillis();
            if (bestLocation != null && (now - bestLocation.getTime()) < 60000) {
                WritableMap map = Arguments.createMap();
                map.putDouble("latitude", bestLocation.getLatitude());
                map.putDouble("longitude", bestLocation.getLongitude());
                map.putDouble("accuracy", bestLocation.hasAccuracy() ? bestLocation.getAccuracy() : 10.0);
                map.putDouble("time", (double) bestLocation.getTime());
                promise.resolve(map);
                return;
            }

            final Location fallbackLoc = bestLocation;
            Handler mainHandler = new Handler(Looper.getMainLooper());
            mainHandler.post(() -> {
                final boolean[] resolved = {false};
                final LocationListener listener = new LocationListener() {
                    @Override
                    public void onLocationChanged(Location loc) {
                        if (!resolved[0]) {
                            resolved[0] = true;
                            try { lm.removeUpdates(this); } catch (Exception ignored) {}
                            WritableMap map = Arguments.createMap();
                            map.putDouble("latitude", loc.getLatitude());
                            map.putDouble("longitude", loc.getLongitude());
                            map.putDouble("accuracy", loc.hasAccuracy() ? loc.getAccuracy() : 10.0);
                            map.putDouble("time", (double) loc.getTime());
                            promise.resolve(map);
                        }
                    }

                    @Override
                    public void onStatusChanged(String provider, int status, Bundle extras) {}
                    @Override
                    public void onProviderEnabled(String provider) {}
                    @Override
                    public void onProviderDisabled(String provider) {}
                };

                mainHandler.postDelayed(() -> {
                    if (!resolved[0]) {
                        resolved[0] = true;
                        try { lm.removeUpdates(listener); } catch (Exception ignored) {}
                        if (fallbackLoc != null) {
                            WritableMap map = Arguments.createMap();
                            map.putDouble("latitude", fallbackLoc.getLatitude());
                            map.putDouble("longitude", fallbackLoc.getLongitude());
                            map.putDouble("accuracy", fallbackLoc.hasAccuracy() ? fallbackLoc.getAccuracy() : 10.0);
                            map.putDouble("time", (double) fallbackLoc.getTime());
                            promise.resolve(map);
                        } else {
                            promise.resolve(null);
                        }
                    }
                }, 5000);

                try {
                    if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                        lm.requestSingleUpdate(LocationManager.NETWORK_PROVIDER, listener, Looper.getMainLooper());
                    } else if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                        lm.requestSingleUpdate(LocationManager.GPS_PROVIDER, listener, Looper.getMainLooper());
                    }
                } catch (Exception e) {
                    if (!resolved[0]) {
                        resolved[0] = true;
                        if (fallbackLoc != null) {
                            WritableMap map = Arguments.createMap();
                            map.putDouble("latitude", fallbackLoc.getLatitude());
                            map.putDouble("longitude", fallbackLoc.getLongitude());
                            map.putDouble("accuracy", fallbackLoc.hasAccuracy() ? fallbackLoc.getAccuracy() : 10.0);
                            map.putDouble("time", (double) fallbackLoc.getTime());
                            promise.resolve(map);
                        } else {
                            promise.resolve(null);
                        }
                    }
                }
            });

        } catch (Exception e) {
            promise.resolve(null);
        }
    }
}
