import "maplibre-gl/dist/maplibre-gl.css";
import * as maplibregl from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

// MapLibre draws map tiles in a web worker and looks for the worker file next
// to its own script. Vite moves the library (pre-bundled in development,
// hashed in builds), so the worker was never found and the maps stayed empty
// or black. Vite serves the worker file itself and this tells MapLibre where.
// Every map imports MapLibre from here.
maplibregl.setWorkerUrl(workerUrl);

export { maplibregl };
