(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.FilenameDateParser = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    const DEFAULT_ASSUME_OFFSET_MINUTES = 120; // CEST by default for this project

    function toInt(s) {
        return parseInt(s, 10);
    }

    function clamp(num, min, max) {
        return Math.min(Math.max(num, min), max);
    }

    function isValidYMD(year, month, day) {
        if (month < 1 || month > 12) return false;
        if (day < 1 || day > 31) return false;
        return year >= 1970 && year <= 2100; // practical bounds
    }

    function buildUtcDate(year, month, day, hour, minute, second) {
        return new Date(Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0));
    }

    function parseTimezoneOffset(tzString) {
        // tzString examples: 'Z', '+02', '+0200', '+02:00', '-0530', '-05:30'
        if (!tzString) return null;
        if (tzString === 'Z' || tzString === 'z') return 0;
        const m = tzString.match(/^([+-])(\d{2})(?::?(\d{2}))?$/);
        if (!m) return null;
        const sign = m[1] === '+' ? 1 : -1;
        const hh = toInt(m[2]);
        const mm = m[3] ? toInt(m[3]) : 0;
        const total = sign * (hh * 60 + mm);
        return clamp(total, -14 * 60, 14 * 60); // clamp to plausible tz range
    }

    function applyOffsetAssumption(utcBase, assumedOffsetMinutes) {
        // We have a wall time with unknown zone; interpret it as local with given offset
        // So the UTC instant is wallTime - offset
        return new Date(utcBase.getTime() - (assumedOffsetMinutes * 60 * 1000));
    }

    // Patterns are ordered by specificity: timezone-aware > full time > date-only
    const PATTERNS = [
        {
            name: 'iso_with_tz',
            // 2025-08-04T13:27:44Z, 20250804T132744+02:00, 2025-08-04 13.27.44+0200, 2025-08-04_132744-05
            regex: /(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})[Tt_ .-]?(\d{2})[:._-]?(\d{2})(?:[:._-]?(\d{2}))?\s*(Z|[+-]\d{2}(?::?\d{2})?)/,
            handler: (m) => {
                const year = toInt(m[1]);
                const month = toInt(m[2]);
                const day = toInt(m[3]);
                if (!isValidYMD(year, month, day)) return null;
                const hour = toInt(m[4]);
                const minute = toInt(m[5]);
                const second = m[6] ? toInt(m[6]) : 0;
                const tz = parseTimezoneOffset(m[7]);
                if (tz === null) return null;
                const utcBase = buildUtcDate(year, month, day, hour, minute, second);
                // utcBase currently treats numbers as UTC. To adjust from local with tz to UTC instant:
                const utcInstant = new Date(utcBase.getTime() - (tz * 60 * 1000));
                return { date: utcInstant, meta: { pattern: 'iso_with_tz', tzOffsetMinutes: tz } };
            }
        },
        {
            name: 'iso_separated',
            // 2025-08-04 13:27:44, 2025-08-04_13-27-44, 2025.08.04 13.27.44
            regex: /(\d{4})[-_.](\d{2})[-_.](\d{2})[Tt_ .-](\d{2})[:._-](\d{2})(?:[:._-](\d{2}))?\b/,
            handler: (m, assumedOffsetMinutes) => {
                const year = toInt(m[1]);
                const month = toInt(m[2]);
                const day = toInt(m[3]);
                if (!isValidYMD(year, month, day)) return null;
                const hour = toInt(m[4]);
                const minute = toInt(m[5]);
                const second = m[6] ? toInt(m[6]) : 0;
                const utcBase = buildUtcDate(year, month, day, hour, minute, second);
                const utcInstant = applyOffsetAssumption(utcBase, assumedOffsetMinutes);
                return { date: utcInstant, meta: { pattern: 'iso_separated', tzOffsetMinutes: assumedOffsetMinutes } };
            }
        },
        {
            name: 'compact_ymdhms',
            // 20250804_132744, 20250804132744, IMG_20250804_132744
            regex: /(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})(?!\d)/,
            handler: (m, assumedOffsetMinutes) => {
                const year = toInt(m[1]);
                const month = toInt(m[2]);
                const day = toInt(m[3]);
                if (!isValidYMD(year, month, day)) return null;
                const hour = toInt(m[4]);
                const minute = toInt(m[5]);
                const second = toInt(m[6]);
                const utcBase = buildUtcDate(year, month, day, hour, minute, second);
                const utcInstant = applyOffsetAssumption(utcBase, assumedOffsetMinutes);
                return { date: utcInstant, meta: { pattern: 'compact_ymdhms', tzOffsetMinutes: assumedOffsetMinutes } };
            }
        },
        {
            name: 'compact_ymdhm',
            // 202508041327, 20250804_1327
            regex: /(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(?!\d)/,
            handler: (m, assumedOffsetMinutes) => {
                const year = toInt(m[1]);
                const month = toInt(m[2]);
                const day = toInt(m[3]);
                if (!isValidYMD(year, month, day)) return null;
                const hour = toInt(m[4]);
                const minute = toInt(m[5]);
                const utcBase = buildUtcDate(year, month, day, hour, minute, 0);
                const utcInstant = applyOffsetAssumption(utcBase, assumedOffsetMinutes);
                return { date: utcInstant, meta: { pattern: 'compact_ymdhm', tzOffsetMinutes: assumedOffsetMinutes } };
            }
        },
        {
            name: 'date_only_compact_or_sep',
            // 20250804 or 2025-08-04 or 2025.08.04
            regex: /(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})\b/,
            handler: (m, assumedOffsetMinutes) => {
                const year = toInt(m[1]);
                const month = toInt(m[2]);
                const day = toInt(m[3]);
                if (!isValidYMD(year, month, day)) return null;
                const utcBase = buildUtcDate(year, month, day, 0, 0, 0);
                const utcInstant = applyOffsetAssumption(utcBase, assumedOffsetMinutes);
                return { date: utcInstant, meta: { pattern: 'date_only', tzOffsetMinutes: assumedOffsetMinutes } };
            }
        }
    ];

    function parseWithInfo(filename, options) {
        const opts = options || {};
        const assumed = typeof opts.assumeOffsetMinutes === 'number' ? opts.assumeOffsetMinutes : DEFAULT_ASSUME_OFFSET_MINUTES;
        for (let i = 0; i < PATTERNS.length; i++) {
            const p = PATTERNS[i];
            const m = filename.match(p.regex);
            if (m) {
                const result = p.handler(m, assumed);
                if (result && result.date instanceof Date && !isNaN(result.date.getTime())) {
                    return result;
                }
            }
        }
        return null;
    }

    function parse(filename, options) {
        const info = parseWithInfo(filename, options);
        return info ? info.date : null;
    }

    function formatDisplay(date) {
        // dd/mm/yyyy HH:MM
        const pad = (n) => n.toString().padStart(2, '0');
        const d = date;
        const day = pad(d.getDate());
        const month = pad(d.getMonth() + 1);
        const year = d.getFullYear();
        const hour = pad(d.getHours());
        const minute = pad(d.getMinutes());
        return `${day}/${month}/${year} ${hour}:${minute}`;
    }

    return {
        parse: parse,
        parseWithInfo: parseWithInfo,
        formatDisplay: formatDisplay,
        DEFAULT_ASSUME_OFFSET_MINUTES: DEFAULT_ASSUME_OFFSET_MINUTES
    };
}));


