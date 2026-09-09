package com.smartcollect.app;

import android.app.DownloadManager;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.widget.Toast;

import com.facebook.react.bridge.Promise;
import com.facebook.react.bridge.ReactApplicationContext;
import com.facebook.react.bridge.ReactContextBaseJavaModule;
import com.facebook.react.bridge.ReactMethod;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

public class DownloadModule extends ReactContextBaseJavaModule {
    private final ReactApplicationContext reactContext;

    public DownloadModule(ReactApplicationContext reactContext) {
        super(reactContext);
        this.reactContext = reactContext;
    }

    @Override
    public String getName() {
        return "FileDownloadModule";
    }

    @ReactMethod
    public void saveBase64File(String base64Data, String filename, String mimeType, Promise promise) {
        try {
            String cleanBase64 = base64Data;
            if (cleanBase64.contains(",")) {
                cleanBase64 = cleanBase64.substring(cleanBase64.indexOf(",") + 1);
            }

            byte[] decodedBytes = Base64.decode(cleanBase64, Base64.DEFAULT);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ContentValues values = new ContentValues();
                values.put(MediaStore.Downloads.DISPLAY_NAME, filename);
                values.put(MediaStore.Downloads.MIME_TYPE, mimeType != null ? mimeType : "application/octet-stream");
                values.put(MediaStore.Downloads.IS_PENDING, 1);

                Uri uri = reactContext.getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                if (uri != null) {
                    try (OutputStream os = reactContext.getContentResolver().openOutputStream(uri)) {
                        if (os != null) {
                            os.write(decodedBytes);
                            os.flush();
                        }
                    }
                    values.clear();
                    values.put(MediaStore.Downloads.IS_PENDING, 0);
                    reactContext.getContentResolver().update(uri, values, null, null);
                }
            } else {
                File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                if (!downloadsDir.exists()) {
                    downloadsDir.mkdirs();
                }
                File file = new File(downloadsDir, filename);
                try (FileOutputStream fos = new FileOutputStream(file)) {
                    fos.write(decodedBytes);
                    fos.flush();
                }
                DownloadManager dm = (DownloadManager) reactContext.getSystemService(Context.DOWNLOAD_SERVICE);
                if (dm != null) {
                    dm.addCompletedDownload(file.getName(), file.getName(), true, mimeType, file.getAbsolutePath(), file.length(), true);
                }
            }

            reactContext.runOnUiQueueThread(() -> {
                Toast.makeText(reactContext, "Downloaded " + filename + " to Downloads", Toast.LENGTH_LONG).show();
            });

            promise.resolve(true);
        } catch (Exception e) {
            reactContext.runOnUiQueueThread(() -> {
                Toast.makeText(reactContext, "Download failed: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            });
            promise.reject("DOWNLOAD_ERROR", e.getMessage());
        }
    }

    @ReactMethod
    public void downloadUrl(String fileUrl, String filename, String mimeType, Promise promise) {
        try {
            Uri parsedUri = Uri.parse(fileUrl);
            DownloadManager.Request request = new DownloadManager.Request(parsedUri);
            if (mimeType != null && !mimeType.isEmpty()) {
                request.setMimeType(mimeType);
            }

            try {
                String cookie = android.webkit.CookieManager.getInstance().getCookie(fileUrl);
                if (cookie != null && !cookie.isEmpty()) {
                    request.addRequestHeader("Cookie", cookie);
                }
            } catch (Exception ignored) {}

            String safeName = filename != null && !filename.isEmpty() ? filename : parsedUri.getLastPathSegment();
            if (safeName == null || safeName.isEmpty()) {
                safeName = "download_" + System.currentTimeMillis() + ".csv";
            }

            request.setTitle(safeName);
            request.setDescription("Downloading " + safeName);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, safeName);

            DownloadManager dm = (DownloadManager) reactContext.getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm != null) {
                dm.enqueue(request);
                final String displayName = safeName;
                reactContext.runOnUiQueueThread(() -> {
                    Toast.makeText(reactContext, "Downloading " + displayName + "...", Toast.LENGTH_SHORT).show();
                });
            }
            promise.resolve(true);
        } catch (Exception e) {
            reactContext.runOnUiQueueThread(() -> {
                Toast.makeText(reactContext, "Download failed: " + e.getMessage(), Toast.LENGTH_SHORT).show();
            });
            promise.reject("DOWNLOAD_ERROR", e.getMessage());
        }
    }
}
