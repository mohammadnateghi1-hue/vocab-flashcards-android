package com.nateghi.vocabflashcards;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.speech.tts.TextToSpeech;
import android.speech.tts.Voice;
import android.util.Base64;
import android.util.Xml;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;
import org.xmlpull.v1.XmlPullParser;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.zip.GZIPInputStream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

public class MainActivity extends Activity {
    private WebView webView;
    private ValueCallback<Uri[]> filePathCallback;
    private static final int FILE_CHOOSER_REQUEST = 1001;
    private static final int EXCEL_CHOOSER_REQUEST = 1002;
    private TextToSpeech tts;
    private boolean ttsReady = false;

    private static final String[] XLSX_HEADERS = {
            "word", "ipa", "pronunciation_fa", "part_of_speech",
            "meaning_fa", "example_en", "example_fa",
            "lesson", "level", "sense_order", "notes"
    };

    @SuppressLint({"SetJavaScriptEnabled", "AddJavascriptInterface"})
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        webView = new WebView(this);
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setDatabaseEnabled(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (filePathCallback != null) filePathCallback.onReceiveValue(null);
                filePathCallback = callback;
                try {
                    Intent intent = params.createIntent();
                    startActivityForResult(intent, FILE_CHOOSER_REQUEST);
                    return true;
                } catch (Exception e) {
                    filePathCallback = null;
                    toast("امکان انتخاب فایل وجود ندارد");
                    return false;
                }
            }
        });

        tts = new TextToSpeech(this, status -> {
            ttsReady = status == TextToSpeech.SUCCESS;
            if (ttsReady) {
                tts.setLanguage(Locale.US);
                tts.setPitch(1.0f);
                tts.setSpeechRate(0.86f);
            }
        });

        webView.addJavascriptInterface(new AndroidBridge(), "Android");
        webView.loadUrl("file:///android_asset/index.html");
    }

    private void toast(String message) {
        runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_LONG).show());
    }

    private Voice findBestVoice(Locale locale) {
        if (!ttsReady || tts == null) return null;
        try {
            Set<Voice> voices = tts.getVoices();
            if (voices == null || voices.isEmpty()) return null;
            return voices.stream()
                    .filter(v -> v.getLocale() != null)
                    .filter(v -> v.getLocale().getLanguage().equals(locale.getLanguage()))
                    .filter(v -> locale.getCountry().isEmpty() || v.getLocale().getCountry().equalsIgnoreCase(locale.getCountry()))
                    .max(Comparator
                            .comparingInt((Voice v) -> v.isNetworkConnectionRequired() ? 0 : 1)
                            .thenComparingInt(Voice::getQuality))
                    .orElse(null);
        } catch (Exception ignored) {
            return null;
        }
    }

    private void speakText(String text, String localeTag, float rate) {
        runOnUiThread(() -> {
            if (!ttsReady || tts == null || text == null || text.trim().isEmpty()) return;
            Locale locale = Locale.forLanguageTag(localeTag == null || localeTag.isEmpty() ? "en-US" : localeTag);
            tts.setLanguage(locale);
            Voice best = findBestVoice(locale);
            if (best != null) tts.setVoice(best);
            tts.setPitch(1.0f);
            tts.setSpeechRate(Math.max(0.55f, Math.min(rate, 1.25f)));
            tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "vocab_" + System.nanoTime());
        });
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);

        if (requestCode == FILE_CHOOSER_REQUEST) {
            Uri[] result = null;
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                result = new Uri[]{data.getData()};
            }
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(result);
                filePathCallback = null;
            }
            return;
        }

        if (requestCode == EXCEL_CHOOSER_REQUEST && resultCode == RESULT_OK && data != null && data.getData() != null) {
            Uri uri = data.getData();
            new Thread(() -> {
                try {
                    String json = readXlsx(uri);
                    runOnUiThread(() -> webView.evaluateJavascript(
                            "window.onExcelImportedFromJson(" + JSONObject.quote(json) + ");", null));
                } catch (Exception e) {
                    toast("فایل Excel خوانده نشد: " + e.getMessage());
                }
            }).start();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (tts != null) {
            tts.stop();
            tts.shutdown();
        }
        if (webView != null) webView.destroy();
        super.onDestroy();
    }

    private String loadCompressedSeed() throws Exception {
        try (InputStream asset = getAssets().open("lesson10-seed.b64")) {
            ByteArrayOutputStream b64Bytes = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int n;
            while ((n = asset.read(buffer)) > 0) b64Bytes.write(buffer, 0, n);
            byte[] compressed = Base64.decode(b64Bytes.toString("UTF-8").trim(), Base64.DEFAULT);
            try (GZIPInputStream gzip = new GZIPInputStream(new java.io.ByteArrayInputStream(compressed));
                 ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                while ((n = gzip.read(buffer)) > 0) out.write(buffer, 0, n);
                return out.toString("UTF-8");
            }
        }
    }

    private OutputStream openDownload(String fileName, String mimeType) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
            values.put(MediaStore.Downloads.MIME_TYPE, mimeType);
            values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/VocabFlashcards");
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
            if (uri == null) throw new Exception("Cannot create download");
            OutputStream out = getContentResolver().openOutputStream(uri);
            if (out == null) throw new Exception("Cannot open download");
            return out;
        } else {
            File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "VocabFlashcards");
            if (!dir.exists() && !dir.mkdirs()) throw new Exception("Cannot create folder");
            return new FileOutputStream(new File(dir, fileName));
        }
    }

    private void saveText(String fileName, String content, String mimeType) {
        new Thread(() -> {
            try (OutputStream out = openDownload(fileName, mimeType)) {
                out.write(content.getBytes(StandardCharsets.UTF_8));
                out.flush();
                toast("فایل در Downloads/VocabFlashcards ذخیره شد");
            } catch (Exception e) {
                toast("ذخیره فایل ناموفق بود");
            }
        }).start();
    }

    private void saveBytes(String fileName, byte[] content, String mimeType) throws Exception {
        try (OutputStream out = openDownload(fileName, mimeType)) {
            out.write(content);
            out.flush();
        }
    }

    private File copyUriToTemp(Uri uri) throws Exception {
        File temp = File.createTempFile("import_", ".xlsx", getCacheDir());
        try (InputStream in = getContentResolver().openInputStream(uri);
             OutputStream out = new FileOutputStream(temp)) {
            if (in == null) throw new Exception("Cannot open file");
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        }
        return temp;
    }

    private List<String> readSharedStrings(ZipFile zip) throws Exception {
        List<String> strings = new ArrayList<>();
        ZipEntry entry = zip.getEntry("xl/sharedStrings.xml");
        if (entry == null) return strings;
        try (InputStream in = zip.getInputStream(entry)) {
            XmlPullParser p = Xml.newPullParser();
            p.setInput(in, "UTF-8");
            boolean inSi = false;
            boolean inT = false;
            StringBuilder sb = new StringBuilder();
            int event;
            while ((event = p.next()) != XmlPullParser.END_DOCUMENT) {
                if (event == XmlPullParser.START_TAG) {
                    if ("si".equals(p.getName())) {
                        inSi = true;
                        sb.setLength(0);
                    } else if (inSi && "t".equals(p.getName())) {
                        inT = true;
                    }
                } else if (event == XmlPullParser.TEXT && inSi && inT) {
                    sb.append(p.getText());
                } else if (event == XmlPullParser.END_TAG) {
                    if ("t".equals(p.getName())) inT = false;
                    else if ("si".equals(p.getName())) {
                        strings.add(sb.toString());
                        inSi = false;
                    }
                }
            }
        }
        return strings;
    }

    private int columnIndex(String ref) {
        if (ref == null || ref.isEmpty()) return -1;
        int col = 0;
        int i = 0;
        while (i < ref.length() && Character.isLetter(ref.charAt(i))) {
            col = col * 26 + (Character.toUpperCase(ref.charAt(i)) - 'A' + 1);
            i++;
        }
        return col - 1;
    }

    private String firstWorksheetPath(ZipFile zip) {
        if (zip.getEntry("xl/worksheets/sheet1.xml") != null) return "xl/worksheets/sheet1.xml";
        return zip.stream()
                .map(ZipEntry::getName)
                .filter(n -> n.startsWith("xl/worksheets/sheet") && n.endsWith(".xml"))
                .sorted()
                .findFirst()
                .orElse(null);
    }

    private List<List<String>> readSheetRows(ZipFile zip, List<String> shared) throws Exception {
        List<List<String>> rows = new ArrayList<>();
        String sheetPath = firstWorksheetPath(zip);
        if (sheetPath == null) throw new Exception("No worksheet found");

        try (InputStream in = zip.getInputStream(zip.getEntry(sheetPath))) {
            XmlPullParser p = Xml.newPullParser();
            p.setInput(in, "UTF-8");

            Map<Integer, String> currentRow = null;
            int currentCol = -1;
            String cellType = "";
            StringBuilder value = new StringBuilder();
            boolean captureV = false;
            boolean captureT = false;

            int event;
            while ((event = p.next()) != XmlPullParser.END_DOCUMENT) {
                String name = p.getName();
                if (event == XmlPullParser.START_TAG) {
                    if ("row".equals(name)) {
                        currentRow = new HashMap<>();
                    } else if ("c".equals(name)) {
                        currentCol = columnIndex(p.getAttributeValue(null, "r"));
                        cellType = p.getAttributeValue(null, "t");
                        if (cellType == null) cellType = "";
                        value.setLength(0);
                    } else if ("v".equals(name)) {
                        captureV = true;
                    } else if ("t".equals(name)) {
                        captureT = true;
                    }
                } else if (event == XmlPullParser.TEXT) {
                    if (captureV || captureT) value.append(p.getText());
                } else if (event == XmlPullParser.END_TAG) {
                    if ("v".equals(name)) captureV = false;
                    else if ("t".equals(name)) captureT = false;
                    else if ("c".equals(name) && currentRow != null && currentCol >= 0) {
                        String v = value.toString();
                        if ("s".equals(cellType) && !v.isEmpty()) {
                            try {
                                int idx = Integer.parseInt(v);
                                v = idx >= 0 && idx < shared.size() ? shared.get(idx) : "";
                            } catch (Exception ignored) {}
                        }
                        currentRow.put(currentCol, v);
                    } else if ("row".equals(name) && currentRow != null) {
                        int max = currentRow.keySet().stream().mapToInt(Integer::intValue).max().orElse(-1);
                        List<String> row = new ArrayList<>();
                        for (int i = 0; i <= max; i++) row.add(currentRow.getOrDefault(i, ""));
                        rows.add(row);
                        currentRow = null;
                    }
                }
            }
        }
        return rows;
    }

    private String readXlsx(Uri uri) throws Exception {
        File temp = copyUriToTemp(uri);
        try (ZipFile zip = new ZipFile(temp)) {
            List<String> shared = readSharedStrings(zip);
            List<List<String>> rows = readSheetRows(zip, shared);
            if (rows.isEmpty()) return "[]";

            List<String> headers = rows.get(0);
            JSONArray out = new JSONArray();
            for (int r = 1; r < rows.size(); r++) {
                List<String> row = rows.get(r);
                JSONObject obj = new JSONObject();
                boolean any = false;
                for (int c = 0; c < headers.size(); c++) {
                    String key = headers.get(c).trim();
                    if (key.isEmpty()) continue;
                    String val = c < row.size() ? row.get(c).trim() : "";
                    if (!val.isEmpty()) any = true;
                    obj.put(key, val);
                }
                if (any) out.put(obj);
            }
            return out.toString();
        } finally {
            //noinspection ResultOfMethodCallIgnored
            temp.delete();
        }
    }

    private String xmlEscape(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&apos;");
    }

    private String colName(int idx) {
        StringBuilder s = new StringBuilder();
        int n = idx + 1;
        while (n > 0) {
            int r = (n - 1) % 26;
            s.insert(0, (char) ('A' + r));
            n = (n - 1) / 26;
        }
        return s.toString();
    }

    private void addInlineCell(StringBuilder sb, int col, int row, String value) {
        sb.append("<c r=\"").append(colName(col)).append(row).append("\" t=\"inlineStr\"><is><t xml:space=\"preserve\">")
                .append(xmlEscape(value))
                .append("</t></is></c>");
    }

    private byte[] buildXlsx(JSONArray rows) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        try (ZipOutputStream zip = new ZipOutputStream(bytes)) {
            putZip(zip, "[Content_Types].xml",
                    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                    "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">" +
                    "<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>" +
                    "<Default Extension=\"xml\" ContentType=\"application/xml\"/>" +
                    "<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>" +
                    "<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>" +
                    "</Types>");

            putZip(zip, "_rels/.rels",
                    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                    "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>" +
                    "</Relationships>");

            putZip(zip, "xl/workbook.xml",
                    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                    "<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">" +
                    "<sheets><sheet name=\"Vocabulary\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>");

            putZip(zip, "xl/_rels/workbook.xml.rels",
                    "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>" +
                    "<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">" +
                    "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>" +
                    "</Relationships>");

            StringBuilder sheet = new StringBuilder();
            sheet.append("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>")
                    .append("<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>");

            sheet.append("<row r=\"1\">");
            for (int c = 0; c < XLSX_HEADERS.length; c++) addInlineCell(sheet, c, 1, XLSX_HEADERS[c]);
            sheet.append("</row>");

            for (int i = 0; i < rows.length(); i++) {
                JSONObject rowObj = rows.optJSONObject(i);
                if (rowObj == null) continue;
                int rowNum = i + 2;
                sheet.append("<row r=\"").append(rowNum).append("\">");
                for (int c = 0; c < XLSX_HEADERS.length; c++) {
                    addInlineCell(sheet, c, rowNum, rowObj.optString(XLSX_HEADERS[c], ""));
                }
                sheet.append("</row>");
            }
            sheet.append("</sheetData></worksheet>");
            putZip(zip, "xl/worksheets/sheet1.xml", sheet.toString());
        }
        return bytes.toByteArray();
    }

    private void putZip(ZipOutputStream zip, String path, String content) throws Exception {
        ZipEntry e = new ZipEntry(path);
        zip.putNextEntry(e);
        zip.write(content.getBytes(StandardCharsets.UTF_8));
        zip.closeEntry();
    }

    public class AndroidBridge {
        @JavascriptInterface
        public String getSeedData() {
            try {
                return loadCompressedSeed();
            } catch (Exception e) {
                return "{\"version\":0,\"cards\":[]}";
            }
        }

        @JavascriptInterface
        public void speak(String text, String localeTag, double rate) {
            speakText(text, localeTag, (float) rate);
        }

        @JavascriptInterface
        public void openTtsSettings() {
            runOnUiThread(() -> {
                try {
                    startActivity(new Intent("com.android.settings.TTS_SETTINGS"));
                } catch (Exception e) {
                    toast("تنظیمات موتور گفتار در این گوشی پیدا نشد");
                }
            });
        }

        @JavascriptInterface
        public void saveFile(String fileName, String content, String mimeType) {
            saveText(fileName, content, mimeType == null ? "text/plain" : mimeType);
        }

        @JavascriptInterface
        public void pickExcel() {
            runOnUiThread(() -> {
                Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
                String[] mimes = {
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        "application/vnd.ms-excel",
                        "application/octet-stream"
                };
                intent.putExtra(Intent.EXTRA_MIME_TYPES, mimes);
                startActivityForResult(intent, EXCEL_CHOOSER_REQUEST);
            });
        }

        @JavascriptInterface
        public void exportXlsx(String rowsJson, String fileName) {
            new Thread(() -> {
                try {
                    JSONArray rows = new JSONArray(rowsJson == null || rowsJson.isEmpty() ? "[]" : rowsJson);
                    byte[] bytes = buildXlsx(rows);
                    String name = (fileName == null || fileName.trim().isEmpty()) ? "vocabulary.xlsx" : fileName;
                    saveBytes(name, bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
                    toast("فایل Excel در Downloads/VocabFlashcards ذخیره شد");
                } catch (Exception e) {
                    toast("ساخت فایل Excel ناموفق بود: " + e.getMessage());
                }
            }).start();
        }
    }
}
