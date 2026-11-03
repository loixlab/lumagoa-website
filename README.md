# Luma Goa website

[![Netlify Status](https://api.netlify.com/api/v1/badges/8b8bdeee-7054-4a94-808a-bfce1801811b/deploy-status)](https://app.netlify.com/projects/lumagoa/deploys)

This is the repo for the Luma Goa website.

## Resize images for the Gallery

Use the `resize_images.py` python script. The output will be generated in a `resized` folder inside the input folder.

```py
python3 ./scripts/resize_images.py <maxImageWidth> <folderWithImages>

# example
python3 ./scripts/resize_images.py 1600 /Users/seb/Desktop/gallery/originals
```

## Resize images for hero/og/twitter

Make sure you have the dependencies installed

```py
pip3 install pillow
pip3 install pillow-heif
```

Pass an image an it will render the 3 different sizes (for desktop, og and twitter)

```py
# Works with HEIC files directly
python3 ./scripts/resize_hero_image.py ./public/img/cafe-hero.HEIC

# Works with JPG
python3 ./scripts/resize_hero_image.py ./public/img/cafe-hero.jpg
```

## Yoga schedule

The `/yoga` class schedule is edited in a Google Sheet and read at build time. See [docs/yoga-schedule-sheet.md](docs/yoga-schedule-sheet.md) for the sheet's columns, setup and troubleshooting.
