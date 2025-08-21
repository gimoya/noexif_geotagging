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
function logActivity(message, type = 'info') {
    const logContainer = document.getElementById('unified-activity-log');
    if (!logContainer) return;
    
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `unified-log-entry ${type}`;
    logEntry.innerHTML = `[${timestamp}] ${message}`;
    
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
        
        // Extract time directly from filename for display (bypass JavaScript timezone issues)
        let dateStr = 'Unknown date';
        if (file.dateTaken) {
            // Extract YYYYMMDDHHMM from filename and format it nicely
            const filename = file.filename;
            const timeMatch = filename.match(/(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/);
            if (timeMatch) {
                const [_, year, month, day, hour, minute] = timeMatch;
                dateStr = `${month}/${day}/${year} ${hour}:${minute}`;
            } else {
                // Fallback to JavaScript formatting
                dateStr = file.dateTakenLocal ? file.dateTakenLocal.toLocaleDateString() + ' ' + file.dateTakenLocal.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : 'Unknown date';
            }
        }
        
        fileItem.innerHTML = `
            <div class="file-info">
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
    
    // Control panel buttons - add null checks
    const hidePanelBtn = document.getElementById('hide-panel');
    const showPanelBtn = document.getElementById('show-panel');
    
    if (hidePanelBtn) {
        hidePanelBtn.addEventListener('click', hidePanel);
    }
    
    if (showPanelBtn) {
        showPanelBtn.addEventListener('click', showPanel);
    }
    
    // File input handlers - add null checks
    const selectFilesBtn = document.getElementById('select-files-btn');
    const mediaFilesInput = document.getElementById('media-files-input');
    
    if (selectFilesBtn && mediaFilesInput) {
        selectFilesBtn.addEventListener('click', () => {
            mediaFilesInput.click();
        });
    }
    
    if (mediaFilesInput) {
        mediaFilesInput.addEventListener('change', handleFileSelection);
    }
    
    // GPX file handlers - add null checks
    const selectGpxBtn = document.getElementById('select-gpx-btn');
    const gpxFileInput = document.getElementById('gpx-file-input');
    
    if (selectGpxBtn && gpxFileInput) {
        selectGpxBtn.addEventListener('click', () => {
            gpxFileInput.click();
        });
    }
    
    if (gpxFileInput) {
        gpxFileInput.addEventListener('change', handleGpxSelection);
    }
    
    const clearTrackBtn = document.getElementById('clear-track-btn');
    if (clearTrackBtn) {
        clearTrackBtn.addEventListener('click', clearGpxTrack);
    }
    
    // Bulk download button - add null check
    const downloadAllBtn = document.getElementById('download-all-btn');
    if (downloadAllBtn) {
        downloadAllBtn.addEventListener('click', downloadAllNoexifGeotaggingMediaPhotos);
    }
    
    // Setup drag and drop for file areas
    setupDragAndDrop();
}

// Setup drag and drop functionality
function setupDragAndDrop() {
    // Media files drop area
    const mediaDropArea = document.querySelector('.file-upload');
    const mediaInput = document.getElementById('media-files-input');
    
    if (mediaDropArea) {
        // Click to open file picker
        mediaDropArea.addEventListener('click', () => {
            mediaInput.click();
        });
        
        // Drag and drop events
        mediaDropArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            mediaDropArea.classList.add('drag-over');
        });
        
        mediaDropArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            mediaDropArea.classList.remove('drag-over');
        });
        
        mediaDropArea.addEventListener('drop', (e) => {
            e.preventDefault();
            mediaDropArea.classList.remove('drag-over');
            
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) {
                // Create a fake event object to reuse existing handler
                const fakeEvent = { target: { files: files } };
                handleFileSelection(fakeEvent);
            }
        });
    }
    
    // GPX drop area
    const gpxDropArea = document.querySelector('.gpx-upload');
    const gpxInput = document.getElementById('gpx-file-input');
    
    if (gpxDropArea) {
        // Click to open file picker
        gpxDropArea.addEventListener('click', () => {
            gpxInput.click();
        });
        
        // Drag and drop events
        gpxDropArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            gpxDropArea.classList.add('drag-over');
        });
        
        gpxDropArea.addEventListener('dragleave', (e) => {
            e.preventDefault();
            gpxDropArea.classList.remove('drag-over');
        });
        
        gpxDropArea.addEventListener('drop', (e) => {
            e.preventDefault();
            gpxDropArea.classList.remove('drag-over');
            
            const files = Array.from(e.dataTransfer.files);
            if (files.length > 0) {
                // Create a fake event object to reuse existing handler
                const fakeEvent = { target: { files: files } };
                handleGpxSelection(fakeEvent);
            }
        });
    }
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
        
        logActivity(`📍 Coordinates saved to "${filename}": ___${coords[0].toFixed(6)}, ${coords[1].toFixed(6)}___${elevationInfo}`, 'success');
        
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
    if (positionMarkers[fileIndex] && positionMarkers[fileIndex].remove) {
        positionMarkers[fileIndex].remove();
    }
    
    // Create new position marker
    const markerEl = document.createElement('div');
    markerEl.className = 'position-marker';
    markerEl.style.width = '28.5px';
    markerEl.style.height = '28.5px';
    markerEl.style.cursor = 'pointer';
    markerEl.style.fontSize = '22.8px';
    markerEl.style.textAlign = 'center';
    markerEl.style.lineHeight = '28.5px';
    markerEl.innerHTML = '📍';
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
    mediaMarkers.forEach((marker, index) => {
        if (marker && marker.remove) {
            marker.remove();
        }
        mediaMarkers[index] = null;
    });
    mediaMarkers = [];
    
    const stats = calculateMediaStats();
    const filesWithCoords = stats.filesWithCoords;
    
    mediaFiles.forEach((file, index) => {
        if (file.coordinates) {
            // Create marker element
            const markerEl = document.createElement('div');
            markerEl.className = 'media-marker';
            markerEl.style.width = '37.5px';
            markerEl.style.height = '37.5px';
            markerEl.style.cursor = 'pointer';
            markerEl.style.fontSize = '30px';
            markerEl.style.textAlign = 'center';
            markerEl.style.lineHeight = '37.5px';
            markerEl.innerHTML = file.type === 'image' ? '📷' : '🎥';
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
                 popupContent.appendChild(img);
             } else {
                 const video = document.createElement('video');
                 video.src = file.path;
                 video.style.width = '100%';
                 video.style.height = 'auto';
                 video.style.display = 'block';
                 video.style.margin = '0';
                 video.style.padding = '0';
                 video.controls = true;
                 popupContent.appendChild(video);
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
    mediaMarkers.forEach((marker, index) => {
        if (marker && marker.remove) {
            marker.remove();
        }
        mediaMarkers[index] = null;
    });
    mediaMarkers = [];
    
    // Show feedback
    logActivity('🗑️ All media pins cleared', 'info');
}

// Hide all media pins (for mode switching)
function hideMediaPins() {
    mediaMarkers.forEach((marker, index) => {
        if (marker && marker.remove) {
            marker.remove();
        }
        mediaMarkers[index] = null;
    });
    mediaMarkers = [];
}

// Clear all position markers
function clearPositionMarkers() {
    positionMarkers.forEach((marker, index) => {
        if (marker && marker.remove) {
            marker.remove();
        }
        positionMarkers[index] = null;
    });
    positionMarkers = [];
}

// Show all position markers (normal pins)
function showPositionMarkers() {
    // Only show position markers if in assign mode
    if (currentMode === 'assign') {
        mediaFiles.forEach((mediaFile, index) => {
            if (mediaFile.coordinates && (!positionMarkers[index] || !positionMarkers[index]._map)) {
                updatePositionMarker(index, mediaFile.coordinates);
            }
        });
    }
}

// Hide all position markers (normal pins)
function hidePositionMarkers() {
    positionMarkers.forEach((marker, index) => {
        if (marker && marker.remove) {
            marker.remove();
        }
        positionMarkers[index] = null;
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
        
        // Keep date extraction for GPX auto-assignment, but don't rely on it for sorting
        let dateTaken = extractDateFromFilename(file.name);
        if (!dateTaken) {
            dateTaken = new Date(file.lastModified);
        }
        
        return {
            filename: file.name,
            type: isImage ? 'image' : 'video',
            path: URL.createObjectURL(file),
            coordinates: null,
            elevation: null,              // Elevation from GPX (null for manual assignment)
            file: file,
            dateTaken: dateTaken,        // UTC time for GPX matching
            dateTakenLocal: dateTaken ? new Date(dateTaken.getTime() + CEST_OFFSET_MS) : null  // Local time for display
        };
    })).then(fileData => {
        mediaFiles = fileData.filter(file => file !== null);
        
        populateFileList();
        
        // Get stats once and use for both update and logging
        const stats = calculateMediaStats();
        updateStats();
        logActivity(`📁 Loaded ${stats.totalFiles} files (${stats.imageCount} images, ${stats.videoCount} videos)`, 'info');
    });
}

// Helper function to convert local time to UTC (simple -2 hours for CEST)
function localTimeToUTC(year, month, day, hour = 0, minute = 0, second = 0) {
    // Simple: subtract 2 hours for CEST (UTC+2)
    const utcHour = hour - 2;
    return new Date(Date.UTC(year, month - 1, day, utcHour, minute, second));
}

// Helper function to format time range for display
function formatTimeRange(startTime, endTime) {
    const startDate = startTime.toLocaleDateString();
    const startTimeStr = startTime.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    const endDate = endTime.toLocaleDateString();
    const endTimeStr = endTime.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    
    if (startDate === endDate) {
        // Same date: show "Date HH:MM - HH:MM"
        return `${startDate} ${startTimeStr} - ${endTimeStr}`;
    } else {
        // Different dates: show "Date1 HH:MM - Date2 HH:MM"
        return `${startDate} ${startTimeStr} - ${endDate} ${endTimeStr}`;
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

// Extract date from filename using regex patterns
function extractDateFromFilename(filename) {
    // Common filename patterns for date extraction
    // Order matters! More specific patterns first, then more general ones
    const patterns = [
        // YYYYMMDDHHMM format (e.g., 202508041200) - NO SECONDS, LOCAL TIME
        /(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/,
        // YYYYMMDD format (e.g., 20250804) - fallback
        /(\d{4})(\d{2})(\d{2})/
    ];
    
    for (const pattern of patterns) {
        const match = filename.match(pattern);
        if (match) {
            try {
                if (match.length === 6) {
                    // YYYYMMDDHHMM format (e.g., 202508041200) - NO SECONDS, LOCAL TIME
                    const [_, year, month, day, hour, minute] = match;
                    const utcDate = localTimeToUTC(year, month, day, hour, minute, 0);
                    console.log(`Timezone conversion for ${filename}: Local ${year}-${month}-${day} ${hour}:${minute}:00 → UTC ${utcDate.toISOString()}`);
                    return utcDate;
                } else if (match.length === 4) {
                    // Date only: YYYY, MM, DD
                    const [_, year, month, day] = match;
                    return localTimeToUTC(year, month, day, 0, 0, 0);
                }
            } catch (error) {
                // Invalid date, try next pattern
                continue;
            }
        }
    }
    
    return null; // No date found
}

// Handle GPX file selection
function handleGpxSelection(event) {
    const files = Array.from(event.target.files);
    if (files.length === 0) return;
    
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
                
                document.getElementById('clear-track-btn').style.display = 'inline-block';
                
                // Show feedback with more detailed info
                const trackName = gpxData.tracks[0].name || 'Unnamed track';
                logActivity(`🗺️ GPX track loaded: ${trackName} (${gpxData.tracks[0].points.length} points)`, 'info');
                
                // Debug: Show first and last timestamps from GPX
                const pointsWithTime = gpxData.tracks[0].points.filter(p => p.time);
                if (pointsWithTime.length > 0) {
                    const firstTime = new Date(pointsWithTime[0].time);
                    const lastTime = new Date(pointsWithTime[pointsWithTime.length - 1].time);
                    
                    // Format time range for display (date, hours, minutes)
                    const timeRangeStr = formatTimeRange(firstTime, lastTime);
                    
                    // Log to console for debug
                    console.log(`🗺️ GPX time range: ${firstTime.toISOString()} to ${lastTime.toISOString()}`);
                    console.log(`🗺️ GPX time range local: ${firstTime.toString()} to ${lastTime.toString()}`);
                    
                    // Display in UI
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
        
        // Debug: Log the media file date being processed
        console.log(`Processing ${mediaFile.filename}:`, {
            extractedDate: mediaFile.dateTaken,
            extractedDateString: mediaFile.dateTaken.toISOString(),
            extractedDateLocal: mediaFile.dateTaken.toString(),
            extractedDateUTC: mediaFile.dateTaken.toISOString()
        });
        
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
            logActivity(`📍 Auto-assigned coords to ${mediaFile.filename} (${timeDiff.toFixed(1)}s diff)${elevationInfo}`, 'success');
        } else if (result && result.reason === 'date_mismatch') {
            dateMismatchCount++;
        } else if (result && result.reason === 'time_threshold') {
            timeThresholdCount++;
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
    } else {
        logActivity('ℹ️ No coordinates auto-assigned - check that media files have dates and GPX has timestamps', 'info');
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
    
    console.log(`\n🔍 Finding closest track point for media date: ${mediaDate.toISOString()}`);
    console.log(`📅 Media date local: ${mediaDate.toString()}`);
    
    trackPoints.forEach((point, index) => {
        if (!point.time) return;
        
        const trackTime = new Date(point.time);
        
        // Debug: Log first few track points to see their timestamps
        if (index < 5) {
            console.log(`Track point ${index}: ${point.time} -> ${trackTime.toISOString()}`);
        }
        
        // Check if dates are different (different calendar days)
        const mediaDateOnly = new Date(mediaDate.getFullYear(), mediaDate.getMonth(), mediaDate.getDate());
        const trackDateOnly = new Date(trackTime.getFullYear(), trackTime.getMonth(), trackTime.getDate());
        
        if (mediaDateOnly.getTime() !== trackDateOnly.getTime()) {
            // Different dates - exclude this point
            if (index < 5) {
                console.log(`❌ Date mismatch: Media ${mediaDateOnly.toISOString()} vs Track ${trackDateOnly.toISOString()}`);
            }
            return;
        }
        
        // mediaDate is now already in UTC (converted from local time in extractDateFromFilename)
        // trackTime is already UTC from GPX
        const mediaTimeUTC = mediaDate.getTime();
        const trackTimeUTC = trackTime.getTime();
        
        const timeDiff = Math.abs(mediaTimeUTC - trackTimeUTC);
        
        if (index < 5) {
            console.log(`⏰ Time comparison: Media UTC ${mediaTimeUTC} vs Track UTC ${trackTimeUTC}, diff: ${timeDiff}ms (${(timeDiff/1000).toFixed(1)}s)`);
        }
        
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
    // Remove existing track if any
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
    
    // Add track layer
    map.addLayer({
        id: 'gpx-track-layer',
        type: 'line',
        source: 'gpx-track',
        layout: {
            'line-join': 'round',
            'line-cap': 'round'
        },
        paint: {
            'line-color': '#ff6b6b',
            'line-width': 4,
            'line-opacity': 0.8
        }
    });
    
    // Fit map to track bounds
    const bounds = coordinates.reduce((bounds, coord) => {
        return bounds.extend(coord);
    }, new mapboxgl.LngLatBounds(coordinates[0], coordinates[0]));
    
    map.fitBounds(bounds, {
        padding: 50,
        duration: 1000
    });
}

// Clear GPX track from map
function clearGpxTrack() {
    if (map.getSource('gpx-track')) {
        map.removeLayer('gpx-track-layer');
        map.removeSource('gpx-track');
    }
    
    gpxTrack = null;
    // Remove reference to deleted gpx-info div
    document.getElementById('clear-track-btn').style.display = 'none';
    document.getElementById('gpx-file-input').value = '';
    
    // Show feedback
    logActivity('🗺️ GPX track cleared', 'info');
    
    // Update stats since GPX track affects elevation data
    updateStats();
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
    countries: 'at', // Limit to Austria
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

// Initialize when map loads
map.on('load', initApp); 