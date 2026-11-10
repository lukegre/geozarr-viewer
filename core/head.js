// CDN imports (pinned, as in the reference preview.html). Must stay the first lines of the module script.
import Map from 'https://cdn.jsdelivr.net/npm/ol@10.10.0/Map.js/+esm';
import WMTSTileGrid from 'https://cdn.jsdelivr.net/npm/ol@10.10.0/tilegrid/WMTS.js/+esm';
import {getView, withExtentCenter, withHigherResolutions, withLowerResolutions, withZoom}
  from 'https://cdn.jsdelivr.net/npm/ol@10.10.0/View.js/+esm';
import WebGLTileLayer from 'https://cdn.jsdelivr.net/npm/ol@10.10.0/layer/WebGLTile.js/+esm';
import TileLayer from 'https://cdn.jsdelivr.net/npm/ol@10.10.0/layer/Tile.js/+esm';
import GeoZarr from 'https://cdn.jsdelivr.net/npm/ol@10.10.0/source/GeoZarr.js/+esm';
import OSM from 'https://cdn.jsdelivr.net/npm/ol@10.10.0/source/OSM.js/+esm';
import XYZ from 'https://cdn.jsdelivr.net/npm/ol@10.10.0/source/XYZ.js/+esm';
import VectorLayer from 'https://cdn.jsdelivr.net/npm/ol@10.10.0/layer/Vector.js/+esm';
import VectorSource from 'https://cdn.jsdelivr.net/npm/ol@10.10.0/source/Vector.js/+esm';
import TopoJSON from 'https://cdn.jsdelivr.net/npm/ol@10.10.0/format/TopoJSON.js/+esm';
import {register} from 'https://cdn.jsdelivr.net/npm/ol@10.10.0/proj/proj4.js/+esm';
import {toLonLat} from 'https://cdn.jsdelivr.net/npm/ol@10.10.0/proj.js/+esm';
import proj4 from 'https://cdn.jsdelivr.net/npm/proj4@2.22.0/+esm';
// Must be the zarrita version that ol@10.10.0's GeoZarr source imports, so this is the module instance OL uses.
// S3 CORS rules that allow only GET leave HEAD responses without CORS headers (D-56), see noHeadSuffixReads.
import {FetchStore as OlFetchStore} from 'https://cdn.jsdelivr.net/npm/zarrita@0.7.3/+esm';
// browserConfig reads metadata with its own (newer) zarrita, loaded on demand.
const ZARRITA_URL = 'https://cdn.jsdelivr.net/npm/zarrita@0.7.5/+esm';
