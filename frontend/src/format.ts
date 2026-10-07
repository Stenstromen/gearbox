const rateUnits = ["B/s", "KB/s", "MB/s", "GB/s"];
const sizeUnits = ["B", "KB", "MB", "GB", "TB"];

export function formatPercent(fraction: number): string {
    if (!Number.isFinite(fraction)) {
        return "0%";
    }
    const clamped = Math.min(1, Math.max(0, fraction));
    return `${(clamped * 100).toFixed(1)}%`;
}

export function formatRate(bytesPerSecond: number): string {
    return formatQuantity(bytesPerSecond, rateUnits);
}

export function formatBytes(bytes: number): string {
    return formatQuantity(bytes, sizeUnits);
}

export function formatRatio(ratio: number): string {
    if (ratio === -2) {
        return "∞";
    }
    if (!Number.isFinite(ratio) || ratio < 0) {
        return "—";
    }
    return ratio.toFixed(2);
}

export function formatAvailability(fraction: number): string {
    if (!Number.isFinite(fraction) || fraction < 0) {
        return "Unknown";
    }
    return `${(fraction * 100).toFixed(1)}%`;
}

export function formatDuration(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) {
        return "Unknown";
    }
    const total = Math.floor(seconds);
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (days > 0) {
        return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    }
    if (hours > 0) {
        return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
    }
    if (minutes > 0) {
        return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
    }
    return `${secs}s`;
}

export function formatTimestamp(unixSeconds: number): string {
    if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) {
        return "Unknown";
    }
    return new Date(unixSeconds * 1000).toLocaleString([], {dateStyle: "medium", timeStyle: "short"});
}

export function formatLastActivity(unixSeconds: number, now = Date.now()): string {
    if (!Number.isFinite(unixSeconds) || unixSeconds <= 0) {
        return "Never";
    }
    const elapsed = Math.max(0, Math.floor(now / 1000 - unixSeconds));
    if (elapsed < 45) {
        return "Just now";
    }
    if (elapsed < 3600) {
        return `${Math.round(elapsed / 60)}m ago`;
    }
    if (elapsed < 86400) {
        return `${Math.round(elapsed / 3600)}h ago`;
    }
    if (elapsed < 86400 * 14) {
        return `${Math.round(elapsed / 86400)}d ago`;
    }
    return formatTimestamp(unixSeconds);
}

function formatQuantity(value: number, units: string[]): string {
    if (!Number.isFinite(value) || value <= 0) {
        return `0 ${units[0]}`;
    }
    let amount = value;
    let unit = 0;
    while (amount >= 1024 && unit < units.length - 1) {
        amount /= 1024;
        unit++;
    }
    const digits = unit === 0 || amount >= 100 ? 0 : 1;
    return `${amount.toFixed(digits)} ${units[unit]}`;
}
