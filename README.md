# KPSS Maratonu - Web Sitesi

Güvenlik düzeltmeleri yapılmış, tek dosyalık HTML/JS KPSS bilgi oyunu ve yönetici paneli.

## 📁 Dosya yapısı

| Dosya | Açıklama |
|-------|----------|
| `index.html` | Sitenin tam kodu (oyun + yönetici paneli) |
| `questions.js` | 500 soruluk soru havuzu (4 bölüm × 125) |
| `deploy_backup/worker.js` | Cloudflare Workers API (sunucu tarafı veritabanı ve şifre kontrolü) |
| `deploy_backup/manifest.json` | Cloudflare Workers manifest dosyası |

## 🔒 Güvenlik düzeltmeleri

Bu sürümde şu güvenlik açıkları kapatılmıştır:

1. **Yönetici şifresi koddan çıkarıldı** — `DEFAULT_ADMIN_PASS` artık boş dize. Şifre sadece Cloudflare Workers ortam değişkeni (`ADMIN_PASSWORD`) üzerinden ayarlanır.
2. **XSS (kayıtlı kod enjeksiyonu) önlendi** — Kullanıcı girdileri (isim, şube, tarih, zayıf konular) `escapeHtml()` ile HTML karakterlerinden kaçırılıyor.
3. **CORS kısıtlandı** — API sadece `site-755558ac1aeb46a082b6be91f83dd59e.freebuff.page` adresinden istek kabul ediyor.
4. **Güvenlik başlıkları eklendi** — CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy.
5. **Hata stack trace'i gizlendi** — Sunucu hatalarında iç hata ayıklama bilgileri dışarı çıkarılamıyor.
6. **Şifre uzunluğu arttırıldı** — Yönetici şifresi minimum 12 karakter olmalı.
7. **Rate limitleri sıkılaştırıldı** — API istek sınırları daraltıldı.
8. **`LINK.txt` silindi** — İçinde yönetici şifresi düz metin olarak yazılıydı.

## ⚠️ Canlıya alma (Önemli)

GitHub'a yükledikten sonra siteyi canlı hale getirmek için şunları yapmalısınız:

### 1. Cloudflare Workers yapılandırması
- Cloudflare Dashboard → Workers & Pages → projeniz → **Settings** → **Variables** → **Environment Variables**
- `ADMIN_PASSWORD` değişkenini ekleyin ve **kendinize özel güçlü bir şifre** girin.
- **Deploy** düğmesine basın.

> ⚠️ Bu adımı yapmazsanız şifre boş kalır ve herkes yönetici paneline girebilir.

### 2. `worker.js` dağıtımı
`deploy_backup/worker.js` dosyasını Cloudflare Workers dashboard üzerinden deploy edin veya `wrangler` CLI kullanın.

### 3. `index.html` ve `questions.js`
Bu dosyaları herhangi bir statik barındırma servisine (GitHub Pages, Netlify, Vercel, Cloudflare Pages vb.) yükleyebilirsiniz.

## 🚀 GitHub'a yükleme

```bash
# 1. Git'i kur (yoksa)
winget install Git.Git

# 2. Klasöre gir
cd "C:\Users\ACER\Desktop\KPSS_Site_Dosyalari"

# 3. Git başlat
git init

# 4. Dosyaları ekle
git add .

# 5. İlk commit
git commit -m "Güvenlik düzeltmeleriyle KPSS Maratonu sitesi"

# 6. GitHub'da yeni (private) repository oluşturun, ardından:
git remote add origin https://github.com/KULLANICI_ADINIZ/REPO_ADI.git
git branch -M main
git push -u origin main
```

> **Repository'yi `private` (özel) olarak ayarlamanız önerilir.** Kod içinde proje mantığı ve yapılandırma bilgileri var.

## 🛡️ Geliştirici notları

- `index.html` tek dosyalık bir 싱글 HTML dosyasıdır; tüm CSS ve JS içinde yer alır.
- `questions.js` içinde `QUESTION_BANK` değişkeni olarak 500 soru saklanır.
- Yönetici paneli: sayfa en altındaki "🔒 Yönetici Girişi", logoya 5 kez tıklama veya `Ctrl+Shift+A` ile açılır.
- Cloudflare D1 veritabanı kullanılır (`worker.js` üzerinden).

## 📄 Lisans

Bu proje kişisel kullanım içindir.
