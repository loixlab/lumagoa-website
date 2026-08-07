/// <reference types="google.maps" />
import type Alpine from "alpinejs";

const API_KEY = "AIzaSyAMs_QCrAi4FicxfDdEX6m-rsp-ItkqVH4";

const PRIMARY_BRAND_COLOR = "#c66f54";

interface MapConfig {
  position: google.maps.LatLngLiteral;
  zoom: number;
  mapId: string; // Use this in Google Console to set muted colors
  title: string;
  disableDefaultUI?: boolean;
  /** Custom pin styling; omitted → Google's default red pin. */
  pin?: google.maps.marker.PinElementOptions;
  infoWindowHtml: string;
}

// The two maps on the site. The InfoWindow HTML lives here (not in the EJS)
// so the markup only ever declares `x-data="googleMap('<preset>')"`.
const PRESETS: Record<string, MapConfig> = {
  sanctuary: {
    position: { lat: 15.0126252, lng: 74.0210419 },
    zoom: 16,
    mapId: "luma-goa-map",
    title: "Luma Goa Sanctuary",
    disableDefaultUI: true,
    pin: {
      background: PRIMARY_BRAND_COLOR,
      borderColor: "#ffffff",
      glyphColor: "#ffffff",
      scale: 1.2,
    },
    infoWindowHtml: `
      <div style="text-align: center; padding: 12px; font-family: serif;">
        <h2 style="font-size: 1.25rem; color: #1c1917; margin: 0 0 4px 0;">LUMA Goa</h2>
        <p style="font-size: 0.75rem; color: #78716c; margin: 0 0 16px 0; letter-spacing: 0.1em; text-transform: uppercase;">Sanctuary of Rest</p>

        <div style="display: flex; flex-direction: column; gap: 8px;">
          <a href="https://search.google.com/local/writereview?placeid=ChIJLQjFN7dFvjsR8yezomPB5ao"
            target="_blank" rel="noopener noreferrer"
            style="background-color: ${PRIMARY_BRAND_COLOR}; color: white; padding: 10px 20px; text-decoration: none; border-radius: 50px; font-size: 0.8rem; font-weight: 600; font-family: sans-serif;">
            Leave a Review
          </a>
          <a href="https://www.google.com/maps/dir/?api=1&destination=15.0126252,74.0210419"
            target="_blank" rel="noopener noreferrer"
            style="color: ${PRIMARY_BRAND_COLOR}; font-size: 0.75rem; text-decoration: underline; font-family: sans-serif; font-weight: 600;">
            Get Directions
          </a>
        </div>
      </div>
    `,
  },
  cafe: {
    position: { lat: 15.0127876, lng: 74.0212761 },
    zoom: 17,
    mapId: "roots-bloom-map",
    title: "Roots & Bloom Café @ LUMA",
    infoWindowHtml: `
      <div style="text-align: center; font-family: sans-serif; padding: 10px;">
        <h2 style="font-size: 1.1rem; margin: 0 0 5px 0; color: #2f5d50;">Roots & Bloom Café</h2>
        <p style="font-size: 0.9rem; margin: 0 0 10px 0; color: #444;">Vegan & Vegetarian Sanctuary</p>
        <a href="https://rootsandbloomcafe.com" target="_blank" rel="noopener noreferrer" style="text-decoration: none;">
          <button style="background-color: #2f5d50; color: white; padding: 8px 16px; border: none; border-radius: 20px; cursor: pointer; font-size: 0.8rem;">View Full Website</button>
        </a>
      </div>
    `,
  },
};

let mapsApi: Promise<void> | null = null;

/**
 * Injects the Google Maps script once and resolves when the API is ready.
 * Not cached on failure, so a later component init can retry.
 */
function loadMapsApi(): Promise<void> {
  return (mapsApi ??= new Promise<void>((resolve, reject) => {
    (window as any).__lumaMapsReady = resolve;
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${API_KEY}&loading=async&libraries=marker&callback=__lumaMapsReady`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      mapsApi = null;
      reject(new Error("Failed to load the Google Maps script"));
    };
    document.head.appendChild(script);
  }));
}

/**
 * Registers the Alpine component backing the site's Google Maps (home +
 * cafe-restaurant). Placed directly on the map container, e.g.
 * `<div id="map" x-data="googleMap('sanctuary')">`.
 */
export function registerMapComponents(alpine: typeof Alpine) {
  alpine.data("googleMap", (preset: string) => ({
    async init() {
      const config = PRESETS[preset];
      if (!config) {
        console.error(`Unknown map preset: ${preset}`);
        return;
      }

      try {
        await loadMapsApi();
      } catch (error) {
        console.error("Error loading Google Maps:", error);
        return;
      }

      const map = new google.maps.Map(this.$el, {
        center: config.position,
        zoom: config.zoom,
        mapTypeId: "roadmap",
        mapId: config.mapId,
        disableDefaultUI: config.disableDefaultUI ?? false,
        zoomControl: true,
        zoomControlOptions: {
          position: google.maps.ControlPosition.RIGHT_BOTTOM,
        },
      });

      const marker = new google.maps.marker.AdvancedMarkerElement({
        position: config.position,
        map,
        title: config.title,
        content: config.pin
          ? new google.maps.marker.PinElement(config.pin).element
          : undefined,
      });

      const infoWindow = new google.maps.InfoWindow({
        content: config.infoWindowHtml,
      });

      marker.addListener("click", () => {
        infoWindow.open({ anchor: marker, map });
      });
    },
  }));
}
