# BuyBox Platform

Profesyonel BuyBox + kârlılık takip paneli. Trendyol siparişleri, ürün maliyetleri ve canlı BuyBox verisini tek yerden yönetir.

## Özellikler

- **BuyBox dashboard** — karlı / zarar / eksik veri sekmeleri, canlı güncelleme
- **Ürün ayarları** — maliyet, desi, komisyon (satır içi düzenleme)
- **Sipariş kârlılık analizi** — tarih aralığı, grafik, CSV export
- **Zarar sipariş e-postası** — Gmail SMTP ile otomatik bildirim
- **Canlı worker** — Trendyol BuyBox API polling (`live-buybox-worker`)

## Hızlı başlangıç

```bash
# macOS: start-buybox-platform.command çift tık
# veya terminal:
cd buybox-platform
node server.js
```

Tarayıcı: [http://localhost:8787](http://localhost:8787)

| Sayfa | URL |
|-------|-----|
| BuyBox & kârlılık | `/` |
| Sipariş analizi | `/siparisler` |
| Ürün ayarları | `/urunler` |
| Giriş (opsiyonel) | `/login` |

## Proje yapısı

```
buybox-platform/
├── server.js                 # HTTP sunucu, API, HTML şablonları
├── .env                      # Platform gizli ayarları (git'e eklenmez)
├── data/db.json              # Yerel veritabanı
├── lib/
│   ├── order-profitability.js   # Sipariş kâr hesabı (Trendyol)
│   ├── profit-constants.js      # Kargo / hizmet / KDV sabitleri
│   ├── product-catalog.js       # Ürün listesi & filtre
│   ├── snapshot-ingest.js       # BuyBox snapshot birleştirme
│   ├── loss-order-monitor.js    # Zarar sipariş e-posta taraması
│   ├── email-notify.js          # SMTP gönderimi
│   ├── data-quality.js          # Veri uyarıları
│   ├── env.js                   # .env okuma / maskeleme
│   ├── logger.js                # Yapılandırılmış log
│   ├── utils.js                 # Ortak yardımcılar
│   └── channels/index.js        # Çoklu kanal altyapısı (gelecek)
├── public/assets/            # Panel istemci kodu
└── scripts/                  # Import & bakım araçları

live-buybox-worker/           # Canlı BuyBox worker (kardeş klasör)
├── src/index.js
├── .env                        # Trendyol API bilgileri
└── buybox-cache.json
```

## Ortam değişkenleri

### buybox-platform/.env

| Değişken | Açıklama |
|----------|----------|
| `HOST` | Dinleme adresi (varsayılan `127.0.0.1`) |
| `PORT` | Port (varsayılan `8787`) |
| `PLATFORM_API_TOKEN` | Ayarlanırsa panel token ister |
| `SMTP_*` | Zarar sipariş e-postası (Gmail uygulama şifresi) |

Örnek: `.env.example` dosyasına bakın.

### live-buybox-worker/.env

| Değişken | Açıklama |
|----------|----------|
| `TRENDYOL_SELLER_ID` | Satıcı ID |
| `TRENDYOL_API_KEY` | API key |
| `TRENDYOL_API_SECRET` | API secret |
| `POLL_INTERVAL_MS` | Polling aralığı (min. 2000 ms) |
| `BATCH_SIZE` | Batch boyutu (max 10) |

Panelden **Canlı BuyBox Kurulumu** ile de kaydedilebilir.

## Canlı BuyBox kurulumu

1. Panel → Canlı BuyBox → Trendyol bilgilerini gir → **Kaydet**
2. **Canlıyı Başlat** (veya `start-live-buybox-worker.command`)
3. **Cache Senkron** ile worker çıktısını panele al

## Sipariş kârlılık & e-posta

`/siparisler` sayfasında:

- Tarih aralığı / durum / kâr filtresi
- **E-posta — Zarar Sipariş Bildirimi** kartı
- Gmail SMTP `.env` içinde tanımlı olmalı
- Aktif edildiğinde 5 dk'da bir zarar siparişler taranır

## Veri içe aktarma

```bash
python3 scripts/import-xlsx.py data/trendyol-export.xlsx
```

Snapshot bakımı:

```bash
npm run maintain:trim-snapshots
```

## Güvenlik

- Sunucu varsayılan olarak yalnızca `127.0.0.1`'de dinler
- `.env` dosyaları `.gitignore` içindedir — commit etmeyin
- API secret'lar panelde maskelenir; boş bırakılırsa mevcut değer korunur
- Webhook: `LIVE_BUYBOX_WEBHOOK_SECRET` + `X-Webhook-Secret` başlığı

## API hız sınırları (panel)

| İşlem | Bekleme |
|-------|---------|
| Cache senkron | 30 sn |
| Tek ürün canlı güncelle | 45 sn |
| Trendyol sipariş çekme | 60 sn (filtre değişimi cache kullanır; **Verileri Güncelle** zorlar) |

## Production mimarisi

```
server.js                    → ince giriş (startPlatform)
lib/platform/app.js          → HTTP router + servisler + view şablonları
lib/config.js                → yollar, limitler, runtime config
lib/db/json-store.js         → JSON veritabanı (SQLite planı: docs/SQLITE_MIGRATION.md)
lib/auth/index.js            → PLATFORM_API_TOKEN doğrulama
lib/buybox/history.js        → append-only BuyBox geçmişi (JSONL)
lib/channels/                → çok kanallı adapter altyapısı
ecosystem.config.cjs         → PM2 (platform + worker)
```

### PM2 ile çalıştırma

```bash
npm install -g pm2   # bir kez
mkdir -p logs
npm run start:pm2
pm2 status
pm2 logs buybox-platform
```

### Smoke test

```bash
node server.js &
npm run smoke
```

### PLATFORM_API_TOKEN

`.env` içine ekleyin:

```env
PLATFORM_API_TOKEN=uzun-rastgele-token
```

- Tüm `/api/*` rotaları Bearer token ister
- Ana sayfa (`/`) auth açıkken **veri gömmez** — istemci `/api/dashboard` ile çeker
- `/login` üzerinden giriş

### BuyBox history

- Dosya: `data/buybox-history.jsonl`
- API: `GET /api/buybox/history?barcode=...&limit=100`
- Cache senkron ve webhook ingest sırasında otomatik yazılır

### WooCommerce (aktif)

`lib/channels/woocommerce.js` — petfix.com.tr mağaza siparişleri, katalog eşleştirme ve kâr/zarar analizi. Ayarlar sayfasından veya `.env`:

```env
WOOCOMMERCE_URL=https://www.petfix.com.tr
WOOCOMMERCE_KEY=ck_...
WOOCOMMERCE_SECRET=cs_...
```

- Siparişler: `/woocommerce` — REST API read-only sync
- Eşleştirme: Ana Ürün Havuzu → WooCommerce — katalog `global_unique_id` (EAN) ile BenimPOS barkod eşleşmesi
- Kendi mağaza: pazaryeri komisyonu ve hizmet bedeli **0** kabul edilir

## Geliştirme

```bash
node --check server.js
# veya
npm run check
```

## Legacy (kullanılmıyor olabilir)

- Kök `src/*.gs`, `dist-apps-script/` — Google Apps Script dönemi
- `scripts/import-sheet-export.js` — eski JSON import
- Ürün sayfası Excel/XML import butonları — henüz bağlanmadı

## Gelecek kanallar

`lib/channels/index.js` WooCommerce (aktif), Yemeksepeti ve Getir için planlı kanal kaydı içerir. Kâr hesabı `order-profitability.js` modülünde kalır; yeni kanallar sipariş/ürün adaptörü ekleyerek bağlanır.
