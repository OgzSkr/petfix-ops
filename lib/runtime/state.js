export function createRuntimeState() {
  return {
    workerProcess: null,
    workerLastLog: '',
    workerStartedAt: '',
    lossOrderMonitorTimer: null,
    lossOrderMonitorRunning: false,
    matchingSyncTimer: null,
    matchingSyncRunning: false,
    lastCacheSyncAt: 0,
    lastOrdersFetchAt: 0,
    ordersCache: {},
    channelOrdersCache: {}
  };
}
