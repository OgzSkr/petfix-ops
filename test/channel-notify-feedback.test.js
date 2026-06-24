import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildChannelNotifyFeedback,
  channelDativeLabel,
  channelStaffLabel
} from '../lib/ops-hub/channel/channel-notify-feedback.js';

test('channelStaffLabel maps trendyol_go to Uber', () => {
  assert.equal(channelStaffLabel('trendyol_go'), 'Uber');
  assert.equal(channelDativeLabel('trendyol_go'), "Uber'e");
});

test('buildChannelNotifyFeedback uses channel-specific success text', () => {
  const uber = buildChannelNotifyFeedback({
    channel: 'trendyol_go',
    action: 'ready',
    dryRun: false,
    channelWriteFailed: false
  });
  assert.equal(uber.successMessage, "Sipariş Uber'e hazır bildirildi");

  const getir = buildChannelNotifyFeedback({
    channel: 'getir',
    action: 'ready',
    dryRun: false,
    channelWriteFailed: false
  });
  assert.equal(getir.successMessage, "Sipariş Getir'e hazır bildirildi");
});

test('buildChannelNotifyFeedback surfaces channel-specific errors', () => {
  const result = buildChannelNotifyFeedback({
    channel: 'trendyol_go',
    action: 'ready',
    channelWriteFailed: true,
    channelResult: { error: 'Trendyol Go API hatası (409): geçersiz durum' }
  });
  assert.match(result.errorMessage, /Uber bildirimi başarısız/);
});
