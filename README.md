# Noexif Geotagging Media Project

A Mapbox GL JS project that displays noexif geotagging media images and videos on an OpenStreetMap (OSM) base layer.

## Project Structure

```
noexif_geotagging/
├── maptool.html            # Main geotagging tool (the actual application)
├── index.html              # Simple guide and instructions
├── css/
│   └── styles.css          # CSS styles for the map and markers
├── js/
│   ├── map.js                 # Main map / geotagging logic
│   ├── filename-date-parser.js
│   └── exif-gps-reader.js     # EXIF GPS via exifr
├── example_media/          # Folder containing example media files
├── media_coordinates.json  # Generated file with media coordinates
└── README.md               # This file
```

## Features

- **OSM Base Map**: Uses OpenStreetMap tiles for the base layer
- **EXIF GPS first**: On upload, reads EXIF GPS (and altitude when present) and pins those files immediately
- **Noexif fallback**: If EXIF GPS is missing, uses filename date/time + GPX time-matching or manual map click; download embeds coords in the filename (does not write EXIF)
- **Noexif Geotagging Media Display**: Shows images and videos at their GPS coordinates
- **Interactive Markers**: Click markers to view media in popups
- **Media Support**: Displays both images and videos with controls
- **Navigation Controls**: Zoom, pan, fullscreen, and scale controls
- **Responsive Design**: Works on desktop and mobile devices
- **Manual Coordinate Assignment**: Click on the map to assign GPS coordinates to media files
- **GPX Track Support**: Load and display GPX walking tracks on the map (does not overwrite EXIF GPS)

## Setup Instructions

1. **Get a Mapbox Access Token**: 
   - Go to [https://account.mapbox.com](https://account.mapbox.com)
   - Create an account or sign in
   - Generate an access token

2. **Update the Access Token**:
   - Open `js/map.js`
   - Replace the access token with your actual Mapbox access token

3. **Add Your Media Files**:
   - Use the web interface to select media files (EXIF GPS is applied automatically when present)
   - Load a GPX track to auto-assign files that have no EXIF GPS (matched via filename timestamps)
   - Click on the map to manually assign remaining files

4. **Run the Project**:
   - Open `maptool.html` in a web browser (main application)
   - Open `index.html` for a simple guide
   - Or serve the files using a local web server

## Media File Support

- **Images**: JPG, JPEG, PNG, BMP, TIFF
- **Videos**: MP4, AVI, MOV, MKV


## Dependencies

- Mapbox GL JS v3.14.0 (loaded via CDN)
- exifr 7.1.3 (CDN) for EXIF GPS reads
- Modern web browser with JavaScript enabled
- OpenStreetMap / Esri tiles (as configured in `map.js`)

## Usage

- **Upload media**: EXIF GPS is used when present; otherwise noexif flow (filename date → GPX / manual)
- **Load GPX Tracks**: Auto-assign remaining files by time; EXIF coords are left untouched
- **Assign Coordinates**: Select media files, then click on the map to assign GPS coordinates
- **View Media**: Click on markers to open popups with images/videos
- **Navigate**: Use mouse/touch to pan and zoom
- **Controls**: Use the navigation controls for zoom in/out and fullscreen
- **Scale**: View the map scale in the bottom-left corner 