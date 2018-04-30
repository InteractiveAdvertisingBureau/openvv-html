import VPAIDInterface from 'vpaid-generic';
import OpenVVOverlay from './OpenVVOverlay.js';

new VPAIDInterface({ window: window, overlays: OpenVVOverlay });