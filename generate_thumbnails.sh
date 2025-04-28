#!/bin/bash

# Directory containing your videos (change as needed)
VIDEO_DIR="./uploads"
# Directory to store thumbnails
THUMB_DIR="./thumbnails"

# Create thumbnails directory if it doesn't exist
mkdir -p "$THUMB_DIR"

# Loop through all video files
find "$VIDEO_DIR" -type f \( -iname "*.mp4" -o -iname "*.webm" -o -iname "*.mov" \) | while read -r video; do
    filename=$(basename "$video")
    thumbname="${filename}.jpg"
    thumbpath="$THUMB_DIR/$thumbname"

    # Skip if thumbnail already exists
    if [ -f "$thumbpath" ]; then
        echo "Thumbnail exists: $thumbpath"
        continue
    fi

    # Always use 3 seconds for thumbnail extraction
    seek=3

    echo "Generating thumbnail for $filename at ${seek}s..."
    ffmpeg -y -ss "$seek" -i "$video" -vframes 1 -vf "scale=400:-1" "$thumbpath"
done

echo "All done!" 