const STOCK_RESERVE_PER_MATCHED_LINE = true;

export function simulateOrderShadow(order, { lines }) {
  const lineResults = [];
  const issues = [];
  let simulatedReservedQty = 0;
  let simulatedSaleLines = 0;
  let blockedLines = 0;

  for (const line of lines) {
    const qty = Number(line.quantity) || 0;
    const result = {
      lineIndex: line.line_index ?? line.lineIndex,
      channelProductId: line.channel_product_id ?? line.channelProductId,
      barcode: line.barcode,
      matchingStatus: line.matching_status ?? line.matchingStatus,
      quantity: qty
    };

    if (result.matchingStatus === 'matched' && result.barcode) {
      result.reservedQty = qty;
      result.simulatedBenimposSale = {
        dryRun: true,
        barcode: result.barcode,
        quantity: qty,
        channel: order.channel,
        externalId: order.external_id ?? order.externalId
      };
      simulatedReservedQty += qty;
      simulatedSaleLines += 1;
    } else if (result.matchingStatus === 'unmapped') {
      result.reservedQty = 0;
      issues.push({
        type: 'unmapped_line',
        lineIndex: result.lineIndex,
        channelProductId: result.channelProductId
      });
    } else if (result.matchingStatus === 'blocked') {
      result.reservedQty = 0;
      blockedLines += 1;
      issues.push({
        type: 'blocked_line',
        lineIndex: result.lineIndex,
        channelProductId: result.channelProductId
      });
    } else {
      result.reservedQty = STOCK_RESERVE_PER_MATCHED_LINE ? 0 : 0;
      issues.push({
        type: 'legacy_line',
        lineIndex: result.lineIndex,
        channelProductId: result.channelProductId
      });
    }

    lineResults.push(result);
  }

  const matchingCoverage =
    lines.length === 0 ? 0 : Number(((simulatedSaleLines / lines.length) * 100).toFixed(1));

  return {
    shadowMode: Boolean(order.shadow_mode ?? order.shadowMode ?? true),
    channel: order.channel,
    externalId: order.external_id ?? order.externalId,
    summary: {
      lineCount: lines.length,
      matchedLines: simulatedSaleLines,
      blockedLines,
      unmappedLines: issues.filter((item) => item.type === 'unmapped_line').length,
      simulatedReservedQty,
      matchingCoveragePercent: matchingCoverage,
      wouldWriteBenimposSale: simulatedSaleLines > 0,
      wouldWriteChannelStatus: false,
      wouldPushStock: false
    },
    lineResults,
    issues,
    simulatedPayloads: {
      benimposSale: lineResults
        .filter((line) => line.simulatedBenimposSale)
        .map((line) => line.simulatedBenimposSale),
      channelStatus: null,
      stockPush: null
    }
  };
}

export function buildShadowReportFromEvents(orders, events) {
  const byType = {};
  for (const event of events) {
    byType[event.event_type] = (byType[event.event_type] || 0) + 1;
  }

  const orderStats = {
    total: orders.length,
    shadow: orders.filter((row) => row.shadow_mode).length,
    byChannel: {}
  };

  for (const row of orders) {
    orderStats.byChannel[row.channel] = (orderStats.byChannel[row.channel] || 0) + 1;
  }

  const issueEvents = events.filter((event) => event.event_type === 'shadow_issue');
  const simulateEvents = events.filter((event) => event.event_type === 'shadow_simulation');

  return {
    generatedAt: new Date().toISOString(),
    orders: orderStats,
    events: {
      total: events.length,
      byType,
      simulations: simulateEvents.length,
      issues: issueEvents.length
    },
    recentIssues: issueEvents.slice(0, 20).map((event) => ({
      orderId: event.order_id,
      createdAt: event.created_at,
      payload: event.payload
    }))
  };
}
