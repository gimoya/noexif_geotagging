

// Optional Mapbox token (used by Mapbox-specific features like geocoder/static API).
mapboxgl.accessToken = 'pk.eyJ1IjoiZ2ltb3lhIiwiYSI6IkZrTld6NmcifQ.eY6Ymt2kVLvPQ6A2Dt9zAQ';

// Configurable thresholds and constants
const GPX_TIME_THRESHOLD = 60; // 60 seconds = 1 minute, for GPX auto-assignment
const ELEVATION_DISTANCE_THRESHOLD = 5; // 5 meters, for elevation lookup from GPX track

// Media files will be loaded dynamically from the file input
let mediaFiles = [];

// API-key-free hybrid-like basemap (imagery + reference labels)
const map = new mapboxgl.Map({
    container: 'map',
    style: {
        version: 8,
        // Needed for symbol text (pin nr labels)
        glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
        sources: {
            esriImagery: {
                type: 'raster',
                tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
                tileSize: 256,
                maxzoom: 22,
                attribution: 'Tiles © Esri'
            },
            esriReferenceLabels: {
                type: 'raster',
                tiles: ['https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'],
                tileSize: 256,
                maxzoom: 22,
                attribution: 'Labels © Esri'
            }
        },
        layers: [
            { id: 'esri-imagery-layer', type: 'raster', source: 'esriImagery' },
            { id: 'esri-reference-labels-layer', type: 'raster', source: 'esriReferenceLabels' }
        ]
    },
    center: [13.8, 47.6], // Center of Austria
    zoom: 8,
    maxZoom: 18 // Esri imagery/labels stop being useful beyond this
});

// Pin number labels: collision-aware placement (GeoJSON symbol layer)
const PIN_NR_SOURCE = 'pin-nr-labels';
const PIN_NR_LAYER = 'pin-nr-labels-layer';
const PIN_NR_BOX = 22; // collision box size (px)
const PIN_NR_OFFSETS_PX = [
    [14, -16], [-14, -16], [14, 16], [-14, 16],
    [22, 0], [-22, 0], [0, -24], [0, 24],
    [28, -28], [-28, -28], [28, 28], [-28, 28],
    [36, 0], [-36, 0], [0, -36], [0, 36]
];

// Global variables
let selectedFileIndex = -1;
let currentMode = 'assign';
let mediaMarkers = [];
let positionMarkers = []; // Store position markers for each file
let gpxTrack = null; // Store GPX track data
let gpxTimezoneOffsetMinutes = 120; // Default: UTC+02:00 (CEST) in minutes

// Timezone offset constants (in milliseconds)
const CEST_OFFSET_MS = 2 * 60 * 60 * 1000; // +2 hours for CEST

// Centralized style objects for reuse
const STYLE_GPX_LINE = {
    layout: { 'line-join': 'round', 'line-cap': 'square' },
    paint: {
        'line-color': '#ff9800', // orange (Material Design Orange 500)
        'line-width': 2,
        'line-opacity': 1.0,
        'line-blur': 0.5,
        'line-dasharray': [1, 2]
    }
};

const STYLE_MEDIA_MARKER = {
    boxSizePx: 30,
    fontSizePx: 25,
    emojiImage: '📷',
    emojiVideo: '🎥',
    color: '#000000'
};

const STYLE_POSITION_MARKER = {
    boxSizePx: 24,
    fontSizePx: 18,
    emoji: '✖',
    color: '#ffffff'
};

function emptyFeatureCollection() {
    return { type: 'FeatureCollection', features: [] };
}

function ensurePinNrLayers() {
    if (!map.getStyle()) return false;
    if (!map.getSource(PIN_NR_SOURCE)) {
        map.addSource(PIN_NR_SOURCE, { type: 'geojson', data: emptyFeatureCollection() });
    }
    if (!map.getLayer(PIN_NR_LAYER)) {
        map.addLayer({
            id: PIN_NR_LAYER,
            type: 'symbol',
            source: PIN_NR_SOURCE,
            layout: {
                'text-field': ['get', 'nr'],
                'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
                'text-size': 12,
                'text-anchor': 'center',
                'text-allow-overlap': true,
                'text-ignore-placement': true
            },
            paint: {
                'text-color': '#ffffff',
                'text-halo-color': '#222222',
                'text-halo-width': 3.5,
                'text-halo-blur': 0.2
            }
        });
    }
    return true;
}

function pinNrBoxesOverlap(a, b) {
    return !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);
}

/**
 * Shared screen-space nr placement (live map + export overview).
 * @param {{index:number,x:number,y:number}[]} points pin pixel positions
 * @param {{scale?:number}} [options] scale offsets/box for hi-dpi canvases (e.g. @2x → 2)
 * @returns {{index:number,pinX:number,pinY:number,labelX:number,labelY:number}[]}
 */
function layoutPinNrPositions(points, options) {
    const scale = (options && options.scale) ? options.scale : 1;
    const boxSize = PIN_NR_BOX * scale;
    const offsets = PIN_NR_OFFSETS_PX.map(([ox, oy]) => [ox * scale, oy * scale]);
    const placedBoxes = [];
    const laid = [];

    for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        let chosen = null;

        for (let o = 0; o < offsets.length; o++) {
            const lx = pt.x + offsets[o][0];
            const ly = pt.y + offsets[o][1];
            const box = {
                x: lx - boxSize / 2,
                y: ly - boxSize / 2,
                w: boxSize,
                h: boxSize
            };
            let hits = false;
            for (let p = 0; p < placedBoxes.length; p++) {
                if (pinNrBoxesOverlap(box, placedBoxes[p])) {
                    hits = true;
                    break;
                }
            }
            if (!hits) {
                chosen = { lx, ly, box };
                break;
            }
        }

        if (!chosen) {
            const angle = (pt.index % 12) * (Math.PI / 6);
            const radius = (42 + Math.floor(pt.index / 12) * 16) * scale;
            const lx = pt.x + Math.cos(angle) * radius;
            const ly = pt.y + Math.sin(angle) * radius;
            chosen = {
                lx, ly,
                box: { x: lx - boxSize / 2, y: ly - boxSize / 2, w: boxSize, h: boxSize }
            };
        }

        placedBoxes.push(chosen.box);
        laid.push({
            index: pt.index,
            pinX: pt.x,
            pinY: pt.y,
            labelX: chosen.lx,
            labelY: chosen.ly
        });
    }

    return laid;
}

// Place nr labels outside colliding pins (no leader lines)
function syncPinNrLabels() {
    if (!map.isStyleLoaded() || !ensurePinNrLayers()) return;

    const points = [];
    mediaFiles.forEach((file, index) => {
        if (!file.coordinates) return;
        const pinScreen = map.project(file.coordinates);
        points.push({ index, x: pinScreen.x, y: pinScreen.y });
    });

    const laid = layoutPinNrPositions(points);
    const labelFeatures = laid.map((item) => {
        const labelLngLat = map.unproject([item.labelX, item.labelY]);
        return {
            type: 'Feature',
            properties: { nr: String(item.index + 1), fileIndex: item.index },
            geometry: { type: 'Point', coordinates: [labelLngLat.lng, labelLngLat.lat] }
        };
    });

    map.getSource(PIN_NR_SOURCE).setData({ type: 'FeatureCollection', features: labelFeatures });
}

function clearPinNrLabels() {
    if (!map.getSource(PIN_NR_SOURCE)) return;
    map.getSource(PIN_NR_SOURCE).setData(emptyFeatureCollection());
}

function logActivity(message, type = 'info') {
    const logContainer = document.getElementById('unified-activity-log');
    if (!logContainer) return;
    
    const logEntry = document.createElement('div');
    logEntry.className = `unified-log-entry ${type}`;
    // Display message as-is (avoid Date objects to prevent timezone shifts)
    logEntry.innerHTML = `${message}`;
    
    logContainer.appendChild(logEntry);
    
    // Auto-scroll to bottom
    logContainer.scrollTop = logContainer.scrollHeight;
    
    // Keep only last 20 entries to prevent memory issues
    while (logContainer.children.length > 20) {
        logContainer.removeChild(logContainer.firstChild);
    }
}

// Initialize the application
function initApp() {
    loadMediaFiles();
    setupEventListeners();
    ensurePinNrLayers();
    
    // Initialize with correct mode and pins
    toggleMode();
    syncPinNrLabels();
}

// Load media files from file input
function loadMediaFiles() {
    // Initialize with empty array - files will be loaded via file input
    mediaFiles = [];
    populateFileList();
    updateStats();
}

// Run auto-matching if we have both media and a GPX track
function runAutoMatchingIfReady() {
    if (gpxTrack && Array.isArray(mediaFiles) && mediaFiles.length > 0) {
        autoAssignCoordinatesFromGpx(gpxTrack);
    }
}

// Sort media files by parsed filename date/time (oldest first), then by filename.
function sortMediaFilesByDateTaken(a, b) {
    if (a.dateTaken && b.dateTaken) return a.dateTaken - b.dateTaken;
    if (a.dateTaken && !b.dateTaken) return -1;
    if (!a.dateTaken && b.dateTaken) return 1;
    return a.filename.localeCompare(b.filename);
}



// Populate the file list in the control panel
function populateFileList() {
    const fileList = document.getElementById('file-list');
    fileList.innerHTML = '';
    
    mediaFiles.forEach((file, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.dataset.index = index;
        
        const hasCoords = file.coordinates !== null;
        const statusClass = hasCoords ? 'has-coords' : 'no-coords';
        const statusText = hasCoords ? 'Has Coords' : 'No Coords';
        
        // Display wall-time string derived directly from filename (no Date objects)
        let dateStr = getWallTimeStringFromFilename(file.filename) || 'Unknown date';
        const timeDiffLabel = (file.coordSource !== 'manual' && file.timeDiffSeconds != null)
            ? ` • time-diff ${formatTimeDiffMmSs(file.timeDiffSeconds)}`
            : '';
        
        fileItem.innerHTML = `
            <div class="file-info">
                <div class="file-id">${index + 1}</div>
                ${file.type === 'image' ? `<img src="${file.path}" class="file-thumbnail" alt="${file.filename}">` : `<div class="file-thumbnail video-thumbnail">🎥</div>`}
                <div class="file-details">
                    <div class="file-name">${file.filename}</div>
                    <div class="file-type">${file.type} • ${dateStr}${timeDiffLabel}</div>
                </div>
            </div>
            <div class="file-actions">
                <div class="coordinate-status ${statusClass}">${statusText}</div>
                <button class="file-delete-btn" type="button" title="Delete file from list">Delete</button>
            </div>
        `;
        
        fileItem.addEventListener('click', () => selectFile(index));
        const deleteBtn = fileItem.querySelector('.file-delete-btn');
        deleteBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            deleteMediaFile(index);
        });
        fileList.appendChild(fileItem);
    });
}

// Build a wall-time string directly from the filename tokens to avoid timezone shifts in UI
function getWallTimeStringFromFilename(filename) {
    // Order matters: more specific first
    const patterns = [
        // ISO with timezone present
        /(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})[Tt_ .-]?(\d{2})[:._-]?(\d{2})(?:[:._-]?(\d{2}))?\s*(Z|[+-]\d{2}(?::?\d{2})?)/,
        // ISO-like separated
        /(\d{4})[-_.](\d{2})[-_.](\d{2})[Tt_ .-](\d{2})[:._-](\d{2})(?:[:._-](\d{2}))?\b/,
        // Compact with seconds (optional 1–3 ms digits, e.g. PXL_…_162237500)
        /(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})(?:\d{1,3})?(?!\d)/,
        // Compact without seconds
        /(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(?!\d)/,
        // Date only
        /(\d{4})[-_.]?(\d{2})[-_.]?(\d{2})\b/
    ];
    for (let i = 0; i < patterns.length; i++) {
        const m = filename.match(patterns[i]);
        if (!m) continue;
        if (m.length >= 7 && (i === 0 || i === 1 || i === 2)) {
            const year = m[1], month = m[2], day = m[3];
            const hour = m[4], minute = m[5];
            const second = m[6] || '00';
            return `${day}/${month}/${year} ${hour}:${minute}`; // omit seconds for brevity
        } else if (m.length === 6) { // compact without seconds
            const year = m[1], month = m[2], day = m[3];
            const hour = m[4], minute = m[5];
            return `${day}/${month}/${year} ${hour}:${minute}`;
        } else if (m.length === 4) { // date only
            const year = m[1], month = m[2], day = m[3];
            return `${day}/${month}/${year}`;
        }
    }
    return null;
}

// Select a file for coordinate assignment
function selectFile(index) {
    // Toggle selection if clicking the same item again
    if (selectedFileIndex === index) {
        document.querySelectorAll('.file-item').forEach(item => {
            item.classList.remove('selected');
        });
        selectedFileIndex = -1;
        updateMapCursor();
        return;
    }
    
    // Remove previous selection
    document.querySelectorAll('.file-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    // Add selection to clicked item
    document.querySelector(`[data-index="${index}"]`).classList.add('selected');
    selectedFileIndex = index;
    updateMapCursor();
    
    // Update coordinate display in the log instead of separate div
    const file = mediaFiles[index];
    if (file.coordinates) {
        const centerOffset = getVisibleMapCenterOffset();
        map.easeTo({
            center: file.coordinates,
            zoom: 18,
            offset: centerOffset,
            duration: 700
        });
        logActivity(` Selected: ${file.filename} - Coordinates: ___${file.coordinates[0].toFixed(6)}, ${file.coordinates[1].toFixed(6)}___`, 'info');
    } else {
        logActivity(` Selected: ${file.filename} - No coordinates assigned yet`, 'info');
    }
}

// Delete one media file from the current list and refresh related UI/map state.
function deleteMediaFile(index) {
    const file = mediaFiles[index];
    if (!file) return;

    // Remove stale map markers immediately before reindexing files.
    hideMediaPins();
    hidePositionMarkers();

    if (typeof file.path === 'string' && file.path.startsWith('blob:')) {
        URL.revokeObjectURL(file.path);
    }

    mediaFiles.splice(index, 1);

    if (selectedFileIndex === index) {
        selectedFileIndex = -1;
    } else if (selectedFileIndex > index) {
        selectedFileIndex -= 1;
    }

    populateFileList();
    updateStats();
    refreshMapView();
    updateMapCursor();
    logActivity(`🗑️ Removed file: ${file.filename}`, 'info');
}

// Shift map target into the visible map area when the left panel overlays the map.
function getVisibleMapCenterOffset() {
    const panel = document.getElementById('control-panel');
    const mapEl = document.getElementById('map');
    if (!panel || !mapEl) return [0, 0];

    const panelRect = panel.getBoundingClientRect();
    const mapRect = mapEl.getBoundingClientRect();

    // Count only overlay that actually covers the left edge of the map.
    let leftOverlayWidth = 0;
    if (panelRect.left <= mapRect.left) {
        const overlayRight = Math.min(panelRect.right, mapRect.right);
        leftOverlayWidth = Math.max(0, overlayRight - mapRect.left);
    }

    return [leftOverlayWidth / 2, 0];
}

// Toggle between assign and view modes
function toggleMode() {
    const assignMode = document.getElementById('assign-mode');
    const viewMode = document.getElementById('view-mode');
    
    if (currentMode === 'assign') {
        assignMode.style.display = 'flex';
        viewMode.style.display = 'none';
        updateMapCursor();
        
        // Assign mode: show position markers (normal pins), hide media pins
        showPositionMarkers();
        hideMediaPins();
    } else {
        assignMode.style.display = 'none';
        viewMode.style.display = 'block';
        updateMapCursor();
        
        // View mode: show media pins, hide position markers
        showMediaPins();
        hidePositionMarkers();
        
        // Update stats when switching to view mode to ensure they're current
        updateStats();
    }
}

// Update map cursor based on mode and selection state
function updateMapCursor() {
    if (currentMode === 'assign') {
        if (selectedFileIndex >= 0) {
            map.getCanvas().style.cursor = 'crosshair';
        } else {
            map.getCanvas().style.cursor = 'default';
        }
    } else {
        map.getCanvas().style.cursor = 'grab';
    }
}

// Setup event listeners
function setupEventListeners() {
    // Mode selector
    document.querySelectorAll('input[name="mode"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            currentMode = e.target.value;
            toggleMode();
        });
    });
    
    // Map click handler
    map.on('click', handleMapClick);

    // Re-place pin nr labels (screen-space collision) after pan/zoom
    map.on('moveend', syncPinNrLabels);
    map.on('zoomend', syncPinNrLabels);
    
    // Control panel buttons
    document.getElementById('hide-panel').addEventListener('click', hidePanel);
    document.getElementById('show-panel').addEventListener('click', showPanel);
    
    // File input change handlers (keep existing functionality)
    document.getElementById('media-files-input').addEventListener('change', handleFileSelection);
    document.getElementById('gpx-file-input').addEventListener('change', handleGpxSelection);
    
    // GPX timezone selector
    const gpxTimezoneSelect = document.getElementById('gpx-timezone');
    if (gpxTimezoneSelect) {
        gpxTimezoneSelect.addEventListener('change', function() {
            gpxTimezoneOffsetMinutes = parseInt(this.value, 10);
            logActivity(`🌍 GPX timezone set to UTC${gpxTimezoneOffsetMinutes >= 0 ? '+' : ''}${(gpxTimezoneOffsetMinutes / 60).toFixed(0).padStart(2, '0')}:${Math.abs(gpxTimezoneOffsetMinutes % 60).toString().padStart(2, '0')}`, 'info');
            // Re-run matching if GPX track is loaded
            if (gpxTrack) {
                logActivity('🔄 Re-matching photos with updated timezone...', 'info');
                autoAssignCoordinatesFromGpx(gpxTrack);
            }
        });
    }
    
    // Make drop areas clickable and add drag & drop functionality
    const mediaDropArea = document.querySelector('.file-upload');
    const gpxDropArea = document.querySelector('.gpx-upload');
    
    // Make drop areas clickable (replacing button functionality)
    mediaDropArea.addEventListener('click', () => document.getElementById('media-files-input').click());
    gpxDropArea.addEventListener('click', () => document.getElementById('gpx-file-input').click());
    
    // Drag and drop functionality
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        mediaDropArea.addEventListener(eventName, preventDefaults, false);
        gpxDropArea.addEventListener(eventName, preventDefaults, false);
    });
    
    ['dragenter', 'dragover'].forEach(eventName => {
        mediaDropArea.addEventListener(eventName, () => mediaDropArea.classList.add('dragover'), false);
        gpxDropArea.addEventListener(eventName, () => gpxDropArea.classList.add('dragover'), false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        mediaDropArea.addEventListener(eventName, () => mediaDropArea.classList.remove('dragover'), false);
        gpxDropArea.addEventListener(eventName, () => gpxDropArea.classList.remove('dragover'), false);
    });
    
    // Handle file drops
    mediaDropArea.addEventListener('drop', handleMediaDrop, false);
    gpxDropArea.addEventListener('drop', handleGpxDrop, false);
    
    // Bulk download button
    document.getElementById('download-all-btn').addEventListener('click', downloadAllNoexifGeotaggingMediaPhotos);
}

// Handle map clicks
function handleMapClick(e) {
    if (currentMode === 'assign' && selectedFileIndex >= 0) {
        const coords = e.lngLat.toArray();
        const filename = mediaFiles[selectedFileIndex].filename;
        
        // Update the selected file's coordinates
        mediaFiles[selectedFileIndex].coordinates = coords;
        mediaFiles[selectedFileIndex].coordSource = 'manual';
        mediaFiles[selectedFileIndex].timeDiffSeconds = null;
        
        // Try to find elevation from nearest GPX track point
        const elevationResult = findNearestGpxElevation(coords, ELEVATION_DISTANCE_THRESHOLD);
        mediaFiles[selectedFileIndex].elevation = elevationResult.elevation;
        
        // Update or create position marker
        updatePositionMarker(selectedFileIndex, coords);
        
        // Log the coordinate assignment with elevation info
        let elevationInfo = '';
        if (elevationResult.elevation !== null) {
            elevationInfo = ` (elevation: ${Math.round(elevationResult.elevation)}m from ${elevationResult.distance.toFixed(1)}m away)`;
        } else {
            switch (elevationResult.reason) {
                case 'no_gpx_track':
                    elevationInfo = ' (no GPX track loaded)';
                    break;
                case 'distance_threshold':
                    elevationInfo = ` (nearest GPX point: ${elevationResult.distance.toFixed(1)}m away, exceeds ${ELEVATION_DISTANCE_THRESHOLD}m threshold)`;
                    break;
                case 'no_track_points':
                    elevationInfo = ' (GPX track has no points)';
                    break;
                default:
                    elevationInfo = ' (no elevation data available)';
            }
        }
        
        logActivity(`✖ Coordinates saved to "${filename}": ___${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}___${elevationInfo}`, 'success');
        
        // Update the file list to show new status
        updateFileStatus(selectedFileIndex);
        
        // Show click indicator
        showClickIndicator(e.point);
        
        // Update stats
        updateStats();
    }
}

// Show click indicator animation
function showClickIndicator(point) {
    const indicator = document.createElement('div');
    indicator.className = 'click-indicator';
    indicator.style.left = (point.x - 10) + 'px';
    indicator.style.top = (point.y - 10) + 'px';
    
    document.body.appendChild(indicator);
    
    setTimeout(() => {
        document.body.removeChild(indicator);
    }, 1000);
}

// Update or create position marker for a file
function updatePositionMarker(fileIndex, coords) {
    // Remove existing marker for this file
    if (positionMarkers[fileIndex]) {
        positionMarkers[fileIndex].remove();
    }
    
    // Create new position marker
    const markerEl = document.createElement('div');
    markerEl.className = 'position-marker';
    markerEl.style.width = STYLE_POSITION_MARKER.boxSizePx + 'px';
    markerEl.style.height = STYLE_POSITION_MARKER.boxSizePx + 'px';
    markerEl.style.cursor = 'pointer';
    markerEl.style.fontSize = STYLE_POSITION_MARKER.fontSizePx + 'px';
    markerEl.style.textAlign = 'center';
    markerEl.style.lineHeight = '28.5px';
    markerEl.textContent = STYLE_POSITION_MARKER.emoji;
    markerEl.style.color = STYLE_POSITION_MARKER.color;
    markerEl.title = `#${fileIndex + 1} — ${mediaFiles[fileIndex].filename}`;
    
    // Create popup with file info
    const popupContent = document.createElement('div');
    popupContent.className = 'popup-content';
    
    let elevationText = '';
    if (mediaFiles[fileIndex].elevation !== null && mediaFiles[fileIndex].elevation !== undefined) {
        elevationText = `<div class="popup-elevation">Elevation: ${Math.round(mediaFiles[fileIndex].elevation)}m</div>`;
    }
    
    popupContent.innerHTML = `
        <div class="popup-title">${mediaFiles[fileIndex].filename}</div>
        <div class="popup-coords">Position: ${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}</div>
        ${elevationText}
    `;
    
    const popup = new mapboxgl.Popup({
        offset: 15,
        closeButton: true,
        closeOnClick: true
    }).setDOMContent(popupContent);
    
    // Add marker to map only if in assign mode
    if (currentMode === 'assign') {
        const marker = new mapboxgl.Marker(markerEl)
            .setLngLat(coords)
            .setPopup(popup)
            .addTo(map);
        
        // Store the marker
        positionMarkers[fileIndex] = marker;
    }

    syncPinNrLabels();
}

// Update file status in the list
function updateFileStatus(index) {
    const fileItem = document.querySelector(`[data-index="${index}"]`);
    const file = mediaFiles[index];
    const statusElement = fileItem.querySelector('.coordinate-status');
    
    if (file.coordinates) {
        statusElement.className = 'coordinate-status has-coords';
        statusElement.textContent = 'Has Coords';
    } else {
        statusElement.className = 'coordinate-status no-coords';
        statusElement.textContent = 'No Coords';
    }

    const typeElement = fileItem.querySelector('.file-type');
    if (typeElement) {
        const dateStr = getWallTimeStringFromFilename(file.filename) || 'Unknown date';
        const timeDiffLabel = (file.coordSource !== 'manual' && file.timeDiffSeconds != null)
            ? ` • time-diff ${formatTimeDiffMmSs(file.timeDiffSeconds)}`
            : '';
        typeElement.textContent = `${file.type} • ${dateStr}${timeDiffLabel}`;
    }
}

// Show media pins on the map
function showMediaPins() {
    // Clear pins silently without showing feedback
    mediaMarkers.forEach(marker => marker.remove());
    mediaMarkers = [];
    
    const stats = calculateMediaStats();
    const filesWithCoords = stats.filesWithCoords;
    
    mediaFiles.forEach((file, index) => {
        if (file.coordinates) {
            // Create marker element (use centralized style)
            const markerEl = document.createElement('div');
            markerEl.className = 'media-marker';
            markerEl.style.width = STYLE_MEDIA_MARKER.boxSizePx + 'px';
            markerEl.style.height = STYLE_MEDIA_MARKER.boxSizePx + 'px';
            markerEl.style.cursor = 'pointer';
            markerEl.style.fontSize = STYLE_MEDIA_MARKER.fontSizePx + 'px';
            markerEl.style.textAlign = 'center';
            markerEl.style.lineHeight = STYLE_MEDIA_MARKER.boxSizePx + 'px';
            markerEl.style.color = STYLE_MEDIA_MARKER.color;
            markerEl.textContent = file.type === 'image' ? STYLE_MEDIA_MARKER.emojiImage : STYLE_MEDIA_MARKER.emojiVideo;
            markerEl.title = `#${index + 1} — ${file.filename}`;
            
                         // Create popup content - clean image/video only
             const popupContent = document.createElement('div');
             popupContent.className = 'media-popup-content';
             popupContent.style.position = 'relative';
             popupContent.style.margin = '0';
             popupContent.style.padding = '0';
             
             if (file.type === 'image') {
                 const img = document.createElement('img');
                 img.src = file.path;
                 img.style.width = '100%';
                 img.style.height = 'auto';
                 img.style.display = 'block';
                 img.style.margin = '0';
                 img.style.padding = '0';
                 img.style.borderRadius = '0';
                 popupContent.appendChild(img);
                 
                 // Add filename below image
                 const filenameDiv = document.createElement('div');
                 filenameDiv.style.fontSize = '12px';
                 filenameDiv.style.color = '#666';
                 filenameDiv.style.textAlign = 'center';
                 filenameDiv.style.padding = '8px';
                 filenameDiv.style.fontWeight = '500';
                 filenameDiv.style.backgroundColor = 'white';
                 filenameDiv.textContent = file.filename;
                 popupContent.appendChild(filenameDiv);
             } else {
                 const video = document.createElement('video');
                 video.src = file.path;
                 video.style.width = '100%';
                 video.style.height = 'auto';
                 video.style.display = 'block';
                 video.style.margin = '0';
                 video.style.padding = '0';
                 video.style.borderRadius = '0';
                 video.controls = true;
                 popupContent.appendChild(video);
                 
                 // Add filename below video
                 const filenameDiv = document.createElement('div');
                 filenameDiv.style.fontSize = '12px';
                 filenameDiv.style.color = '#666';
                 filenameDiv.style.textAlign = 'center';
                 filenameDiv.style.padding = '8px';
                 filenameDiv.style.fontWeight = '500';
                 filenameDiv.style.backgroundColor = 'white';
                 filenameDiv.textContent = file.filename;
                 popupContent.appendChild(filenameDiv);
             }
             
             // Create custom close button (grey X)
             const closeBtn = document.createElement('div');
             closeBtn.innerHTML = '×';
             closeBtn.style.position = 'absolute';
             closeBtn.style.top = '8px';
             closeBtn.style.right = '8px';
             closeBtn.style.width = '24px';
             closeBtn.style.height = '24px';
             closeBtn.style.backgroundColor = 'rgba(128, 128, 128, 0.8)';
             closeBtn.style.color = 'white';
             closeBtn.style.borderRadius = '50%';
             closeBtn.style.display = 'flex';
             closeBtn.style.alignItems = 'center';
             closeBtn.style.justifyContent = 'center';
             closeBtn.style.cursor = 'pointer';
             closeBtn.style.fontSize = '18px';
             closeBtn.style.fontWeight = 'bold';
             closeBtn.style.zIndex = '1000';
             closeBtn.title = 'Close';
             
             // Add click handler to close popup
             closeBtn.addEventListener('click', () => {
                 popup.remove();
             });
             
             popupContent.appendChild(closeBtn);
             
             // Create popup without default close button
             const popup = new mapboxgl.Popup({
                 offset: 25,
                 closeButton: false, // Use our custom close button
                 closeOnClick: false  // Don't close when clicking outside
             }).setDOMContent(popupContent);
            
            // Add marker to map
            const marker = new mapboxgl.Marker(markerEl)
                .setLngLat(file.coordinates)
                .setPopup(popup)
                .addTo(map);
            
            mediaMarkers.push(marker);
        }
    });

    syncPinNrLabels();
    
    // Show feedback
    logActivity(`📷 Showing ${stats.filesWithCoordsCount} noexif geotagging media files on map`, 'info');
}

function computeCombinedBounds() {
    const bounds = new mapboxgl.LngLatBounds();
    let hasAny = false;
    // GPX
    if (gpxTrack && gpxTrack.tracks && gpxTrack.tracks[0] && Array.isArray(gpxTrack.tracks[0].points)) {
        gpxTrack.tracks[0].points.forEach(p => {
            if (p && typeof p.lon === 'number' && typeof p.lat === 'number') {
                bounds.extend([p.lon, p.lat]);
                hasAny = true;
            }
        });
    }
    // Media files with coordinates
    mediaFiles.forEach(f => {
        if (Array.isArray(f.coordinates) && f.coordinates.length === 2) {
            bounds.extend(f.coordinates);
            hasAny = true;
        }
    });
    return hasAny ? bounds : null;
}

// Update map bounds to include all media files and GPX data
function updateMapBounds() {
    const bounds = computeCombinedBounds();
    if (bounds) {
        map.fitBounds(bounds, {
            padding: 50,
            duration: 1000
        });
    }
}

// Hide all media pins (for mode switching)
function hideMediaPins() {
    mediaMarkers.forEach(marker => marker.remove());
    mediaMarkers = [];
}

// Clear all position markers
function clearPositionMarkers() {
    positionMarkers.forEach(marker => {
        if (marker) marker.remove();
    });
    positionMarkers = [];
    syncPinNrLabels();
}

// Refresh the entire map view by updating all markers
function refreshMapView() {
    if (currentMode === 'assign') {
        // Assign mode: show position markers (crosses), hide media pins
        showPositionMarkers();
        hideMediaPins();
    } else {
        // View mode: show media pins, hide position markers
        showMediaPins();
        hidePositionMarkers();
    }
}

// Show all position markers (normal pins)
function showPositionMarkers() {
    // Only show position markers if in assign mode
    if (currentMode === 'assign') {
        // Clear existing markers first to ensure proper updates
        hidePositionMarkers();
        
        // Create/update markers for all files with coordinates
        mediaFiles.forEach((mediaFile, index) => {
            if (mediaFile.coordinates) {
                updatePositionMarker(index, mediaFile.coordinates);
            }
        });
        syncPinNrLabels();
    }
}

// Hide all position markers (normal pins)
function hidePositionMarkers() {
    positionMarkers.forEach(marker => {
        if (marker) marker.remove();
    });
    positionMarkers = [];
}

// Calculate media statistics (reusable function to avoid redundancy)
function calculateMediaStats() {
    const totalFiles = mediaFiles.length;
    const filesWithCoords = mediaFiles.filter(f => f.coordinates !== null);
    const filesWithCoordsCount = filesWithCoords.length;
    const filesWithElevation = mediaFiles.filter(f => f.elevation !== null).length;
    const imageCount = mediaFiles.filter(f => f.type === 'image').length;
    const videoCount = mediaFiles.filter(f => f.type === 'video').length;
    
    return {
        totalFiles,
        filesWithCoords,
        filesWithCoordsCount,
        filesWithElevation,
        imageCount,
        videoCount
    };
}



// Update statistics display
function updateStats() {
    const stats = calculateMediaStats();
    
    document.getElementById('total-count').textContent = stats.totalFiles;
    document.getElementById('coord-count').textContent = stats.filesWithCoordsCount;
    document.getElementById('elevation-count').textContent = stats.filesWithElevation;
}

// Build one media list entry: EXIF GPS if present, else coords stay null (noexif / GPX / manual).
async function createMediaFileEntry(file) {
    const isImage = file.type.startsWith('image/');
    const isVideo = file.type.startsWith('video/');
    if (!isImage && !isVideo) return null;

    const dateTaken = FilenameDateParser.parse(file.name);
    if (dateTaken) {
        const dateStr = dateTaken.toISOString().slice(0, 19).replace('T', ' ');
        logActivity(`📅 ${file.name}: date found from filename - ${dateStr}`, 'info');
    } else {
        logActivity(`⚠️ ${file.name}: no date found in filename - will be available for manual coordinate assignment only`, 'warning');
    }

    let coordinates = null;
    let elevation = null;
    let coordSource = null;

    if (isImage) {
        const gps = await ExifGpsReader.read(file);
        if (gps && gps.coordinates) {
            coordinates = gps.coordinates;
            elevation = gps.elevation;
            coordSource = 'exif';
            const elevInfo = elevation !== null && elevation !== undefined ? ` elev ${Math.round(elevation)}m` : '';
            logActivity(`📍 ${file.name}: EXIF GPS ${coordinates[1].toFixed(6)}, ${coordinates[0].toFixed(6)}${elevInfo}`, 'success');
        }
    }

    return {
        filename: file.name,
        type: isImage ? 'image' : 'video',
        path: URL.createObjectURL(file),
        coordinates: coordinates,
        elevation: elevation,
        coordSource: coordSource,
        timeDiffSeconds: null,
        file: file,
        dateTaken: dateTaken,
        dateTakenLocal: dateTaken ? new Date(dateTaken.getTime() + CEST_OFFSET_MS) : null
    };
}

// Format absolute seconds as mm:ss (minutes may exceed 59)
function formatTimeDiffMmSs(totalSeconds) {
    const sec = Math.max(0, Math.round(Math.abs(totalSeconds)));
    const mm = Math.floor(sec / 60);
    const ss = sec % 60;
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function finalizeMediaLoad(fileData) {
    mediaFiles = fileData
        .filter(file => file !== null)
        .sort(sortMediaFilesByDateTaken);

    populateFileList();

    const stats = calculateMediaStats();
    updateStats();
    logActivity(`📁 Loaded ${stats.totalFiles} files (${stats.imageCount} images, ${stats.videoCount} videos)`, 'info');

    const exifCount = mediaFiles.filter(f => f.coordSource === 'exif').length;
    if (exifCount > 0) {
        logActivity(`📍 Used EXIF GPS for ${exifCount} file(s); remaining use filename + GPX / manual`, 'info');
        mediaFiles.forEach((mediaFile, index) => {
            if (mediaFile.coordinates) {
                updatePositionMarker(index, mediaFile.coordinates);
            }
        });
        updateMapBounds();
    }

    if (gpxTrack) {
        logActivity(`🎯 GPX track detected - triggering auto-matching for files without coordinates`, 'info');
    }
    runAutoMatchingIfReady();
    refreshMapView();
}

// Handle file selection
function handleFileSelection(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;

    Promise.all(files.map(createMediaFileEntry)).then(finalizeMediaLoad);
}

// (no-op) local time conversion is handled by shared parser + CEST offset application above

// Helper function to format time range for display
function formatTimeRange(startTime, endTime) {
    // Use ISO strings converted to wall strings without constructing new Date objects for UI
    const startStr = isoToWallString(typeof startTime === 'string' ? startTime : startTime.toISOString());
    const endStr = isoToWallString(typeof endTime === 'string' ? endTime : endTime.toISOString());
    const sameDay = startStr.split(' ')[0] === endStr.split(' ')[0];
    return sameDay ? `${startStr} - ${endStr.split(' ')[1]}` : `${startStr} - ${endStr}`;
}

// Convert ISO string like 2025-08-04T13:27:44Z into dd/mm/yyyy HH:MM (wall time from tokens)
function isoToWallString(iso) {
    // Convert ISO (UTC) to local wall time string using fixed project offset (CEST)
    try {
        const utc = new Date(iso);
        if (isNaN(utc.getTime())) return iso;
        const localMs = utc.getTime() + CEST_OFFSET_MS;
        const adj = new Date(localMs);
        const pad = (n) => n.toString().padStart(2, '0');
        const day = pad(adj.getUTCDate());
        const month = pad(adj.getUTCMonth() + 1);
        const year = adj.getUTCFullYear();
        const hour = pad(adj.getUTCMinutes() >= 0 ? adj.getUTCHours() : adj.getUTCHours());
        const minute = pad(adj.getUTCMinutes());
        return `${day}/${month}/${year} ${hour}:${minute}`;
    } catch (e) {
        return iso;
    }
}



// Helper function to find nearest GPX track point and extract elevation
// Uses ELEVATION_DISTANCE_THRESHOLD global constant (default: 5 meters)
function findNearestGpxElevation(coordinates, thresholdMeters = ELEVATION_DISTANCE_THRESHOLD) {
    if (!gpxTrack || !gpxTrack.tracks || gpxTrack.tracks.length === 0) {
        return { elevation: null, reason: 'no_gpx_track' };
    }
    
    const trackPoints = gpxTrack.tracks[0].points;
    if (trackPoints.length === 0) {
        return { elevation: null, reason: 'no_track_points' };
    }
    
    let nearestPoint = null;
    let smallestDistance = Infinity;
    
    // Calculate distance to each track point
    trackPoints.forEach(point => {
        if (point.lat === null || point.lon === null) return;
        
        // Simple distance calculation (approximate, good enough for 5m threshold)
        const latDiff = coordinates[1] - point.lat;
        const lonDiff = coordinates[0] - point.lon;
        const distance = Math.sqrt(latDiff * latDiff + lonDiff * lonDiff);
        
        if (distance < smallestDistance) {
            smallestDistance = distance;
            nearestPoint = point;
        }
    });
    
    if (!nearestPoint) {
        return { elevation: null, reason: 'no_valid_points' };
    }
    
    // Convert distance to meters (rough approximation: 1° ≈ 111,000m)
    const distanceMeters = smallestDistance * 111000;
    
    if (distanceMeters <= thresholdMeters) {
        return { 
            elevation: nearestPoint.elevation, 
            reason: 'success',
            distance: distanceMeters
        };
    } else {
        return { 
            elevation: null, 
            reason: 'distance_threshold',
            distance: distanceMeters,
            nearestPoint: nearestPoint
        };
    }
}

// Filename date parsing moved to shared module: js/filename-date-parser.js

// Handle GPX file selection
function handleGpxSelection(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const gpxText = e.target.result;
            const gpxData = parseGpx(gpxText);
            
            if (gpxData.tracks.length > 0) {
                gpxTrack = gpxData;
                displayGpxTrack(gpxData);
                
                // Auto-assign coordinates based on timestamp matching (now centralized)
                runAutoMatchingIfReady();
                
                // Update map bounds to include GPX track
                updateMapBounds();
                
                // Refresh map view to show updated markers
                refreshMapView();
                
                // Show feedback with more detailed info
                const trackName = gpxData.tracks[0].name || 'Unnamed track';
                logActivity(`🗺️ GPX track loaded: ${trackName} (${gpxData.tracks[0].points.length} points)`, 'info');
                
                // Debug: Show first and last timestamps from GPX (string-based to avoid timezone shifts)
                const pointsWithTime = gpxData.tracks[0].points.filter(p => p.time);
                if (pointsWithTime.length > 0) {
                    const firstIso = pointsWithTime[0].time;
                    const lastIso = pointsWithTime[pointsWithTime.length - 1].time;
                    const firstStr = isoToWallString(firstIso);
                    const lastStr = isoToWallString(lastIso);
                    const sameDay = firstStr.split(' ')[0] === lastStr.split(' ')[0];
                    const timeRangeStr = sameDay ? `${firstStr} - ${lastStr.split(' ')[1]}` : `${firstStr} - ${lastStr}`;
                    logActivity(`⏰ Track time range: ${timeRangeStr}`, 'info');
                }
            } else {
                throw new Error('No tracks found in GPX file');
            }
        } catch (error) {
            logActivity(`❌ Error loading GPX file: ${error.message}`, 'warning');
        }
    };
    
    reader.readAsText(file);
    
    // Clear the file input value so the same file can be selected again
    // This fixes the browser limitation where change event doesn't fire for same file
    event.target.value = '';
}

// Auto-assign coordinates from GPX track based on timestamp matching
function autoAssignCoordinatesFromGpx(gpxData) {
    if (!gpxData.tracks || gpxData.tracks.length === 0) {
        return;
    }
    
    const trackPoints = gpxData.tracks[0].points;
    let assignedCount = 0;
    let dateMismatchCount = 0;
    let timeThresholdCount = 0;
    
    // Filter track points that have timestamps
    const pointsWithTime = trackPoints.filter(point => point.time);
    
    if (pointsWithTime.length === 0) {
        logActivity('⚠️ GPX track has no timestamps - cannot auto-assign coordinates', 'warning');
        return;
    }
    
    // Debug: Show first GPX timestamp and timezone info
    if (pointsWithTime.length > 0) {
        const firstGpxTime = new Date(pointsWithTime[0].time);
        const photoOffset = FilenameDateParser.DEFAULT_ASSUME_OFFSET_MINUTES;
        const tzSign = gpxTimezoneOffsetMinutes >= 0 ? '+' : '';
        const tzHours = Math.floor(Math.abs(gpxTimezoneOffsetMinutes) / 60);
        const tzMinutes = Math.abs(gpxTimezoneOffsetMinutes) % 60;
        const gpxTzStr = `UTC${tzSign}${tzHours.toString().padStart(2, '0')}:${tzMinutes.toString().padStart(2, '0')}`;
        const photoTzStr = `UTC${photoOffset >= 0 ? '+' : ''}${(photoOffset / 60).toFixed(0).padStart(2, '0')}:${Math.abs(photoOffset % 60).toString().padStart(2, '0')}`;
        
        // Show conversion example
        const gpxLocalTime = new Date(firstGpxTime.getTime() + gpxTimezoneOffsetMinutes * 60 * 1000);
        const gpxInPhotoFormat = new Date(firstGpxTime.getTime() + gpxTimezoneOffsetMinutes * 60 * 1000 - photoOffset * 60 * 1000);
        logActivity(`🔍 Matching: GPX ${gpxTzStr}, Photos ${photoTzStr}`, 'info');
        logActivity(`🔍 First GPX: ${firstGpxTime.toISOString()} UTC → ${gpxLocalTime.toISOString().slice(11, 19)} local (${gpxTzStr}) → ${gpxInPhotoFormat.toISOString()} (photo format)`, 'info');
    }
    
    // Process each media file (skip files that already have coords, e.g. from EXIF)
    mediaFiles.forEach((mediaFile, index) => {
        if (mediaFile.coordinates) {
            return;
        }

        if (!mediaFile.dateTaken) {
            // Skip files without dates
            return;
        }

        // Find the closest matching track point by time
        const result = findClosestTrackPointByTime(mediaFile.dateTaken, pointsWithTime);
        
        if (result && result.point && result.reason === 'success') {
            // Assign coordinates and elevation to the media file
            mediaFiles[index].coordinates = [result.point.lon, result.point.lat];
            mediaFiles[index].elevation = result.point.elevation; // Store elevation if available
            mediaFiles[index].coordSource = 'gpx';
            mediaFiles[index].timeDiffSeconds = result.timeDiffSeconds;
            assignedCount++;
            
            const elevationInfo = result.point.elevation ? ` at ${result.point.elevation}m` : '';
            logActivity(`✖ Auto-assigned coords to ${mediaFile.filename} (time-diff ${formatTimeDiffMmSs(result.timeDiffSeconds)})${elevationInfo}`, 'success');
        } else if (result && result.reason === 'date_mismatch') {
            dateMismatchCount++;
            logActivity(`⚠️ ${mediaFile.filename}: date mismatch with GPX track`, 'warning');
        } else if (result && result.reason === 'time_threshold') {
            timeThresholdCount++;
            const td = result.timeDiffSeconds != null ? ` (time-diff ${formatTimeDiffMmSs(result.timeDiffSeconds)})` : '';
            logActivity(`⚠️ ${mediaFile.filename}: time difference exceeds ${GPX_TIME_THRESHOLD}s threshold${td}`, 'warning');
        } else if (result && result.reason === 'no_match') {
            const mediaDateStr = mediaFile.dateTaken.toISOString().slice(0, 19).replace('T', ' ');
            // Debug: Show what we're looking for
            if (pointsWithTime.length > 0) {
                const firstGpx = new Date(pointsWithTime[0].time);
                const lastGpx = new Date(pointsWithTime[pointsWithTime.length - 1].time);
                logActivity(`ℹ️ ${mediaFile.filename}: no match (media: ${mediaDateStr} UTC, GPX range: ${firstGpx.toISOString().slice(0, 19)} - ${lastGpx.toISOString().slice(0, 19)} UTC)`, 'info');
            } else {
                logActivity(`ℹ️ ${mediaFile.filename}: no matching GPX track point found (media date: ${mediaDateStr})`, 'info');
            }
        }
    });

    // EXIF-placed files: attach GPX↔photo time-diff (no coordinate overwrite)
    let exifTimeDiffCount = 0;
    mediaFiles.forEach((mediaFile, index) => {
        if (mediaFile.coordSource !== 'exif' || !mediaFile.dateTaken) return;
        const result = findClosestTrackPointByTime(mediaFile.dateTaken, pointsWithTime);
        if (result && result.timeDiffSeconds != null) {
            mediaFiles[index].timeDiffSeconds = result.timeDiffSeconds;
            exifTimeDiffCount++;
            logActivity(`📍 ${mediaFile.filename}: EXIF GPS time-diff ${formatTimeDiffMmSs(result.timeDiffSeconds)}`, 'info');
        }
    });
    
    // Update UI after assignments / EXIF time-diff attach
    if (assignedCount > 0 || exifTimeDiffCount > 0) {
        populateFileList();
        updateStats();
        
        // Update position markers (pins) for newly assigned coordinates
        mediaFiles.forEach((mediaFile, index) => {
            if (mediaFile.coordinates && !positionMarkers[index]) {
                updatePositionMarker(index, mediaFile.coordinates);
            }
        });
        
        if (assignedCount > 0) {
            logActivity(`🎯 Auto-assigned coordinates to ${assignedCount} media files from GPX track (left EXIF / existing coords untouched)`, 'success');
            updateMapBounds();
            refreshMapView();
        }
    }
    
    // Log exclusions
    if (dateMismatchCount > 0) {
        logActivity(`⚠️ ${dateMismatchCount} media files excluded due to date mismatch with GPX track`, 'warning');
    }
    if (timeThresholdCount > 0) {
        logActivity(`⚠️ ${timeThresholdCount} media files excluded due to time difference exceeding ${GPX_TIME_THRESHOLD} second threshold`, 'warning');
    }
}

// Find the closest track point by timestamp
function findClosestTrackPointByTime(mediaDate, trackPoints) {
    let closestPoint = null;
    let smallestDiff = Infinity;
    
    // Convert GPX timezone offset from minutes to milliseconds
    const gpxTimezoneOffsetMs = gpxTimezoneOffsetMinutes * 60 * 1000;
    
    trackPoints.forEach((point, index) => {
        if (!point.time) return;
        
        const trackTimeUTC = new Date(point.time);
        
        // GPX timestamps are in UTC. Photo times are stored as UTC but represent local time.
        // Example:
        // - Photo filename "10:40" in UTC+2 (CEST) → stored as 08:40 UTC (10:40 - 2h)
        // - GPX "09:40 UTC" recorded in UTC+1 (CET) → represents 10:40 local (09:40 + 1h)
        // 
        // To match: Convert GPX UTC to local time, then convert to photo's UTC format
        // GPX local time = GPX UTC + gpxOffset
        // GPX in photo format = GPX local - photoOffset = GPX UTC + gpxOffset - photoOffset
        
        // Get photo timezone offset (default from filename parser, in minutes)
        const photoTimezoneOffsetMs = FilenameDateParser.DEFAULT_ASSUME_OFFSET_MINUTES * 60 * 1000;
        
        // Convert GPX UTC to local time (add GPX offset), then to photo's UTC format (subtract photo offset)
        // This gives us the GPX time in the same format as photo times
        const gpxInPhotoFormat = trackTimeUTC.getTime() + gpxTimezoneOffsetMs - photoTimezoneOffsetMs;
        const trackTimeAdjusted = new Date(gpxInPhotoFormat);
        
        // Extract date components for comparison (using UTC methods since both are in UTC format)
        const mediaYear = mediaDate.getUTCFullYear();
        const mediaMonth = mediaDate.getUTCMonth();
        const mediaDay = mediaDate.getUTCDate();
        const trackYear = trackTimeAdjusted.getUTCFullYear();
        const trackMonth = trackTimeAdjusted.getUTCMonth();
        const trackDay = trackTimeAdjusted.getUTCDate();
        
        // Check if dates are different (different calendar days)
        if (mediaYear !== trackYear || mediaMonth !== trackMonth || mediaDay !== trackDay) {
            // Different dates - exclude this point
            return;
        }
        
        // Compare the times directly (both in photo's UTC format)
        const mediaTimeUTC = mediaDate.getTime();
        const trackTimeAdjustedUTC = trackTimeAdjusted.getTime();
        
        const timeDiff = Math.abs(mediaTimeUTC - trackTimeAdjustedUTC);
        
        if (timeDiff < smallestDiff) {
            smallestDiff = timeDiff;
            closestPoint = point;
        }
    });
    
    // Check if we found a point and if it meets the time threshold (now in seconds)
    if (closestPoint) {
        const timeDiffSeconds = smallestDiff / 1000;
        if (smallestDiff <= GPX_TIME_THRESHOLD * 1000) { // Convert seconds to milliseconds
            return { point: closestPoint, reason: 'success', timeDiffSeconds };
        }
        return { point: closestPoint, reason: 'time_threshold', timeDiffSeconds };
    }
    
    return { reason: 'no_match' };
}

// Parse GPX file content
function parseGpx(gpxText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(gpxText, 'text/xml');
    
    const tracks = [];
    const trackElements = xmlDoc.getElementsByTagName('trk');
    
    for (let i = 0; i < trackElements.length; i++) {
        const track = trackElements[i];
        const trackName = track.getElementsByTagName('name')[0]?.textContent || `Track ${i + 1}`;
        
        const segments = [];
        const segmentElements = track.getElementsByTagName('trkseg');
        
        for (let j = 0; j < segmentElements.length; j++) {
            const segment = segmentElements[j];
            const points = [];
            const pointElements = segment.getElementsByTagName('trkpt');
            
            for (let k = 0; k < pointElements.length; k++) {
                const point = pointElements[k];
                const lat = parseFloat(point.getAttribute('lat'));
                const lon = parseFloat(point.getAttribute('lon'));
                const time = point.getElementsByTagName('time')[0]?.textContent;
                const elevation = point.getElementsByTagName('ele')[0]?.textContent;
                
                if (!isNaN(lat) && !isNaN(lon)) {
                    points.push({
                        lat: lat,
                        lon: lon,
                        time: time,
                        elevation: elevation ? parseFloat(elevation) : null
                    });
                }
            }
            
            if (points.length > 0) {
                segments.push(points);
            }
        }
        
        if (segments.length > 0) {
            tracks.push({
                name: trackName,
                segments: segments,
                points: segments.flat() // Flatten all segments into one array
            });
        }
    }
    
    return { tracks: tracks };
}

// Display GPX track on the map
function displayGpxTrack(gpxData) {
    // Remove existing track if any (automatic overwrite)
    if (map.getSource('gpx-track')) {
        map.removeLayer('gpx-track-layer');
        map.removeSource('gpx-track');
    }
    
    if (gpxData.tracks.length === 0) return;
    
    const track = gpxData.tracks[0];
    const coordinates = track.points.map(point => [point.lon, point.lat]);
    
    // Add track source
    map.addSource('gpx-track', {
        type: 'geojson',
        data: {
            type: 'Feature',
            properties: {},
            geometry: {
                type: 'LineString',
                coordinates: coordinates
            }
        }
    });
    
    // Add track layer using centralized style
    map.addLayer({
        id: 'gpx-track-layer',
        type: 'line',
        source: 'gpx-track',
        layout: STYLE_GPX_LINE.layout,
        paint: STYLE_GPX_LINE.paint
    });
    
    // Update map bounds to include both GPX track and media files
    updateMapBounds();
}

// Hide control panel
function hidePanel() {
    const panel = document.getElementById('control-panel');
    const showBtn = document.getElementById('show-panel');
    
    panel.style.transform = 'translate(-100%, -100%)';
    
    // Fade in the show button
    setTimeout(() => {
        showBtn.style.opacity = '1';
        showBtn.style.pointerEvents = 'auto';
    }, 200); // Start fading in halfway through panel animation
}

// Show control panel
function showPanel() {
    const panel = document.getElementById('control-panel');
    const showBtn = document.getElementById('show-panel');
    
    // Fade out the show button immediately
    showBtn.style.opacity = '0';
    showBtn.style.pointerEvents = 'none';
    
    panel.style.transform = 'translate(0, 0)';
}



// Add map controls
map.addControl(new mapboxgl.FullscreenControl());
map.addControl(new mapboxgl.ScaleControl({
    maxWidth: 80,
    unit: 'metric'
}));

// Add geocoder search control to panel
const geocoder = new MapboxGeocoder({
    accessToken: mapboxgl.accessToken,
    mapboxgl: mapboxgl,
    placeholder: 'Search for a location...',
    countries: null, // Global search (no country restriction)
    language: 'en',
    marker: false, // Don't add a marker when searching
    flyTo: {
        speed: 1.2
    }
});

// Add geocoder to the panel container
document.getElementById('geocoder-container').appendChild(geocoder.onAdd(map));

// Download all noexif geotagging media photos as a zip file
async function downloadAllNoexifGeotaggingMediaPhotos() {
    const stats = calculateMediaStats();
    const filesWithCoords = stats.filesWithCoords.filter(f => f.type === 'image');
    
    if (filesWithCoords.length === 0) {
        logActivity('⚠️ No noexif geotagging media photos found. Please assign coordinates first.', 'warning');
        return;
    }
    
    // Show loading state
    const downloadBtn = document.getElementById('download-all-btn');
    const originalText = downloadBtn.textContent;
    downloadBtn.textContent = 'Processing...';
    downloadBtn.disabled = true;
    
    try {
        const zip = new JSZip();
        let processedCount = 0;
        
        // Add map screenshot if available
        try {
            const mapScreenshot = await captureMapScreenshot();
            if (mapScreenshot) {
                zip.file('map_overview.jpg', mapScreenshot);
            }
        } catch (error) {
            console.log('Map screenshot failed:', error);
        }

        
        // Process each image with coordinates
        for (const file of filesWithCoords) {
            try {
                const noexifGeotaggingMediaBlob = await processImageWithGPS(file.file, file.coordinates);
                
                if (noexifGeotaggingMediaBlob && noexifGeotaggingMediaBlob.size > 0) {
                    // Build filename with coordinates and elevation if available
                    let filename = `noexif_media_${file.filename.replace(/\.[^/.]+$/, '')}___${file.coordinates[0].toFixed(6)}_${file.coordinates[1].toFixed(6)}___`;
                    
                    // Add elevation if available
                    if (file.elevation !== null && file.elevation !== undefined) {
                        filename += `elev__${Math.round(file.elevation)}__`;
                    }
                    
                    filename += '.jpg';
                    zip.file(filename, noexifGeotaggingMediaBlob);
                    processedCount++;
                }
                
                // Update progress
                downloadBtn.textContent = `Processing... (${processedCount}/${filesWithCoords.length})`;
            } catch (error) {
                // Continue with next file
            }
        }
        
        if (processedCount === 0) {
            logActivity('❌ No files were successfully processed', 'warning');
            return;
        }
        
        // Generate and download zip file
        const zipBlob = await zip.generateAsync({type: 'blob'});
        
        const downloadLink = document.createElement('a');
        downloadLink.href = URL.createObjectURL(zipBlob);
        downloadLink.download = `noexif_geotagging_media_photos_${new Date().toISOString().slice(0, 10)}.zip`;
        downloadLink.click();
        
        // Clean up
        URL.revokeObjectURL(downloadLink.href);
        
        logActivity(`✅ Successfully downloaded ${processedCount} noexif geotagging media photos!`, 'success');
        
    } catch (error) {
        logActivity('❌ Error creating zip file. Please try again.', 'warning');
    } finally {
        // Reset button state
        downloadBtn.textContent = originalText;
        downloadBtn.disabled = false;
    }
}

// Process image with GPS coordinates and return blob
function processImageWithGPS(file, coords) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            try {
                const arrayBuffer = e.target.result;
                const view = new DataView(arrayBuffer);
                
                // Check if it's a JPEG file
                const isJpeg = view.getUint16(0, false) === 0xFFD8;
                
                if (isJpeg) {
                    // Handle JPEG files
                    processJpegForZip(arrayBuffer, coords).then(resolve).catch(reject);
                } else {
                    // Convert other image formats to JPEG
                    convertToJpegForZip(arrayBuffer, file, coords).then(resolve).catch(reject);
                }
                
            } catch (error) {
                reject(error);
            }
        };
        
        reader.onerror = () => {
            reject(new Error('FileReader error'));
        };
        reader.readAsArrayBuffer(file);
    });
}

// Process JPEG files for zip (coordinates in filename only)
async function processJpegForZip(arrayBuffer, coords) {
    const blob = new Blob([arrayBuffer], { type: 'image/jpeg' });
    return blob;
}

// Convert other image formats to JPEG for zip
function convertToJpegForZip(arrayBuffer, file, coords) {
    return new Promise((resolve, reject) => {
        // Create canvas to convert image to JPEG
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const img = new Image();
        
        img.onload = function() {
            // Set canvas size to image size
            canvas.width = img.width;
            canvas.height = img.height;
            
            // Draw image on canvas
            ctx.drawImage(img, 0, 0);
            
            // Convert to JPEG with GPS coordinates
            canvas.toBlob(function(blob) {
                // Add GPS data to the JPEG
                addGpsToJpegBlob(blob, coords).then(resolve).catch(reject);
            }, 'image/jpeg', 0.9);
        };
        
        img.onerror = () => reject(new Error('Image loading error'));
        
        // Convert ArrayBuffer to blob and create image
        const blob = new Blob([arrayBuffer], { type: file.type });
        img.src = URL.createObjectURL(blob);
    });
}

// Add GPS data to JPEG blob (coordinates in filename only)
async function addGpsToJpegBlob(blob, coords) {
    return blob;
}

// Prevent default drag and drop behavior
function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

// Handle media file drop
function handleMediaDrop(e) {
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    Promise.all(files.map(createMediaFileEntry)).then(finalizeMediaLoad);
}

// Handle GPX file drop
function handleGpxDrop(e) {
    const file = e.dataTransfer.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const gpxText = e.target.result;
            const gpxData = parseGpx(gpxText);
            
            if (gpxData.tracks.length > 0) {
                gpxTrack = gpxData;
                displayGpxTrack(gpxData);
                
                // Auto-assign coordinates based on timestamp matching
                autoAssignCoordinatesFromGpx(gpxData);
                
                // Refresh map view to show updated markers
                refreshMapView();
                
                // Show feedback with more detailed info
                const trackName = gpxData.tracks[0].name || 'Unnamed track';
                logActivity(`🗺️ GPX track loaded: ${trackName} (${gpxData.tracks[0].points.length} points)`, 'info');
                
                // Debug: Show first and last timestamps from GPX (string-based to avoid timezone shifts)
                const pointsWithTime = gpxData.tracks[0].points.filter(p => p.time);
                if (pointsWithTime.length > 0) {
                    const firstIso = pointsWithTime[0].time;
                    const lastIso = pointsWithTime[pointsWithTime.length - 1].time;
                    const firstStr = isoToWallString(firstIso);
                    const lastStr = isoToWallString(lastIso);
                    const sameDay = firstStr.split(' ')[0] === lastStr.split(' ')[0];
                    const timeRangeStr = sameDay ? `${firstStr} - ${lastStr.split(' ')[1]}` : `${firstStr} - ${lastStr}`;
                    logActivity(`⏰ Track time range: ${timeRangeStr}`, 'info');
                }
            } else {
                throw new Error('No tracks found in GPX file');
            }
        } catch (error) {
            logActivity(`❌ Error loading GPX file: ${error.message}`, 'warning');
        }
    };
    
    reader.readAsText(file);
}

// Initialize when map loads
map.on('load', initApp);

// Capture map screenshot using Mapbox's native canvas
async function captureMapScreenshot() {
    try {
        // First fit bounds to show all content
        const bounds = computeCombinedBounds();
        if (bounds) {
            map.fitBounds(bounds, { padding: 50, duration: 1000 });
            
            // Wait for the map to finish moving
            await new Promise(resolve => {
                map.once('moveend', resolve);
            });
            
            // Wait a bit more for tiles to load
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        // Create a static map image using Mapbox Static API
        if (bounds) {
            // Use reasonable dimensions (Mapbox has limits)
            const width = Math.min(1200, map.getCanvas().width);
            const height = Math.min(800, map.getCanvas().height);
            
            // Build aspect-corrected bounds using Web Mercator to avoid stretching
            const buffer = 0.001; // small degree buffer (~100m)
            const degBounds = {
                west: bounds.getWest() - buffer,
                south: bounds.getSouth() - buffer,
                east: bounds.getEast() + buffer,
                north: bounds.getNorth() + buffer
            };

            // Mercator helpers in normalized [0,1] tile space
            const lonToX = (lon) => (lon + 180) / 360;
            const latToY = (lat) => {
                const a = Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2);
                const y = (1 - Math.log(a) / Math.PI) / 2;
                return Math.min(1, Math.max(0, y));
            };
            const xToLon = (x) => x * 360 - 180;
            const yToLat = (y) => {
                const n = Math.PI * (1 - 2 * y);
                return (180 / Math.PI) * Math.atan(Math.sinh(n));
            };

            const xW = lonToX(degBounds.west);
            const xE = lonToX(degBounds.east);
            const yN = latToY(degBounds.north);
            const yS = latToY(degBounds.south);
            let dx = xE - xW;
            let dy = yS - yN; // y increases downward
            const imgAspect = (width * 2) / (height * 2);
            const boxAspect = dx / dy;
            let effXW = xW, effXE = xE, effYN = yN, effYS = yS;
            if (isFinite(dx) && isFinite(dy) && dx > 0 && dy > 0) {
                if (boxAspect > imgAspect) {
                    // too wide -> expand vertical span
                    const cy = (yN + yS) / 2;
                    const dyEff = dx / imgAspect;
                    effYN = cy - dyEff / 2;
                    effYS = cy + dyEff / 2;
                } else if (boxAspect < imgAspect) {
                    // too tall -> expand horizontal span
                    const cx = (xW + xE) / 2;
                    const dxEff = dy * imgAspect;
                    effXW = cx - dxEff / 2;
                    effXE = cx + dxEff / 2;
                }
            }
            const staticBounds = {
                west: xToLon(effXW),
                south: yToLat(effYS),
                east: xToLon(effXE),
                north: yToLat(effYN)
            };
            
            // Build static map URL using computed bounds with buffer
            const staticMapUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/` +
                `[${staticBounds.west},${staticBounds.south},${staticBounds.east},${staticBounds.north}]` +
                `/${width}x${height}@2x` +
                `?access_token=${mapboxgl.accessToken}`;

            

            // Fetch the base static map image
            const response = await fetch(staticMapUrl);
            if (response.ok) {
                const baseMapBlob = await response.blob();
                
                // Draw the base map first to get actual dimensions
                const img = new Image();
                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                    img.src = URL.createObjectURL(baseMapBlob);
                });
                
                // Use the ACTUAL image dimensions for coordinate conversion
                const actualWidth = img.width;
                const actualHeight = img.height;
                
                // Create a NEW canvas with the correct dimensions (don't resize existing one)
                const finalCanvas = document.createElement('canvas');
                const finalCtx = finalCanvas.getContext('2d');
                finalCanvas.width = actualWidth;
                finalCanvas.height = actualHeight;
                
                // Draw the image at full resolution on the new canvas
                finalCtx.drawImage(img, 0, 0, actualWidth, actualHeight);
                // (no debug overlays)
                
                // Draw GPX track
                if (gpxTrack && gpxTrack.tracks && gpxTrack.tracks[0]) {
                    const points = gpxTrack.tracks[0].points
                        .filter(p => typeof p.lon === 'number' && typeof p.lat === 'number');
                    
                    if (points.length > 1) {
                        // Use full-resolution GPX points (no simplification)
                        const coords = points.map(p => [p.lon, p.lat]);
                        
                        if (coords.length > 1) {
                            // Convert coordinates to canvas pixels using Web Mercator and effective bounds
                            const xWm2 = (staticBounds.west + 180) / 360;
                            const xEm2 = (staticBounds.east + 180) / 360;
                            const yNm2 = (1 - Math.log(Math.tan(Math.PI / 4 + (staticBounds.north * Math.PI / 180) / 2)) / Math.PI) / 2;
                            const ySm2 = (1 - Math.log(Math.tan(Math.PI / 4 + (staticBounds.south * Math.PI / 180) / 2)) / Math.PI) / 2;
                            const pixelCoords = coords.map(coord => {
                                const xm = (coord[0] + 180) / 360;
                                const ym = (1 - Math.log(Math.tan(Math.PI / 4 + (coord[1] * Math.PI / 180) / 2)) / Math.PI) / 2;
                                const x = ((xm - xWm2) / (xEm2 - xWm2)) * actualWidth;
                                const y = ((ym - yNm2) / (ySm2 - yNm2)) * actualHeight;
                                return [x, y];
                            });
                            
                            // Draw GPX line (thin dashed)
                            finalCtx.strokeStyle = '#ff9800';
                            finalCtx.lineWidth = 2;
                            finalCtx.setLineDash([4, 2]);
                            finalCtx.beginPath();
                            finalCtx.moveTo(pixelCoords[0][0], pixelCoords[0][1]);
                            for (let i = 1; i < pixelCoords.length; i++) {
                                finalCtx.lineTo(pixelCoords[i][0], pixelCoords[i][1]);
                            }
                            finalCtx.stroke();
                            finalCtx.setLineDash([]);
                        }
                    }
                }
                
                // Draw media pins + collision-aware nr labels (same layout as live map)
                // Use mediaFiles indices (not a filtered renumber) — past export bugs mixed these up.
                const xWm = (staticBounds.west + 180) / 360;
                const xEm = (staticBounds.east + 180) / 360;
                const yNm = (1 - Math.log(Math.tan(Math.PI / 4 + (staticBounds.north * Math.PI / 180) / 2)) / Math.PI) / 2;
                const ySm = (1 - Math.log(Math.tan(Math.PI / 4 + (staticBounds.south * Math.PI / 180) / 2)) / Math.PI) / 2;
                const pxScale = actualWidth / width; // @2x → ~2

                const pinPoints = [];
                mediaFiles.forEach((file, index) => {
                    if (!file.coordinates) return;
                    const coord = file.coordinates;
                    const xm = (coord[0] + 180) / 360;
                    const ym = (1 - Math.log(Math.tan(Math.PI / 4 + (coord[1] * Math.PI / 180) / 2)) / Math.PI) / 2;
                    pinPoints.push({
                        index,
                        x: ((xm - xWm) / (xEm - xWm)) * actualWidth,
                        y: ((ym - yNm) / (ySm - yNm)) * actualHeight
                    });
                });

                const laidPins = layoutPinNrPositions(pinPoints, { scale: pxScale });
                const pinRadius = 5 * pxScale;
                const labelFontPx = Math.round(12 * pxScale);

                laidPins.forEach((item) => {
                    // Small monochrome pin (no outline)
                    finalCtx.fillStyle = '#222222';
                    finalCtx.beginPath();
                    finalCtx.arc(item.pinX, item.pinY, pinRadius, 0, 2 * Math.PI);
                    finalCtx.fill();

                    // Nr at collision-offset position (halo instead of big outlined circle)
                    const nr = String(item.index + 1);
                    finalCtx.font = `bold ${labelFontPx}px Arial`;
                    finalCtx.textAlign = 'center';
                    finalCtx.textBaseline = 'middle';
                    finalCtx.lineWidth = 3 * pxScale;
                    finalCtx.strokeStyle = '#222222';
                    finalCtx.strokeText(nr, item.labelX, item.labelY);
                    finalCtx.fillStyle = '#ffffff';
                    finalCtx.fillText(nr, item.labelX, item.labelY);
                });
                
                // Convert final canvas to blob
                return new Promise(resolve => {
                    finalCanvas.toBlob(resolve, 'image/jpeg', 0.9);
                });
            } else {
                console.log('Static map failed with status:', response.status);
                const errorText = await response.text();
                console.log('Error details:', errorText);
                return null;
            }
        }
        
        // Fallback: return null if static map fails
        console.log('Static map generation failed');
        return null;
        
    } catch (error) {
        console.error('Screenshot capture failed:', error);
        return null;
    }
} 