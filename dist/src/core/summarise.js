export function summarise(description, maxChars = 160) {
    if (!description) {
        return '';
    }
    // Clean up whitespace - replace multiple spaces/tabs/newlines with single space
    const cleaned = description
        .replace(/\s+/g, ' ')
        .trim();
    if (cleaned.length <= maxChars) {
        return cleaned;
    }
    // Truncate and add ellipsis
    // Try to break at a word boundary if possible
    const truncated = cleaned.substring(0, maxChars - 1);
    const lastSpace = truncated.lastIndexOf(' ');
    if (lastSpace > maxChars * 0.8) {
        // If we can break at a word boundary without losing too much
        return truncated.substring(0, lastSpace) + '…';
    }
    // Otherwise just truncate at the character limit
    return truncated + '…';
}
//# sourceMappingURL=summarise.js.map