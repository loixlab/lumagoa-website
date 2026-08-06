import type Alpine from "alpinejs";
import PhotoSwipeLightbox from "photoswipe/lightbox";
import Masonry from "masonry-layout";
import imagesLoaded from "imagesloaded";

interface ImageMetadata {
  filename: string;
  width: number;
  height: number;
}

type Metadata = Record<string, ImageMetadata>;

/**
 * Registers the Alpine component backing the masonry photo galleries
 * (gallery + yoga-shala pages). Placed on the grid element with the page's
 * metadata file as argument, e.g.
 * `x-data="masonryGallery('gallery-img-metadata.json')"`.
 *
 * It lays out the grid with Masonry (re-layout as each image loads), stamps
 * the `data-pswp-width/height` attributes PhotoSwipe needs from the metadata
 * JSON, and boots the PhotoSwipe lightbox scoped to the grid.
 */
export function registerGalleryComponents(alpine: typeof Alpine) {
  alpine.data("masonryGallery", (metadataFile: string) => ({
    async init() {
      const grid = this.$el;

      const msnry = new Masonry(grid, {
        itemSelector: ".grid-item",
        columnWidth: ".grid-sizer", // Uses sizer for precise column width
        gutter: ".gutter-sizer", // Uses sizer for precise gutter
        percentPosition: true,
      });

      imagesLoaded(grid).on("progress", () => {
        // Re-layout Masonry after each image loads
        msnry.layout?.();
      });

      // Handle resize for responsiveness
      window.addEventListener("resize", () => {
        msnry.layout?.();
      });

      const lightbox = new PhotoSwipeLightbox({
        gallery: grid,
        children: "a",
        pswpModule: () => import("photoswipe"),
        escKey: true,
      });
      lightbox.init();

      await addPswpAttributes(grid, metadataFile);
    },
  }));
}

/** Stamps PhotoSwipe's required width/height attributes on the grid's links. */
async function addPswpAttributes(grid: HTMLElement, fileName: string) {
  try {
    const response = await fetch(`/${fileName}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch metadata: ${response.statusText}`);
    }
    const metadata: Metadata = await response.json();

    const links = grid.querySelectorAll<HTMLAnchorElement>(".grid-item a");
    links.forEach((link) => {
      const href = link.getAttribute("href");
      if (href && metadata[href]) {
        const { width, height } = metadata[href];
        link.setAttribute("data-pswp-width", width.toString());
        link.setAttribute("data-pswp-height", height.toString());
      } else {
        console.warn(`No metadata found for image: ${href}`);
      }
    });
  } catch (error) {
    console.error("Error adding PhotoSwipe attributes:", error);
  }
}
