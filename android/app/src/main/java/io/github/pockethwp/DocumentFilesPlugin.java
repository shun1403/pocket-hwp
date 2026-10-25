package io.github.pockethwp;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * 원래 파일 자리에 다시 저장하기 위한 문서 열기·쓰기 (Storage Access Framework).
 *
 * open: ACTION_OPEN_DOCUMENT 로 고른 문서를 읽고, 가능하면 영구 쓰기 권한을 받아 둔다.
 * write: 영구 쓰기 권한을 가진 주소에만 쓴다. 웹 코드가 아무 주소에나 쓰게 하지 않는다.
 */
@CapacitorPlugin(name = "DocumentFiles")
public class DocumentFilesPlugin extends Plugin {
    private static final long MAX_BYTES = 200L * 1024 * 1024;
    private static final String[] MIME_TYPES = {
        "application/x-hwp",
        "application/haansofthwp",
        "application/vnd.hancom.hwp",
        "application/hwp+zip",
        "application/vnd.hancom.hwpx",
        "application/haansofthwpx",
        "application/octet-stream",
    };

    @PluginMethod
    public void open(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("*/*");
        intent.putExtra(Intent.EXTRA_MIME_TYPES, MIME_TYPES);
        intent.addFlags(
            Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
        );
        startActivityForResult(call, intent, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            JSObject cancelled = new JSObject();
            cancelled.put("cancelled", true);
            call.resolve(cancelled);
            return;
        }
        Uri uri = data.getData();
        ContentResolver resolver = getContext().getContentResolver();
        boolean writable;
        try {
            resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            writable = true;
        } catch (SecurityException e) {
            // 쓰기를 허락하지 않는 저장소(일부 클라우드 앱 등): 읽기만 한다.
            writable = false;
        }
        final boolean canWrite = writable;
        // 큰 파일을 읽는 동안 화면이 멈추지 않도록 따로 읽는다.
        new Thread(() -> {
            try {
                byte[] bytes = readAll(resolver, uri);
                JSObject out = new JSObject();
                out.put("uri", uri.toString());
                out.put("name", displayName(resolver, uri));
                out.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
                out.put("writable", canWrite);
                call.resolve(out);
            } catch (Exception e) {
                call.reject("문서를 읽지 못했어요.", "READ_FAILED", e);
            }
        }).start();
    }

    @PluginMethod
    public void write(PluginCall call) {
        String uriText = call.getString("uri");
        String data = call.getString("data");
        if (uriText == null || data == null) {
            call.reject("uri, data 가 필요해요.", "BAD_REQUEST");
            return;
        }
        Uri uri = Uri.parse(uriText);
        ContentResolver resolver = getContext().getContentResolver();
        if (!hasWritePermission(resolver, uri)) {
            call.reject("이 파일에 쓸 권한이 없어요.", "NO_PERMISSION");
            return;
        }
        byte[] bytes = Base64.decode(data, Base64.DEFAULT);
        try {
            writeAll(resolver, uri, bytes, "wt");
        } catch (Exception truncateUnsupported) {
            // "wt"(비우고 쓰기)를 못 하는 저장소가 있다. 그때는 "w"로 쓴다.
            try {
                writeAll(resolver, uri, bytes, "w");
            } catch (Exception e) {
                call.reject("원래 파일에 저장하지 못했어요.", "WRITE_FAILED", e);
                return;
            }
        }
        call.resolve(new JSObject());
    }

    private static boolean hasWritePermission(ContentResolver resolver, Uri uri) {
        for (UriPermission p : resolver.getPersistedUriPermissions()) {
            if (p.getUri().equals(uri) && p.isWritePermission()) return true;
        }
        return false;
    }

    private static void writeAll(ContentResolver resolver, Uri uri, byte[] bytes, String mode) throws Exception {
        try (OutputStream os = resolver.openOutputStream(uri, mode)) {
            if (os == null) throw new IllegalStateException("no output stream");
            os.write(bytes);
        }
    }

    private static byte[] readAll(ContentResolver resolver, Uri uri) throws Exception {
        try (InputStream in = resolver.openInputStream(uri); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) throw new IllegalStateException("no input stream");
            byte[] buf = new byte[64 * 1024];
            long total = 0;
            int n;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_BYTES) throw new IllegalStateException("document too large");
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    private static String displayName(ContentResolver resolver, Uri uri) {
        try (Cursor c = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String name = c.getString(0);
                if (name != null && !name.isEmpty()) return name;
            }
        } catch (Exception ignored) {
            // 이름을 못 얻으면 기본값
        }
        return "문서.hwp";
    }
}
