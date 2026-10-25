package io.github.pockethwp;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import android.util.Log;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * 다른 앱에서 "Pocket HWP로 열기"(VIEW) 또는 "공유"(SEND)로 넘어온 문서를 받는다.
 *
 * content:// 주소는 WebView 쪽에서 읽기 어렵고 원래 파일 이름도 숨겨져 있으므로,
 * 앱 캐시에 원래 이름으로 복사한 뒤 file:// 주소의 VIEW 인텐트로 바꿔서 넘긴다.
 * 웹 코드는 Capacitor App 플러그인의 appUrlOpen 이벤트로 이 주소를 받는다.
 */
public class MainActivity extends BridgeActivity {
    private static final String TAG = "PocketHwp";
    private static final long MAX_BYTES = 200L * 1024 * 1024;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // 앱 안에 들어 있는 플러그인: 원래 파일 자리에 다시 저장하기
        registerPlugin(DocumentFilesPlugin.class);
        setIntent(normalize(getIntent()));
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(normalize(intent));
    }

    private Intent normalize(Intent intent) {
        if (intent == null) return null;
        Uri source = null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) {
            source = intent.getData();
        } else if (Intent.ACTION_SEND.equals(intent.getAction())) {
            source = intent.getParcelableExtra(Intent.EXTRA_STREAM);
        }
        if (source == null) return intent;
        // 다른 앱이 file:// 주소나 이 앱의 FileProvider 주소를 넘기면 앱 안의 파일을 대신 읽게 될 수 있다.
        // 그런 주소는 버리고 그냥 앱을 연다. 받는 문서는 content:// 만 쓴다.
        if (!ContentResolver.SCHEME_CONTENT.equals(source.getScheme()) || isOwnAuthority(source)) {
            return new Intent(Intent.ACTION_MAIN);
        }
        try {
            File copy = copyToCache(source);
            Intent view = new Intent(Intent.ACTION_VIEW, Uri.fromFile(copy));
            view.setFlags(intent.getFlags());
            return view;
        } catch (Exception e) {
            Log.w(TAG, "incoming document copy failed", e);
            return intent;
        }
    }

    private boolean isOwnAuthority(Uri uri) {
        String authority = uri.getAuthority();
        String pkg = getPackageName();
        return authority != null && (authority.equals(pkg) || authority.startsWith(pkg + "."));
    }

    private File copyToCache(Uri uri) throws Exception {
        File dir = new File(getCacheDir(), "incoming");
        if (!dir.exists() && !dir.mkdirs()) throw new IllegalStateException("cannot create cache dir");
        File out = new File(dir, safeName(displayName(uri)));
        long total = 0;
        try (InputStream in = getContentResolver().openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
            if (in == null) throw new IllegalStateException("no input stream");
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_BYTES) throw new IllegalStateException("document too large");
                os.write(buf, 0, n);
            }
        }
        return out;
    }

    private String displayName(Uri uri) {
        try (Cursor c = getContentResolver().query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                String name = c.getString(0);
                if (name != null && !name.isEmpty()) return name;
            }
        } catch (Exception ignored) {
            // 이름을 못 얻으면 아래 기본값을 쓴다.
        }
        String type = getContentResolver().getType(uri);
        boolean hwpx = type != null && (type.contains("hwpx") || type.equals("application/hwp+zip"));
        return hwpx ? "받은 문서.hwpx" : "받은 문서.hwp";
    }

    private static String safeName(String name) {
        String cleaned = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        if (cleaned.length() > 120) cleaned = cleaned.substring(cleaned.length() - 120);
        // "."·".." 같은 이름은 폴더를 가리키므로 쓰지 않는다.
        return cleaned.isEmpty() || cleaned.matches("\\.+") ? "받은 문서.hwp" : cleaned;
    }
}
