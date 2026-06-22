const ACTION_SEVERITY_ORDER = { danger: 0, warning: 1, info: 2, muted: 3 };

export function sortActionCenterItems(items = []) {
  return [...items].sort((a, b) => {
    const sa = ACTION_SEVERITY_ORDER[a.severity] ?? 9;
    const sb = ACTION_SEVERITY_ORDER[b.severity] ?? 9;
    if (sa !== sb) return sa - sb;
    return Number(b.count || 0) - Number(a.count || 0);
  });
}
