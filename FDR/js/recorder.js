/**
 * FDR-Alpha Recorder Logic
 * Handles GPS tracking, data buffering, and GPX export.
 */

let isRecording = false;
let flightData = [];
let watchId = null;
let startTime = null;
let lastPosition = null;
let wakeLock = null;

const recordBtn = document.getElementById('recordBtn');
const statusLed = document.getElementById('statusLed');
const satCountEl = document.getElementById('satCount');
const signalWarning = document.getElementById('signalWarning');

// HUD Elements
const gsEl = document.getElementById('gsValue');
const altEl = document.getElementById('altValue');
const vsiEl = document.getElementById('vsiValue');
const hdgEl = document.getElementById('hdgValue');
const timerEl = document.getElementById('timerValue');

// --- Initialization ---

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        console.error(`${err.name}, ${err.message}`);
    }
}

function startRecording() {
    isRecording = true;
    flightData = [];
    startTime = Date.now();
    recordBtn.textContent = 'Stop Recording';
    recordBtn.classList.add('recording');
    statusLed.classList.add('locked');
    requestWakeLock();
    
    // Auto-stop after 5 hours
    setTimeout(() => {
        if (isRecording) stopRecording();
    }, 5 * 60 * 60 * 1000);
}

function stopRecording() {
    isRecording = false;
    recordBtn.textContent = 'Start Recording';
    recordBtn.classList.remove('recording');
    statusLed.classList.remove('locked');
    if (wakeLock) wakeLock.release();
    
    if (flightData.length > 0) {
        exportGPX();
    }
}

// --- GPS Tracking ---

function updateGPS(position) {
    const coords = position.coords;
    const now = Date.now();
    
    // Satellite count is not directly available in standard Geolocation API, 
    // but accuracy can be a proxy. Standard mobile GPS might not provide SAT count.
    // We simulate SAT count for UI based on accuracy.
    const accuracy = coords.accuracy;
    const estSat = accuracy < 10 ? 12 : (accuracy < 30 ? 6 : 3);
    satCountEl.textContent = estSat;
    
    if (estSat < 4) {
        signalWarning.style.display = 'block';
    } else {
        signalWarning.style.display = 'none';
    }

    // Calculations
    const speedKts = (coords.speed || 0) * 1.94384; // m/s to knots
    const altFt = (coords.altitude || 0) * 3.28084; // m to feet
    const heading = coords.heading || 0;
    
    let vsi = 0;
    if (lastPosition) {
        const deltaAlt = altFt - (lastPosition.coords.altitude * 3.28084);
        const deltaTime = (now - lastPosition.timestamp) / 60000; // minutes
        vsi = deltaTime > 0 ? deltaAlt / deltaTime : 0;
    }

    // Update HUD
    gsEl.textContent = speedKts.toFixed(1);
    altEl.textContent = Math.round(altFt);
    vsiEl.textContent = Math.round(vsi);
    hdgEl.textContent = Math.round(heading).toString().padStart(3, '0');

    if (isRecording) {
        flightData.push({
            lat: coords.latitude,
            lon: coords.longitude,
            alt: altFt,
            speed: speedKts,
            vsi: vsi,
            heading: heading,
            time: new Date(now).toISOString()
        });
        updateTimer();
    }

    lastPosition = position;
}

function updateTimer() {
    const diff = Date.now() - startTime;
    const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
    const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
    const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
    timerEl.textContent = `${h}:${m}:${s}`;
}

// --- Export Logic ---

function exportGPX() {
    let gpx = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="FDR-Alpha" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>Flight_${new Date().toISOString()}</name>
    <trkseg>`;

    flightData.forEach(pt => {
        gpx += `
      <trkpt lat="${pt.lat}" lon="${pt.lon}">
        <ele>${(pt.alt / 3.28084).toFixed(2)}</ele>
        <time>${pt.time}</time>
        <extensions>
          <speed>${(pt.speed / 1.94384).toFixed(2)}</speed>
          <vsi>${pt.vsi}</vsi>
          <heading>${pt.heading}</heading>
        </extensions>
      </trkpt>`;
    });

    gpx += `
    </trkseg>
  </trk>
</gpx>`;

    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `FDR_MISSION_${new Date().getTime()}.gpx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

// --- Event Listeners ---

recordBtn.addEventListener('click', () => {
    if (!isRecording) startRecording();
    else stopRecording();
});

// Start GPS Watch
if ("geolocation" in navigator) {
    watchId = navigator.geolocation.watchPosition(updateGPS, (err) => {
        console.warn('GPS Error:', err);
    }, {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 5000
    });
} else {
    alert("This device does not support GPS.");
}
