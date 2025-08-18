# Noexif Geotagging Media Project

A Mapbox GL JS project that displays noexif geotagging media images and videos on an OpenStreetMap (OSM) base layer.

## Project Structure

```
Video_Map_Fiddle/
├── index.html              # Main HTML file
├── css/
│   └── styles.css          # CSS styles for the map and markers
├── js/
│   └── map.js              # JavaScript functionality
├── imgs_vids/              # Folder containing for "noexif geotagging media" files
├── media_coordinates.json  # Generated file with media coordinates
└── README.md               # This file
```

## Features

- **OSM Base Map**: Uses OpenStreetMap tiles for the base layer
- **Noexif Geotagging Media Display**: Shows images and videos at their GPS coordinates
- **Interactive Markers**: Click markers to view media in popups
- **Media Support**: Displays both images and videos with controls
- **Navigation Controls**: Zoom, pan, fullscreen, and scale controls
- **Responsive Design**: Works on desktop and mobile devices
- **Manual Coordinate Assignment**: Click on the map to assign GPS coordinates to media files
- **GPX Track Support**: Load and display GPX walking tracks on the map

## Setup Instructions

1. **Get a Mapbox Access Token**: 
   - Go to [https://account.mapbox.com](https://account.mapbox.com)
   - Create an account or sign in
   - Generate an access token

2. **Update the Access Token**:
   - Open `js/map.js`
   - Replace the access token with your actual Mapbox access token

3. **Add Your Media Files**:
   - Use the web interface to select media files
   - Click on the map to assign GPS coordinates to each file
   - Load GPX tracks to help with coordinate assignment

4. **Run the Project**:
   - Open `index.html` in a web browser
   - Or serve the files using a local web server

## Media File Support

- **Images**: JPG, JPEG, PNG, BMP, TIFF
- **Videos**: MP4, AVI, MOV, MKV


## Dependencies

- Mapbox GL JS v3.14.0 (loaded via CDN)
- Modern web browser with JavaScript enabled
- OpenStreetMap tiles (free, no API key required)

## Usage

- **Assign Coordinates**: Select media files, then click on the map to assign GPS coordinates
- **Load GPX Tracks**: Upload GPX files to display walking tracks on the map
- **View Media**: Click on markers to open popups with images/videos
- **Navigate**: Use mouse/touch to pan and zoom
- **Controls**: Use the navigation controls for zoom in/out and fullscreen
- **Scale**: View the map scale in the bottom-left corner 