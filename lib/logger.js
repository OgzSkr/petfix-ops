function timestamp() {
  return new Date().toISOString();
}

export function createLogger(scope) {
  const prefix = `[${scope}]`;

  return {
    info(message, meta) {
      if (meta !== undefined) {
        console.log(`${prefix} ${timestamp()} ${message}`, meta);
        return;
      }
      console.log(`${prefix} ${message}`);
    },
    warn(message, meta) {
      if (meta !== undefined) {
        console.warn(`${prefix} ${timestamp()} ${message}`, meta);
        return;
      }
      console.warn(`${prefix} ${message}`);
    },
    error(message, meta) {
      if (meta !== undefined) {
        console.error(`${prefix} ${timestamp()} ${message}`, meta);
        return;
      }
      console.error(`${prefix} ${message}`);
    }
  };
}
