# Faz 3 / Faz 4 — Detaylı Plan (henüz uygulanmadı)

Faz 1 (script temizliği + klasör düzeni) ve Faz 2 (Credential Provider + standart yetenek
matrisi + worker modülleri) tamamlandı. Bu doküman, sonraki turlarda uygulanacak Faz 3 ve
Faz 4'ün ayrıntılı yol haritasıdır. Tek tenant / tek mağaza varsayımı Faz 3 boyunca korunur;
çok-tenant Faz 4'te gelir.

## Faz 2'de teslim edilen temel (özet)

- `lib/channels/credentials.js` — `getChannelCredentials({ channel, branchId })` tek okuma katmanı.
- `lib/channels/capabilities.js` — kanal yetenek matrisi (tek doğruluk kaynağı), registry'den re-export.
- `lib/ops-hub/workers/` — `poll-worker.js`, `daily-sync.js`, `order-lines-enrich-worker.js`,
  `portal-sync-worker.js` (YS portal CDP + ingest)

Faz 3/4 bu üç yapı taşının üstüne kurulur ve imzaları korur.

---

## Faz 3 — Panel kontrol ekranı + tek yazma yolu + süreç modeli

### 3a. Birleşik "Kanal Ayarları" ekranı
Her kanal için tek ekranda:
- Bağlantı durumu (configured / ok) — `getChannelsHealth()` çıktısından.
- Yetenek rozetleri ve boşluklar — `capabilities.js` matrisinden (`capabilityGaps`).
- Son senkron zamanı, son hata, kayıt sayıları — Ops Hub sync raporları + worker çıktıları.
- "Şimdi Senkronize Et" butonları (sipariş / katalog / stok / fiyat) — worker fonksiyonlarını çağırır.
- Webhook durumu ve URL'leri; API yetki doğrulama (`healthCheck({ probe/live: true })`).
- Kimlik bilgisi girişi (maskeli) — tek yazma API'sine bağlanır (3b).

İlgili mevcut görünümler birleştirilecek:
- `/admin/settings` ([lib/platform/views/pages-platform.js](../lib/platform/views/pages-platform.js))
- `/hzlmrktops/integrations` ([lib/ops-hub/views/integrations-page.js](../lib/ops-hub/views/integrations-page.js))

### 3b. Tek yazma yolu (single write path)
Bugün kimlik bilgisi iki UI'dan yazılabiliyor (platform env + Ops Hub DB config). Faz 3'te:
- Tek bir yazma servisi: `saveChannelCredentials({ channel, branchId, values })`.
- Bu servis hem platform env (`persistPlatformConfigUpdates`) hem Ops Hub
  `ops_branch_channel_config` güncellemesini tek noktadan, tutarlı sırayla yapar.
- `getChannelCredentials` okuma tarafıyla simetri: okuma tek yerden, yazma tek yerden.
- Doğrulama: yazımdan sonra otomatik `healthCheck` ile bağlantı testi tetiklenir.

### 3c. Kalıcı worker/cron süreç modeli
- Faz 2 worker'larını tek bir scheduler altında topla (mevcut
  [matching-sync.js](../lib/platform/services/matching-sync.js) in-process interval deseniyle hizalı):
  - Sipariş poll: 1–2 dk (`runOpsPoll`).
  - Stok/fiyat kuyruğu: 5–10 dk.
  - Gün sonu mutabakat: günde 1 (`runDailySync`).
- "Panelden başlat / otomatik interval" tek mekanizmadan yönetilir; durum panelde görünür.
- Production'da systemd/launchd yerine (veya yanında) in-process scheduler net olarak belgelenir.

---

## Faz 4 — Şifreli DB credential göçü + çok-tenant/RBAC

### 4a. Şifreli credential saklama
- `ENCRYPTION_KEY` ile kimlik bilgileri Ops Hub DB'de şifreli saklanır (env yerine).
- `getChannelCredentials` imzası korunur; yalnızca arka uç değişir (env → şifreli DB).
- Göç: mevcut env/`runtime-secrets.env` değerlerini şifreli DB'ye taşıyan tek seferlik migration.

### 4b. Çok-tenant / çok-şube
- `tenant_id` + şube seçici; `branchId` parametresi zorunlu hale gelir (bugün opsiyonel/`main`).
- RBAC: kullanıcı → tenant/şube yetkileri; panel ve API yetkilendirmesi.
- `ops_branches` / `ops_branch_channel_config` şeması zaten çok-şubeye hazır; resolver
  (`branch-config-resolver.js`) tenant kapsamıyla genişletilir.

### 4c. Geriye dönük uyumluluk
- Faz 2/3 API imzaları (`getChannelCredentials`, `saveChannelCredentials`, capability matrisi)
  Faz 4'te de aynı kalır; tüketiciler (adapter/worker/panel) değişmez.

---

## Riskler ve sıra
- 3b (tek yazma yolu) 3a'dan (panel) önce gelmeli — UI tek servise bağlanmalı.
- 4a (şifreleme) 4b'den (tenant) önce gelmeli — credential modeli stabilize olmalı.
- Her adımda tam test suite yeşil kalmalı; her kanal için yazım sonrası `healthCheck` doğrulaması.
