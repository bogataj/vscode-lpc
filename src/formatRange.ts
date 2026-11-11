/** Lines of a document and the lines of its formatted text that replace them (all inclusive). */
export interface FormattedLineRange {
    startLine: number;
    endLine: number;
    formattedStartLine: number;
    formattedEndLine: number;
    /** False when the range had to grow because formatting joined lines across its boundary. */
    exact: boolean;
}

function withoutWhitespace(line: string): string {
    return line.replace(/\s+/g, '');
}

/**
 * Finds the lines of `formattedLines` that correspond to `originalLines[startLine..endLine]`.
 *
 * Formatting only changes whitespace, so the same non-whitespace characters appear in both
 * texts in the same order, and a line is identified by how many of them precede it. Blank
 * lines at either end of the range are left out. When the formatted text has no line break
 * where the range starts or ends (lines were joined across the boundary), the range grows to
 * the nearest lines where both texts break.
 *
 * Returns undefined when the range has no code, or when the texts differ in more than
 * whitespace, in which case no part of the formatted text can safely replace the range.
 */
export function mapFormattedLineRange(
    originalLines: string[],
    formattedLines: string[],
    startLine: number,
    endLine: number
): FormattedLineRange | undefined {
    const originalText = originalLines.map(withoutWhitespace);
    const formattedText = formattedLines.map(withoutWhitespace);
    if (originalText.join('') !== formattedText.join('')) {
        return undefined;
    }

    let start = Math.max(0, startLine);
    let end = Math.min(originalLines.length - 1, endLine);
    while (start <= end && originalText[start].length === 0) {
        start++;
    }
    while (end >= start && originalText[end].length === 0) {
        end--;
    }
    if (start > end) {
        return undefined;
    }

    // Non-whitespace characters before each line.
    const originalOffsets: number[] = [];
    let offset = 0;
    for (const text of originalText) {
        originalOffsets.push(offset);
        offset += text.length;
    }

    // Formatted lines by the offset at which they start and end.
    const formattedStarts = new Map<number, number>();
    const formattedEnds = new Map<number, number>();
    offset = 0;
    formattedText.forEach((text, line) => {
        if (text.length > 0) {
            formattedStarts.set(offset, line);
            offset += text.length;
            formattedEnds.set(offset, line);
        }
    });

    // The first and last lines with code start and end at the same offsets in both texts,
    // so growing the range always stops there at the latest.
    let exact = true;
    while (!formattedStarts.has(originalOffsets[start])) {
        exact = false;
        do {
            start--;
        } while (originalText[start].length === 0);
    }
    while (!formattedEnds.has(originalOffsets[end] + originalText[end].length)) {
        exact = false;
        do {
            end++;
        } while (originalText[end].length === 0);
    }

    return {
        startLine: start,
        endLine: end,
        formattedStartLine: formattedStarts.get(originalOffsets[start])!,
        formattedEndLine: formattedEnds.get(originalOffsets[end] + originalText[end].length)!,
        exact
    };
}
