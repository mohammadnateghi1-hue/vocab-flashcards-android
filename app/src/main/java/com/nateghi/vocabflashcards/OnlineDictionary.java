package com.nateghi.vocabflashcards;

import android.app.Activity;
import android.net.Uri;
import android.text.Html;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Online lookup, intentionally independent of the user's local flashcard data.
 * Only the explicitly searched term is sent to dictionary / frequency / media providers.
 */
public final class OnlineDictionary {
    private static final int CONNECT_TIMEOUT = 7000;
    private static final int READ_TIMEOUT = 11000;
    private static final int MAX_SENSES = 24;

    private OnlineDictionary() {}

    public static void lookup(Activity activity, WebView webView, String rawWord, String requestId) {
        final String word = rawWord == null ? "" : rawWord.trim();
        if (word.isEmpty() || word.length() > 90 || !word.matches("[\\p{IsLatin}0-9'’ -]+")) {
            post(activity, webView, msg(requestId, "dictionary", "لطفاً یک واژه یا عبارت انگلیسی معتبر وارد کن."));
            return;
        }
        new Thread(() -> loadDictionary(activity, webView, word, requestId), "online-dictionary").start();
        new Thread(() -> loadFrequency(activity, webView, word, requestId), "online-frequency").start();
        new Thread(() -> loadImage(activity, webView, word, requestId), "online-image").start();
    }

    private static String enc(String s) throws Exception {
        return URLEncoder.encode(s, "UTF-8");
    }

    private static String get(String urlString) throws Exception {
        URL url = new URL(urlString);
        if (!"https".equalsIgnoreCase(url.getProtocol())) throw new Exception("Only HTTPS requests allowed");
        HttpURLConnection c = (HttpURLConnection) url.openConnection();
        c.setConnectTimeout(CONNECT_TIMEOUT);
        c.setReadTimeout(READ_TIMEOUT);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", "VocabFlashcards/4.0 (personal language-learning Android app)");
        c.setRequestProperty("Accept", "application/json");
        try {
            int status = c.getResponseCode();
            if (status < 200 || status >= 300) throw new Exception("HTTP " + status);
            try (InputStream in = c.getInputStream(); BufferedReader br = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                StringBuilder sb = new StringBuilder();
                String line;
                while ((line = br.readLine()) != null) {
                    sb.append(line);
                    if (sb.length() > 1000000) throw new Exception("Response too large");
                }
                return sb.toString();
            }
        } finally { c.disconnect(); }
    }

    private static JSONObject msg(String id, String type, String error) {
        JSONObject j = new JSONObject();
        try { j.put("requestId", id).put("type", type).put("error", error); } catch (Exception ignored) {}
        return j;
    }

    private static JSONObject base(String id, String type) {
        JSONObject j = new JSONObject();
        try { j.put("requestId", id).put("type", type); } catch (Exception ignored) {}
        return j;
    }

    private static void post(Activity activity, WebView webView, JSONObject result) {
        String quoted = JSONObject.quote(result.toString());
        activity.runOnUiThread(() -> {
            try { webView.evaluateJavascript("window.onOnlineLookupResult(" + quoted + ");", null); }
            catch (Exception ignored) {}
        });
    }

    private static String htmlText(String s) {
        if (s == null) return "";
        return Html.fromHtml(s, Html.FROM_HTML_MODE_LEGACY).toString()
                .replaceAll("\\s+", " ").trim();
    }

    private static void loadDictionary(Activity activity, WebView view, String word, String requestId) {
        try {
            JSONObject result = base(requestId, "dictionary");
            JSONArray senses = new JSONArray();
            String ipa = "";
            String source = "Free Dictionary API";
            String sourceUrl = "https://dictionaryapi.dev/";
            try {
                JSONArray entries = new JSONArray(get("https://api.dictionaryapi.dev/api/v2/entries/en/" + enc(word)));
                Set<String> seen = new HashSet<>();
                for (int i = 0; i < entries.length() && senses.length() < MAX_SENSES; i++) {
                    JSONObject entry = entries.optJSONObject(i);
                    if (entry == null) continue;
                    if (ipa.isEmpty()) ipa = entry.optString("phonetic", "");
                    JSONArray phonetics = entry.optJSONArray("phonetics");
                    if (ipa.isEmpty() && phonetics != null) {
                        for (int p = 0; p < phonetics.length(); p++) {
                            JSONObject ph = phonetics.optJSONObject(p);
                            if (ph != null && !ph.optString("text", "").isEmpty()) {
                                ipa = ph.optString("text", "");
                                break;
                            }
                        }
                    }
                    JSONArray meanings = entry.optJSONArray("meanings");
                    if (meanings == null) continue;
                    for (int j = 0; j < meanings.length() && senses.length() < MAX_SENSES; j++) {
                        JSONObject meaning = meanings.optJSONObject(j);
                        if (meaning == null) continue;
                        String pos = meaning.optString("partOfSpeech", "");
                        JSONArray definitions = meaning.optJSONArray("definitions");
                        if (definitions == null) continue;
                        for (int k = 0; k < definitions.length() && senses.length() < MAX_SENSES; k++) {
                            JSONObject def = definitions.optJSONObject(k);
                            if (def == null) continue;
                            String d = def.optString("definition", "").trim();
                            if (d.isEmpty()) continue;
                            String lower = d.toLowerCase(Locale.ROOT);
                            if (lower.startsWith("(obsolete)") || lower.startsWith("(archaic)") ||
                                lower.startsWith("(rare)") || lower.startsWith("(dated)")) continue;
                            if (!seen.add(pos.toLowerCase(Locale.ROOT) + "|" + lower)) continue;
                            JSONObject item = new JSONObject();
                            item.put("pos", pos);
                            item.put("definition", d);
                            item.put("example", def.optString("example", ""));
                            item.put("meaningFa", "");
                            item.put("exampleFa", "");
                            senses.put(item);
                        }
                    }
                }
                if (entries.length() > 0) {
                    JSONObject first = entries.optJSONObject(0);
                    if (first != null) {
                        JSONArray sourceUrls = first.optJSONArray("sourceUrls");
                        if (sourceUrls != null && sourceUrls.length() > 0) sourceUrl = sourceUrls.optString(0, sourceUrl);
                    }
                }
            } catch (Exception primaryError) {
                // Wiktionary's English definitions are the secondary online source,
                // including phrases for which Free Dictionary may not have an entry.
                JSONObject response = new JSONObject(get("https://en.wiktionary.org/api/rest_v1/page/definition/" + enc(word)));
                JSONArray sections = response.optJSONArray("en");
                if (sections != null) {
                    Set<String> seen = new HashSet<>();
                    for (int i = 0; i < sections.length() && senses.length() < MAX_SENSES; i++) {
                        JSONObject part = sections.optJSONObject(i);
                        if (part == null) continue;
                        String pos = part.optString("partOfSpeech", "");
                        JSONArray defs = part.optJSONArray("definitions");
                        if (defs == null) continue;
                        for (int j = 0; j < defs.length() && senses.length() < MAX_SENSES; j++) {
                            JSONObject d = defs.optJSONObject(j);
                            if (d == null) continue;
                            String definition = htmlText(d.optString("definition", ""));
                            if (definition.isEmpty() || !seen.add(pos+"|"+definition)) continue;
                            String example = "";
                            JSONArray examples = d.optJSONArray("examples");
                            if (examples != null && examples.length() > 0) example = htmlText(examples.optString(0,""));
                            JSONObject sense = new JSONObject();
                            sense.put("pos", pos);
                            sense.put("definition", definition);
                            sense.put("example", example);
                            sense.put("meaningFa", "");
                            sense.put("exampleFa", "");
                            senses.put(sense);
                        }
                    }
                }
                source = "Wiktionary";
                sourceUrl = "https://en.wiktionary.org/wiki/" + enc(word);
            }
            if (senses.length() == 0) {
                post(activity, view, msg(requestId, "dictionary", "برای این واژه در منابع آنلاین معنی قابل نمایش پیدا نشد."));
                return;
            }
            result.put("word", word);
            result.put("ipa", ipa);
            result.put("senses", senses);
            result.put("source", source);
            result.put("sourceUrl", sourceUrl);
            result.put("limited", senses.length() >= MAX_SENSES);
            post(activity, view, result);

            // Progressive translations: preserve the complete English originals even
            // when a free translation service is unavailable or reaches its quota.
            for (int i = 0; i < senses.length(); i++) {
                JSONObject s = senses.optJSONObject(i);
                if (s == null) continue;
                String fa = translate(s.optString("definition", ""));
                String exFa = s.optString("example", "").isEmpty() ? "" : translate(s.optString("example", ""));
                if (!fa.isEmpty() || !exFa.isEmpty()) {
                    JSONObject patch = base(requestId, "translation");
                    patch.put("index", i);
                    patch.put("meaningFa", fa);
                    patch.put("exampleFa", exFa);
                    post(activity, view, patch);
                }
            }
        } catch (Exception e) {
            post(activity, view, msg(requestId, "dictionary", "فرهنگ لغت آنلاین در دسترس نیست. اتصال اینترنت را بررسی کن یا دوباره تلاش کن."));
        }
    }

    private static String translate(String english) {
        if (english == null || english.isEmpty()) return "";
        try {
            // MyMemory API has a 500-byte per-request cap. Keep the English intact if too long.
            if (english.getBytes(StandardCharsets.UTF_8).length > 450) return "";
            String api = "https://api.mymemory.translated.net/get?q=" + enc(english) + "&langpair=en%7Cfa";
            JSONObject r = new JSONObject(get(api));
            if (r.optInt("responseStatus", 200) != 200) return "";
            JSONObject data = r.optJSONObject("responseData");
            if (data == null) return "";
            String result = htmlText(data.optString("translatedText", ""));
            if (result.isEmpty() || result.equalsIgnoreCase(english) ||
                result.toLowerCase(Locale.ROOT).contains("quota exceeded")) return "";
            return result;
        } catch (Exception ignored) {return "";}
    }

    private static void loadFrequency(Activity activity, WebView view, String word, String requestId) {
        try {
            String url="https://books.google.com/ngrams/json?content="+enc(word)+
                    "&year_start=1950&year_end=2019&corpus=26&smoothing=0";
            JSONArray data = new JSONArray(get(url));
            JSONArray points = new JSONArray();
            if (data.length() > 0) {
                JSONObject entry=data.optJSONObject(0);
                if (entry != null) {
                    JSONArray series=entry.optJSONArray("timeseries");
                    if(series!=null){
                        for(int i=0;i<series.length();i++){
                            JSONObject point=new JSONObject();
                            point.put("year",1950+i);
                            point.put("percent",series.optDouble(i,0)*100);
                            points.put(point);
                        }
                    }
                }
            }
            if(points.length()==0){
                post(activity,view,msg(requestId,"frequency","داده تاریخی برای این عبارت پیدا نشد."));
                return;
            }
            JSONObject j=base(requestId,"frequency");
            j.put("points",points);
            j.put("source","Google Books Ngram — English 2019 corpus");
            j.put("sourceUrl","https://books.google.com/ngrams/graph?content="+enc(word)+"&year_start=1950&year_end=2019&corpus=26&smoothing=0");
            post(activity,view,j);
        }catch(Exception e){
            post(activity,view,msg(requestId,"frequency","سرویس روند تاریخی در دسترس نیست؛ می‌توانی نمودار گوگل را در مرورگر ببینی."));
        }
    }

    private static void loadImage(Activity activity, WebView view, String word, String requestId) {
        try {
            String url="https://commons.wikimedia.org/w/api.php?action=query&format=json"+
                "&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch="+enc(word+" filetype:bitmap")+
                "&prop=imageinfo&iiprop=url%7Cextmetadata&iiurlwidth=560"+
                "&iiextmetadatafilter=LicenseShortName%7CArtist";
            JSONObject json=new JSONObject(get(url));
            JSONObject pages=json.optJSONObject("query");
            if(pages==null)throw new Exception("no images");
            pages=pages.optJSONObject("pages");
            if(pages==null)throw new Exception("no pages");
            JSONArray results=new JSONArray();
            Iterator<String> it=pages.keys();
            while(it.hasNext()){
                JSONObject p=pages.optJSONObject(it.next());
                if(p==null)continue;
                String title=p.optString("title","");
                String lower=title.toLowerCase(Locale.ROOT);
                if(!(lower.endsWith(".jpg")||lower.endsWith(".jpeg")||
                     lower.endsWith(".png")||lower.endsWith(".webp")))continue;
                JSONArray infos=p.optJSONArray("imageinfo");
                if(infos==null||infos.length()==0)continue;
                JSONObject info=infos.optJSONObject(0);
                if(info==null)continue;
                String thumb=info.optString("thumburl", "");
                if(!thumb.startsWith("https://upload.wikimedia.org/"))continue;
                JSONObject img=new JSONObject();
                img.put("url",thumb);
                img.put("title",title);
                img.put("sourceUrl",info.optString("descriptionurl", ""));
                JSONObject meta=info.optJSONObject("extmetadata");
                if(meta!=null){
                    JSONObject lic=meta.optJSONObject("LicenseShortName");
                    if(lic!=null)img.put("license",htmlText(lic.optString("value","")));
                }
                results.put(img);
                if(results.length()>=4)break;
            }
            JSONObject out=base(requestId,"image");
            out.put("images",results);
            post(activity,view,out);
        }catch(Exception e){
            post(activity,view,msg(requestId,"image","تصویر مناسب از Wikimedia Commons پیدا نشد."));
        }
    }
}
