const CHANNEL_STAFF_LABELS = Object.freeze({
  trendyol_go: 'Uber',
  yemeksepeti: 'Yemeksepeti',
  getir: 'Getir'
});

const CHANNEL_DATIVE_LABELS = Object.freeze({
  trendyol_go: "Uber'e",
  yemeksepeti: "Yemeksepeti'ne",
  getir: "Getir'e"
});

export function channelStaffLabel(channel) {
  const key = String(channel || '').trim();
  return CHANNEL_STAFF_LABELS[key] || key || 'Kanal';
}

export function channelDativeLabel(channel) {
  const key = String(channel || '').trim();
  return CHANNEL_DATIVE_LABELS[key] || channelStaffLabel(key);
}

/** Mobil / panel toast metinleri — kanal adına göre (Getir sabit değil). */
export function buildChannelNotifyFeedback({
  channel,
  action,
  dryRun = false,
  channelWriteFailed = false,
  channelResult = null
} = {}) {
  const label = channelStaffLabel(channel);
  const dative = channelDativeLabel(channel);

  if (channelWriteFailed) {
    const err = String(channelResult?.error || 'Bilinmeyen hata').trim();
    return {
      ok: false,
      channel,
      channelLabel: label,
      channelDative: dative,
      successMessage: null,
      errorMessage: `${label} bildirimi başarısız: ${err}`
    };
  }

  if (dryRun) {
    const successMessage = action === 'ready'
      ? 'Sipariş yola çıkarıldı (simülasyon)'
      : 'Kabul simüle edildi';
    return {
      ok: true,
      simulated: true,
      channel,
      channelLabel: label,
      channelDative: dative,
      successMessage,
      errorMessage: null
    };
  }

  const successMessage = action === 'ready'
    ? `Sipariş ${dative} hazır bildirildi`
    : `Sipariş ${dative} kabul bildirildi`;

  return {
    ok: true,
    simulated: false,
    channel,
    channelLabel: label,
    channelDative: dative,
    successMessage,
    errorMessage: null
  };
}
