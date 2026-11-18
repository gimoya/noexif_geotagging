(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.ExifGpsReader = factory();
    }
}(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /**
     * Read GPS from image EXIF if present.
     * Requires global `exifr` (CDN). Returns Mapbox-order [lon, lat] + optional elevation.
     */
    async function read(file) {
        if (!file || typeof exifr === 'undefined' || typeof exifr.parse !== 'function') {
            return null;
        }
        try {
            const data = await exifr.parse(file, { gps: true });
            if (!data) return null;

            const lat = data.latitude;
            const lon = data.longitude;
            if (typeof lat !== 'number' || typeof lon !== 'number') return null;
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
            if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;

            let elevation = null;
            if (typeof data.GPSAltitude === 'number' && Number.isFinite(data.GPSAltitude)) {
                elevation = data.GPSAltitudeRef === 1 ? -data.GPSAltitude : data.GPSAltitude;
            }

            return {
                coordinates: [lon, lat],
                elevation: elevation
            };
        } catch (e) {
            return null;
        }
    }

    return {
        read: read
    };
}));
