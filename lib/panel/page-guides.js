/**
 * İşletme sahibi odaklı sayfa rehberleri — her ekranda ne yapılacağını açıklar.
 */
import { escapeHtml } from '../platform/views/format.js';

export const PAGE_GUIDES = {
  dashboard: {
    title: 'Bu sayfada ne yaparsınız?',
    purpose: 'Mağazanızın bugünkü özetini görürsünüz: hangi sipariş kanalları açık, dikkat gereken bir şey var mı.',
    safe: 'Sadece bilgi ekranıdır — burada hiçbir ayar değişmez.'
  },
  orders: {
    title: 'Bu sayfada ne yaparsınız?',
    purpose: 'Gelen siparişleri takip eder, detayına bakar ve gerekirse kasa işlemi yaparsınız.',
    safe: 'Sipariş iptali ve kasa satışı gibi kalıcı işlemler ayrı onay ister.'
  },
  products: {
    title: 'Bu sayfada ne yaparsınız?',
    purpose: 'BenimPOS ürünlerinizi kanallardaki menülerle eşleştirir, fiyat ve stok ayarlarsınız.',
    safe: 'Kanallara fiyat ve stok gönderimi yalnızca siz butona bastığınızda çalışır.'
  },
  integrations: {
    title: 'Bu sayfada ne yaparsınız?',
    purpose: 'Getir, Yemeksepeti ve Uber Eats bağlantılarını kurar ve durumlarını kontrol edersiniz.',
    safe: 'Kaydetmeden önce "Bağlantı testi" yapabilirsiniz. Eğitim modunda gerçek işlem yapılmaz.'
  },
  system: {
    title: 'Bu sayfada ne yaparsınız?',
    purpose: 'Arka planda sipariş çekme ve ürün güncelleme işlerinin düzgün çalışıp çalışmadığını izlersiniz.',
    safe: 'Bu sayfa salt okunurdur — ayar değiştirmek için Kanallar sayfasına gidin.'
  },
  reports: {
    title: 'Bu sayfada ne yaparsınız?',
    purpose: 'Seçtiğiniz dönemde ciro, sipariş sayısı, kanal dağılımı ve ürün performansını görürsünüz.',
    safe: 'Salt okunur özet ekranıdır — veriler canlı sipariş kayıtlarından hesaplanır.'
  },
  customers: {
    title: 'Bu sayfada ne yaparsınız?',
    purpose: 'Sipariş veren müşterileri kanal, telefon ve son sipariş tarihine göre listeler, arama yaparsınız.',
    safe: 'Müşteri bilgileri kanallardan gelen sipariş kayıtlarından türetilir; burada düzenleme yapılmaz.'
  },
  settings: {
    title: 'Bu sayfada ne yaparsınız?',
    purpose: 'Otomatik kasa gönderimi, BenimPOS→kanal stok senkronu ve eğitim/canlı mod ayarlarını yönetirsiniz.',
    safe: 'Eğitim modu açıkken hiçbir işlem gerçek sisteme yazılmaz. Ürün bazlı stok hariç tutma Ürünler sayfasındadır.'
  }
};

export function renderPageGuideBlock(navItemId) {
  const guide = PAGE_GUIDES[navItemId];
  if (!guide) return '';
  return `<aside class="ops-page-guide" role="note">
    <div class="ops-page-guide-head">
      <span class="ops-page-guide-icon" aria-hidden="true">💡</span>
      <strong>${escapeHtml(guide.title)}</strong>
    </div>
    <p class="ops-page-guide-purpose">${escapeHtml(guide.purpose)}</p>
    <p class="ops-page-guide-safe"><span class="ops-page-guide-shield" aria-hidden="true">🛡</span> ${escapeHtml(guide.safe)}</p>
  </aside>`;
}
