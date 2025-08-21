// Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1IjoiZ2ltb3lhIiwiYSI6IkZrTld6NmcifQ.eY6Ymt2kVLvPQ6A2Dt9zAQ';

// Configurable thresholds and constants
const GPX_TIME_THRESHOLD = 60; // 60 seconds = 1 minute, for GPX auto-assignment
const ELEVATION_DISTANCE_THRESHOLD = 5; // 5 meters, for elevation lookup from GPX track

// Media files will be loaded dynamically from the file input
let mediaFiles = [];

// Initialize map with satellite imagery and labels
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [13.8, 47.6], // Center of Austria
    zoom: 8
});

// Global variables
let selectedFileIndex = -1;
let currentMode = 'assign';
let mediaMarkers = [];
let positionMarkers = []; // Store position markers for each file
let gpxTrack = null; // Store GPX track data

// Timezone offset constants (in milliseconds)
const CEST_OFFSET_MS = 2 * 60 * 60 * 1000; // +2 hours for CEST

// Centralized style objects for reuse (on-screen and export)
const STYLE_GPX_LINE = {
    layout: { 'line-join': 'round', 'line-cap': 'square' },
    paint: {
        'line-color': '#ffff00',
        'line-width': 2,
        'line-opacity': 1.0,
        'line-blur': 0.5,
        'line-dasharray': [1, 2]
    }
};

const STYLE_MEDIA_MARKER = {
    boxSizePx: 37.5,
    fontSizePx: 30,
    emojiImage: '📷',
    emojiVideo: '🎥',
    color: '#000000'
};

const STYLE_POSITION_MARKER = {
    boxSizePx: 28.5,
    fontSizePx: 22.8,
    emoji: '✖',
    color: '#e11d48'
};
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
    
    // Initialize with correct mode and pins
    toggleMode();
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
        
        fileItem.innerHTML = `
            <div class="file-info">
                <div class="file-id">${index + 1}</div>
                ${file.type === 'image' ? `<img src="${file.path}" class="file-thumbnail" alt="${file.filename}">` : `<div class="file-thumbnail video-thumbnail">🎥</div>`}
                <div class="file-details">
                    <div class="file-name">${file.filename}</div>
                    <div class="file-type">${file.type} • ${dateStr}</div>
                </div>
            </div>
            <div class="coordinate-status ${statusClass}">${statusText}</div>
        `;
        
        fileItem.addEventListener('click', () => selectFile(index));
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
        // Compact with seconds
        /(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})\b/,
        // Compact without seconds
        /(\d{4})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})\b/,
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
    // Remove previous selection
    document.querySelectorAll('.file-item').forEach(item => {
        item.classList.remove('selected');
    });
    
    // Add selection to clicked item
    document.querySelector(`[data-index="${index}"]`).classList.add('selected');
    selectedFileIndex = index;
    
    // Update coordinate display in the log instead of separate div
    const file = mediaFiles[index];
    if (file.coordinates) {
        logActivity(` Selected: ${file.filename} - Coordinates: ___${file.coordinates[0].toFixed(6)}, ${file.coordinates[1].toFixed(6)}___`, 'info');
    } else {
        logActivity(` Selected: ${file.filename} - No coordinates assigned yet`, 'info');
    }
}

// Toggle between assign and view modes
function toggleMode() {
    const assignMode = document.getElementById('assign-mode');
    const viewMode = document.getElementById('view-mode');
    
    if (currentMode === 'assign') {
        assignMode.style.display = 'block';
        viewMode.style.display = 'none';
        map.getCanvas().style.cursor = 'crosshair';
        
        // Assign mode: show position markers (normal pins), hide media pins
        showPositionMarkers();
        hideMediaPins();
    } else {
        assignMode.style.display = 'none';
        viewMode.style.display = 'block';
        map.getCanvas().style.cursor = 'grab';
        
        // View mode: show media pins, hide position markers
        showMediaPins();
        hidePositionMarkers();
        
        // Update stats when switching to view mode to ensure they're current
        updateStats();
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
    
    // Control panel buttons
    document.getElementById('hide-panel').addEventListener('click', hidePanel);
    document.getElementById('show-panel').addEventListener('click', showPanel);
    
    // File input change handlers (keep existing functionality)
    document.getElementById('media-files-input').addEventListener('change', handleFileSelection);
    document.getElementById('gpx-file-input').addEventListener('change', handleGpxSelection);
    
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
        
        // Update map bounds to include new coordinates
        updateMapBounds();
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
    markerEl.innerHTML = `${STYLE_POSITION_MARKER.emoji}<div style="position: absolute; top: -10px; right: -10px; background: #333; color: white; font-size: 12px; font-weight: bold; padding: 0; border-radius: 10px; min-width: 20px; text-align: center; line-height: 20px; z-index: 9999;">${fileIndex + 1}</div>`;
    markerEl.style.color = STYLE_POSITION_MARKER.color;
    markerEl.title = `Position for ${mediaFiles[fileIndex].filename}`;
    
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
            markerEl.innerHTML = `${file.type === 'image' ? STYLE_MEDIA_MARKER.emojiImage : STYLE_MEDIA_MARKER.emojiVideo}<div style="position: absolute; top: -8px; right: -8px; background: #333; color: white; font-size: 10px; font-weight: bold; padding: 0; border-radius: 8px; min-width: 16px; text-align: center; line-height: 16px; z-index: 9999;">${index + 1}</div>`;
            markerEl.title = file.filename;
            
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
    
    // Show feedback
    logActivity(`📷 Showing ${stats.filesWithCoordsCount} noexif geotagging media files on map`, 'info');
}

// Clear all media pins
function clearMediaPins() {
    mediaMarkers.forEach(marker => marker.remove());
    mediaMarkers = [];
    
    // Show feedback
    logActivity('🗑️ All media pins cleared', 'info');
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
    // Media
    if (Array.isArray(mediaFiles)) {
        mediaFiles.forEach(f => {
            if (Array.isArray(f.coordinates) && f.coordinates.length === 2) {
                bounds.extend(f.coordinates);
                hasAny = true;
            }
        });
    }
    return hasAny ? bounds : null;
}



// Approximate container size from bounds aspect ratio to produce a screenshot whose ratio matches data extent
// Target: 150 DPI output
function computeExportSizeFromBounds(bounds, baseWidth = 800) {
    const west = bounds.getWest();
    const east = bounds.getEast();
    const south = bounds.getSouth();
    const north = bounds.getNorth();
    const lonSpan = Math.max(0.000001, Math.abs(east - west));
    const latSpan = Math.max(0.000001, Math.abs(north - south));
    const meanLatRad = ((north + south) / 2) * Math.PI / 180;
    const mercatorAdjustedLonSpan = lonSpan * Math.cos(meanLatRad);
    const aspect = mercatorAdjustedLonSpan > 0 ? (latSpan / mercatorAdjustedLonSpan) : 1;
    
    // Calculate size for 150 DPI output
    // 150 DPI = 150 pixels per inch
    // 1 inch = 25.4 mm
    // For A4: 210mm x 297mm = 8.27" x 11.69" = 1240 x 1754 pixels at 150 DPI
    const targetDPI = 150;
    const width = baseWidth;
    const height = Math.max(400, Math.min(2000, Math.round(width * aspect)));
    
    return { width, height, targetDPI };
}

// Build an offscreen map with the same style and render GPX + media to a JPG blob using bounds-driven aspect ratio
function exportMapScreenshotBlobOffscreen() {
    return new Promise((resolve) => {
        try {
            const bounds = computeCombinedBounds();
            if (!bounds) { resolve(null); return; }
            const size = computeExportSizeFromBounds(bounds);
            const container = document.createElement('div');
            container.style.position = 'absolute';
            container.style.left = '-10000px';
            container.style.top = '-10000px';
            container.style.width = size.width + 'px';
            container.style.height = size.height + 'px';
            document.body.appendChild(container);

            const offMap = new mapboxgl.Map({
                container: container,
                style: 'mapbox://styles/mapbox/streets-v12',
                interactive: false,
                preserveDrawingBuffer: true,
                attributionControl: false,
                pixelRatio: size.targetDPI / 96 // Convert 150 DPI to device pixel ratio
            });

            const cleanup = () => {
                try { offMap.remove(); } catch (_) {}
                if (container && container.parentNode) container.parentNode.removeChild(container);
            };

            offMap.on('load', () => {
                try {
                    // Mirror satellite overlay from main map for identical base look
                    try {
                        offMap.addSource('satellite-overlay', {
                            type: 'raster',
                            url: 'mapbox://mapbox.satellite',
                            tiles: ['https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.png?access_token=' + mapboxgl.accessToken]
                        });
                        const firstLabelLayer = offMap.getStyle().layers.find(layer =>
                            layer.type === 'symbol' && layer.id.includes('label')
                        );
                        offMap.addLayer({
                            id: 'satellite-overlay',
                            type: 'raster',
                            source: 'satellite-overlay',
                            paint: { 'raster-opacity': 0.5 }
                        }, firstLabelLayer ? firstLabelLayer.id : undefined);
                    } catch (_) {}

                    // We will draw emoji markers directly onto the output canvas for exact visual match
                    // GPX layer if present
                    if (gpxTrack && gpxTrack.tracks && gpxTrack.tracks[0]) {
                        const coordinates = gpxTrack.tracks[0].points
                            .filter(p => typeof p.lon === 'number' && typeof p.lat === 'number')
                            .map(p => [p.lon, p.lat]);
                        if (coordinates.length > 1) {
                            offMap.addSource('gpx-track', {
                                type: 'geojson',
                                data: {
                                    type: 'Feature',
                                    properties: {},
                                    geometry: { type: 'LineString', coordinates }
                                }
                            });
                            offMap.addLayer({
                                id: 'gpx-track-layer',
                                type: 'line',
                                source: 'gpx-track',
                                layout: { 'line-join': 'round', 'line-cap': 'square' },
                                paint: {
                                    'line-color': '#ffff00',
                                    'line-width': 2,
                                    'line-opacity': 1.0,
                                    'line-blur': 0.5,
                                    'line-dasharray': [1, 2]
                                }
                            });
                        }
                    }

                    // Media pins using emoji icons to match view mode
                    const mediaFeatures = mediaFiles
                        .filter(f => Array.isArray(f.coordinates))
                        .map(f => ({
                            type: 'Feature',
                            geometry: { type: 'Point', coordinates: f.coordinates },
                            properties: { type: f.type || 'image' }
                        }));
                    // Do not add pins as Mapbox layers; we will paint them post-render onto a 2D canvas

                    // Recalculate bounds after map is loaded to ensure we have latest coordinates
                    const currentBounds = computeCombinedBounds();
                    if (currentBounds) {
                        offMap.fitBounds(currentBounds, { padding: 50, duration: 0 });
                    }
                    
                    const onIdle = () => {
                        offMap.off('idle', onIdle);
                        try {
                            const glCanvas = offMap.getCanvas();
                            const outCanvas = document.createElement('canvas');
                            outCanvas.width = glCanvas.width;
                            outCanvas.height = glCanvas.height;
                            const ctx2d = outCanvas.getContext('2d');
                            ctx2d.drawImage(glCanvas, 0, 0);
                            // Draw media markers as circles instead of emojis for consistent sizing
                            // Use target DPI for consistent output resolution
                            const targetDPI = size.targetDPI;
                            const deviceRatio = targetDPI / 96; // 96 DPI is standard screen DPI
                            ctx2d.setTransform(deviceRatio, 0, 0, deviceRatio, 0, 0);
                            
                            mediaFeatures.forEach((f, index) => {
                                const p = offMap.project(f.geometry.coordinates);
                                
                                // Draw marker circle (60% of original size)
                                const markerRadius = 9; // 15 * 0.6 = 9
                                ctx2d.fillStyle = f.properties.type === 'video' ? '#8e24aa' : '#1976d2';
                                ctx2d.beginPath();
                                ctx2d.arc(p.x, p.y, markerRadius, 0, 2 * Math.PI);
                                ctx2d.fill();
                                
                                // Draw white border
                                ctx2d.strokeStyle = '#ffffff';
                                ctx2d.lineWidth = 1; // Reduced from 2 to 1 for smaller markers
                                ctx2d.stroke();
                                
                                // Draw ID badge (in middle of marker, 0 offset, 60% size)
                                ctx2d.font = 'bold 10px sans-serif'; // 16 * 0.6 ≈ 10
                                ctx2d.fillStyle = '#ffffff'; // Strong white text
                                ctx2d.textAlign = 'center';
                                ctx2d.textBaseline = 'middle';
                                ctx2d.fillText(index + 1, p.x, p.y); // Directly in center of marker
                            });
                            outCanvas.toBlob((blob) => {
                                cleanup();
                                resolve(blob);
                            }, 'image/jpeg', 0.95);
                        } catch (e) {
                            cleanup();
                            resolve(null);
                        }
                    };
                    offMap.on('idle', onIdle);
                } catch (e) {
                    cleanup();
                    resolve(null);
                }
            });
        } catch (e) {
            resolve(null);
        }
    });
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
}

// Show all position markers (normal pins)
function showPositionMarkers() {
    // Only show position markers if in assign mode
    if (currentMode === 'assign') {
        mediaFiles.forEach((mediaFile, index) => {
            if (mediaFile.coordinates && !positionMarkers[index]) {
                updatePositionMarker(index, mediaFile.coordinates);
            }
        });
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

// Handle file selection
function handleFileSelection(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;
    
        Promise.all(files.map(async file => {
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');
        
        if (!isImage && !isVideo) return null;
        
        // Parse date using shared filename date parser
        let dateTaken = FilenameDateParser.parse(file.name);
        let dateSource = 'filename';
        
        if (!dateTaken && file.datetaken) {
            dateTaken = new Date(file.datetaken);
            dateSource = 'EXIF';
        }
        
        // Log what we found or didn't find
        if (dateTaken) {
            const dateStr = dateTaken.toISOString().slice(0, 19).replace('T', ' ');
            logActivity(`📅 ${file.name}: date found from ${dateSource} - ${dateStr}`, 'info');
        } else {
            logActivity(`⚠️ ${file.name}: no date found - will be available for manual coordinate assignment only`, 'warning');
        }
        
        const entry = {
            filename: file.name,
            type: isImage ? 'image' : 'video',
            path: URL.createObjectURL(file),
            coordinates: null,
            elevation: null,              // Elevation from GPX (null for manual assignment)
            file: file,
            dateTaken: dateTaken,        // UTC time for GPX matching (null for manual assignment)
            dateTakenLocal: dateTaken ? new Date(dateTaken.getTime() + CEST_OFFSET_MS) : null  // Local time for display
        };
        return entry;
    })).then(fileData => {
        mediaFiles = fileData.filter(file => file !== null);
        
        populateFileList();
        
        // Get stats once and use for both update and logging
        const stats = calculateMediaStats();
        updateStats();
        logActivity(`📁 Loaded ${stats.totalFiles} files (${stats.imageCount} images, ${stats.videoCount} videos)`, 'info');

        // Trigger auto-matching if GPX is present
        if (gpxTrack) {
            logActivity(`🎯 GPX track detected - triggering auto-matching for ${stats.totalFiles} files`, 'info');
        }
        runAutoMatchingIfReady();
    });
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

// Create an ImageData or HTMLCanvasElement usable by map.addImage from an emoji glyph
function createEmojiImageData(emoji, fontPx, color, boxPx) {
    try {
        const canvas = document.createElement('canvas');
        canvas.width = boxPx;
        canvas.height = boxPx;
        const ctx = canvas.getContext('2d');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `${fontPx}px sans-serif`;
        ctx.fillStyle = color || '#000';
        ctx.clearRect(0, 0, boxPx, boxPx);
        ctx.fillText(emoji, boxPx / 2, boxPx / 2);
        return canvas;
    } catch (_) {
        return null;
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

// Auto-assign coordinates from GPX track based on timestamp matching
function autoAssignCoordinatesFromGpx(gpxData) {
    if (!gpxData.tracks || gpxData.tracks.length === 0) return;
    
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
    
    // Process each media file
    mediaFiles.forEach((mediaFile, index) => {
        if (mediaFile.coordinates !== null) {
            // Skip files that already have coordinates
            return;
        }
        
        if (!mediaFile.dateTaken) {
            // Skip files without dates
            return;
        }
        

        
        // Find the closest matching track point by time
        const result = findClosestTrackPointByTime(mediaFile.dateTaken, pointsWithTime);
        
        if (result && result.point) {
            // Assign coordinates and elevation to the media file
            mediaFiles[index].coordinates = [result.point.lon, result.point.lat];
            mediaFiles[index].elevation = result.point.elevation; // Store elevation if available
            assignedCount++;
            
            // Log each assignment (now showing seconds instead of minutes)
            const timeDiff = Math.abs(mediaFile.dateTaken - new Date(result.point.time)) / 1000; // seconds
            const elevationInfo = result.point.elevation ? ` at ${result.point.elevation}m` : '';
            logActivity(`✖ Auto-assigned coords to ${mediaFile.filename} (${timeDiff.toFixed(1)}s diff)${elevationInfo}`, 'success');
        } else if (result && result.reason === 'date_mismatch') {
            dateMismatchCount++;
            logActivity(`⚠️ ${mediaFile.filename}: date mismatch with GPX track`, 'warning');
        } else if (result && result.reason === 'time_threshold') {
            timeThresholdCount++;
            logActivity(`⚠️ ${mediaFile.filename}: time difference exceeds ${GPX_TIME_THRESHOLD}s threshold`, 'warning');
        } else if (result && result.reason === 'no_match') {
            const mediaDateStr = mediaFile.dateTaken.toISOString().slice(0, 19).replace('T', ' ');
            logActivity(`ℹ️ ${mediaFile.filename}: no matching GPX track point found (media date: ${mediaDateStr})`, 'info');
        }
    });
    
    // Update UI after assignments
    if (assignedCount > 0) {
        populateFileList();
        updateStats();
        
        // Update position markers (pins) for newly assigned coordinates
        mediaFiles.forEach((mediaFile, index) => {
            if (mediaFile.coordinates && !positionMarkers[index]) {
                updatePositionMarker(index, mediaFile.coordinates);
            }
        });
        
        logActivity(`🎯 Auto-assigned coordinates to ${assignedCount} media files from GPX track`, 'success');
        
        // Update map bounds to include newly assigned coordinates
        updateMapBounds();
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
    

    
    trackPoints.forEach((point, index) => {
        if (!point.time) return;
        
        const trackTime = new Date(point.time);
        

        
        // Check if dates are different (different calendar days)
        const mediaDateOnly = new Date(mediaDate.getFullYear(), mediaDate.getMonth(), mediaDate.getDate());
        const trackDateOnly = new Date(trackTime.getUTCFullYear(), trackTime.getUTCMonth(), trackTime.getUTCDate());
        
        if (mediaDateOnly.getTime() !== trackDateOnly.getTime()) {
            // Different dates - exclude this point
            return;
        }
        
        // mediaDate is now already in UTC (converted from local time in extractDateFromFilename)
        // trackTime is already UTC from GPX
        const mediaTimeUTC = mediaDate.getTime();
        const trackTimeUTC = trackTime.getTime();
        
        const timeDiff = Math.abs(mediaTimeUTC - trackTimeUTC);
        

        
        if (timeDiff < smallestDiff) {
            smallestDiff = timeDiff;
            closestPoint = point;
        }
    });
    
    // Check if we found a point and if it meets the time threshold (now in seconds)
    if (closestPoint) {
        if (smallestDiff <= GPX_TIME_THRESHOLD * 1000) { // Convert seconds to milliseconds
            return { point: closestPoint, reason: 'success' };
        } else {
            return { reason: 'time_threshold' };
        }
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

// Add satellite imagery as an overlay when map loads
map.on('load', () => {
    // Add satellite imagery as a raster layer with reduced opacity
    map.addSource('satellite-overlay', {
        type: 'raster',
        url: 'mapbox://mapbox.satellite',
        tiles: ['https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.png?access_token=' + mapboxgl.accessToken]
    });
    
    // Insert satellite overlay before the first label layer to keep labels on top
    const firstLabelLayer = map.getStyle().layers.find(layer => 
        layer.type === 'symbol' && layer.id.includes('label')
    );
    
    map.addLayer({
        id: 'satellite-overlay',
        type: 'raster',
        source: 'satellite-overlay',
        paint: {
            'raster-opacity': 0.5 // 30% opacity = 70% transparent
        }
    }, firstLabelLayer ? firstLabelLayer.id : undefined);
});

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
        // Add a map screenshot of the media view if available
        try {
            // Prefer bounds-driven offscreen export for correct aspect ratio
            const jpgBlob = await exportMapScreenshotBlobOffscreen();
            if (jpgBlob && jpgBlob.size > 0) {
                zip.file('media_view_map.jpg', jpgBlob);
            }
        } catch (_) {}
        
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
    
    Promise.all(files.map(async file => {
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');
        
        if (!isImage && !isVideo) return null;
        
        // Keep date extraction for GPX auto-assignment, but don't rely on it for sorting
        let dateTaken = FilenameDateParser.parse(file.name);
        let dateSource = 'filename';
        
        if (!dateTaken && file.datetaken) {
            dateTaken = new Date(file.datetaken);
            dateSource = 'EXIF';
        }
        
        // Log what we found or didn't find
        if (dateTaken) {
            const dateStr = dateTaken.toISOString().slice(0, 19).replace('T', ' ');
            logActivity(`📅 ${file.name}: date found from ${dateSource} - ${dateStr}`, 'info');
        } else {
            logActivity(`⚠️ ${file.name}: no date found - will be available for manual coordinate assignment only`, 'warning');
        }
        
        const entry = {
            filename: file.name,
            type: isImage ? 'image' : 'video',
            path: URL.createObjectURL(file),
            coordinates: null,
            elevation: null,              // Elevation from GPX (null for manual assignment)
            file: file,
            dateTaken: dateTaken,        // UTC time for GPX matching (null for manual assignment)
            dateTakenLocal: dateTaken ? new Date(dateTaken.getTime() + CEST_OFFSET_MS) : null  // Local time for display
        };
        return entry;
    })).then(fileData => {
        mediaFiles = fileData.filter(file => file !== null);
        
        populateFileList();
        
        // Get stats once and use for both update and logging
        const stats = calculateMediaStats();
        updateStats();
        logActivity(`📁 Loaded ${stats.totalFiles} files (${stats.imageCount} images, ${stats.videoCount} videos)`, 'info');

        // Trigger auto-matching if GPX is present
        if (gpxTrack) {
            logActivity(`🎯 GPX track detected - triggering auto-matching for ${stats.totalFiles} files`, 'info');
        }
        runAutoMatchingIfReady();
    });
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