// js/config.js 未被提交到 git，在沒有該檔案的環境(如剛 clone 下來或部署後)
// APP_CONFIG 會是 undefined，避免整支 script 因此中斷，改為降級為停用 3D 地形 token
if (typeof APP_CONFIG === 'undefined') {
    console.warn('js/config.js 不存在：Cesium 3D 地形 token 未設定，3D 預覽將無法載入地形資料。');
    window.APP_CONFIG = { LOGIN_PASSWORD: null, OPENAIP_API_KEY: null, CESIUM_ION_TOKEN: null };
}

let activeThreatData = null;
/**
 * FDR-Alpha Analysis Logic
 * Handles GPX parsing, chart rendering, and map playback.
 */

let missionData = [];

const fileInput = document.getElementById('fileInput');
const importBtn = document.getElementById('importBtn');
const timeSliders = document.querySelectorAll('.time-slider');
const currentTimeLabel = document.getElementById('currentTimeLabel');

let viewer = null;
let cesiumMarker = null;
let is3DMode = true;



function getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const toRad = Math.PI/180;
    const phi1 = lat1 * toRad;
    const phi2 = lat2 * toRad;
    const dPhi = (lat2-lat1) * toRad;
    const dLambda = (lon2-lon1) * toRad;

    const a = Math.sin(dPhi/2) * Math.sin(dPhi/2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(dLambda/2) * Math.sin(dLambda/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

function getBearing(lat1, lon1, lat2, lon2) {
    const toRad = Math.PI / 180;
    const toDeg = 180 / Math.PI;
    const phi1 = lat1 * toRad;
    const phi2 = lat2 * toRad;
    const dLambda = (lon2 - lon1) * toRad;
    const y = Math.sin(dLambda) * Math.cos(phi2);
    const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
    const theta = Math.atan2(y, x);
    return (theta * toDeg + 360) % 360;
}

// --- Initialization ---


function createCesiumMarker() {
    if (!viewer) return;
    
    if (cesiumMarker) {
        try {
            viewer.entities.remove(cesiumMarker);
        } catch(e){}
    }

    cesiumMarker = viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(0, 0, 0),
        orientation: Cesium.Transforms.headingPitchRollQuaternion(
            Cesium.Cartesian3.fromDegrees(0, 0, 0),
            new Cesium.HeadingPitchRoll(0, 0, 0)
        ),
        model: {
            uri: './assets/helicopter.glb', 
            minimumPixelSize: 64, // 也順便把最小像素改小一點，避免在遠處看起來還是太大
            scale: 10.0,
            maximumScale: 20000
        }
    });
}

function drawThreatDome(threatData) {
    if (!viewer || !threatData) return;
    try {
        const radiusMeters = threatData.rangeNm * 1852;
        viewer.entities.add({
            name: 'Missile Threat Dome',
            position: Cesium.Cartesian3.fromDegrees(threatData.lng, threatData.lat, 0),
            ellipsoid: {
                radii: new Cesium.Cartesian3(radiusMeters, radiusMeters, radiusMeters),
                material: Cesium.Color.RED.withAlpha(0.3),
                outline: true,
                outlineColor: Cesium.Color.RED.withAlpha(0.8),
                maximumCone: Cesium.Math.PI_OVER_TWO
            }
        });
    } catch (e) {
        console.error("Error drawing threat dome:", e);
    }
}

function initCesium() {
    if (viewer || typeof Cesium === 'undefined') return;

    if (APP_CONFIG.CESIUM_ION_TOKEN) {
        Cesium.Ion.defaultAccessToken = APP_CONFIG.CESIUM_ION_TOKEN;
    } else {
        console.warn('未設定 CESIUM_ION_TOKEN，3D 地形資料(World Terrain)可能無法載入。');
    }

    try {
        viewer = new Cesium.Viewer('cesiumContainer', {
            animation: false,
            baseLayerPicker: false,
            fullscreenButton: false,
            geocoder: false,
            homeButton: false,
            infoBox: false,
            sceneModePicker: false,
            selectionIndicator: false,
            timeline: false,
            navigationHelpButton: false,
            navigationInstructionsInitiallyVisible: false,
            terrain: Cesium.Terrain.fromWorldTerrain()
        });

        // Remove the solid black color so the satellite map shows through
        viewer.scene.globe.baseColor = Cesium.Color.BLACK;
        viewer.scene.globe.depthTestAgainstTerrain = true; // Enables physical hiding of objects behind terrain
        
        createCesiumMarker();
    } catch (e) {
        console.error("Cesium init error:", e);
        alert("3D模組載入失敗: " + e.message + "\n請確保網路連線正常。");
    }
}

// --- Data Processing ---

async function handleFileUpload(e) {
    const file = e.target.files[0];
    if (!file) return;
    const text = await file.text();
    parseGPXText(text);
}

function parseGPXText(text) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(text, "text/xml");
    const trkpts = xml.getElementsByTagNameNS('*', 'trkpt');

    let rawPoints = [];
    const kinematicKalman = new KinematicKalmanFilter();
    let lastTime = null;

    Array.from(trkpts).forEach((pt, index) => {
        const rawLat = parseFloat(pt.getAttribute('lat'));
        const rawLon = parseFloat(pt.getAttribute('lon'));
        
        const eleEl = pt.getElementsByTagNameNS('*', 'ele')[0];
        const rawAlt = eleEl ? parseFloat(eleEl.textContent) * 3.28084 : 0;
        
        // Extract Kinematics safely
        const speedEl = pt.getElementsByTagNameNS('*', 'speed')[0];
        const speed = speedEl ? parseFloat(speedEl.textContent) * 1.94384 : 0;

        const headingEl = pt.getElementsByTagNameNS('*', 'heading')[0];
        const heading = headingEl ? parseFloat(headingEl.textContent) : 0;

        const vsiEl = pt.getElementsByTagNameNS('*', 'vsi')[0];
        const vsi = vsiEl ? parseFloat(vsiEl.textContent) : 0;
        
        // Time calculations safely
        const timeEl = pt.getElementsByTagNameNS('*', 'time')[0];
        const rawTimeStr = timeEl ? timeEl.textContent : new Date(Date.now() + index * 1000).toISOString();
        let dateObj = new Date(rawTimeStr);
        if (isNaN(dateObj.getTime())) {
            dateObj = new Date(Date.now() + index * 1000);
        }
        
        let dt = 1; // Default 1 second
        if (lastTime) {
            dt = (dateObj.getTime() - lastTime.getTime()) / 1000;
        }
        lastTime = dateObj;

        // Bypass Kalman Filter for direct routing
        const lat = rawLat;
        const lon = rawLon;
        
        // Bypass MSL conversion for direct gradients
        const alt = rawAlt;
        
        // Convert to Taipei Time (GMT+8) safely
        let time = '00:00:00';
        try {
            time = dateObj.toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour12: false });
        } catch(e) {
            time = dateObj.toTimeString().split(' ')[0];
        }

        rawPoints.push({ lat, lon, alt, speed, vsi, heading, time });
    });

    // Bypass Rotorcraft Deadband Optimization for direct gradients
    missionData = rawPoints;

    updateUI();
}

function updateUI() {
    if (missionData.length === 0) return;

    // Update Sliders
    timeSliders.forEach(slider => {
        slider.max = missionData.length - 1;
        slider.value = 0;
    });
    
    document.getElementById('startTimeLabel').textContent = missionData[0].time;
    document.getElementById('endTimeLabel').textContent = missionData[missionData.length - 1].time;

    // Update Cesium 3D Path
    if (viewer && missionData.length > 0) {
        viewer.entities.removeAll();
        createCesiumMarker();
        if (activeThreatData) {
            drawThreatDome(activeThreatData);
        }
        
        const coords = [];
        missionData.forEach(d => {
            coords.push(d.lon, d.lat, d.alt * 0.3048); // Alt from FT back to M for Cesium
        });
        
        const tempPath = viewer.entities.add({
            id: 'temp_path',
            polyline: {
                positions: Cesium.Cartesian3.fromDegreesArrayHeights(coords),
                width: 3,
                material: new Cesium.PolylineOutlineMaterialProperty({
                    color: Cesium.Color.CYAN,
                    outlineWidth: 1,
                    outlineColor: Cesium.Color.BLACK
                })
            }
        });
        
        setTimeout(() => {
            try {
                // 涵蓋所有 entity（航線、機模型、飛彈威脅圓頂），
                // 避免鏡頭只對準航線而落在威脅圓頂內部，導致圓頂因背面剔除而看不見
                viewer.zoomTo(viewer.entities);
            } catch(e) {
                console.error("viewer.zoomTo failed:", e);
            }
        }, 150);

        // CFIT Analysis: Sample Terrain and color RED if dangerously low
        const cartographics = missionData.map(d => Cesium.Cartographic.fromDegrees(d.lon, d.lat));
        Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartographics).then((updatedPositions) => {
            viewer.entities.removeById('temp_path');
            
            for (let i = 0; i < missionData.length - 1; i++) {
                const pt1 = missionData[i];
                const pt2 = missionData[i+1];
                const alt1 = pt1.alt * 0.3048; // FT to Meters
                const alt2 = pt2.alt * 0.3048;
                
                const terrain1 = updatedPositions[i].height || 0;
                const terrain2 = updatedPositions[i+1].height || 0;
                
                let color = Cesium.Color.CYAN;
                // If altitude is within 30m of terrain or below terrain, mark as RED (CFIT WARNING)
                if (alt1 - terrain1 < 30 || alt2 - terrain2 < 30) {
                    color = Cesium.Color.RED;
                }
                
                viewer.entities.add({
                    polyline: {
                        positions: Cesium.Cartesian3.fromDegreesArrayHeights([
                            pt1.lon, pt1.lat, alt1,
                            pt2.lon, pt2.lat, alt2
                        ]),
                        width: color === Cesium.Color.RED ? 5 : 3, // Make red lines thicker
                        material: color
                    }
                });
            }
        }).catch((err) => {
            console.warn("Terrain sampling failed, keeping default path:", err);
            // Default cyan path is already drawn as temp_path, we just keep it
        });
    }

    seek(0);
}

function seek(index) {
    index = parseInt(index);
    const data = missionData[index];
    if (!data) return;

    currentTimeLabel.textContent = data.time;
    
    // Sync all sliders
    timeSliders.forEach(slider => {
        if (slider.value !== index.toString()) {
            slider.value = index;
        }
    });
    
    // Sync Cesium Marker
    if (is3DMode && viewer && cesiumMarker) {
        const position = Cesium.Cartesian3.fromDegrees(data.lon, data.lat, data.alt * 0.3048);
        cesiumMarker.position = position;
        
        let heading = 0;
        let pitch = 0;

        if (index < missionData.length - 1) {
            const nextData = missionData[index + 1];
            heading = getBearing(data.lat, data.lon, nextData.lat, nextData.lon);
            const dist = getDistance(data.lat, data.lon, nextData.lat, nextData.lon);
            const altDiff = (nextData.alt - data.alt) * 0.3048; // meters
            pitch = dist > 0 ? Math.atan2(altDiff, dist) : 0;
        } else if (index > 0) {
            const prevData = missionData[index - 1];
            heading = getBearing(prevData.lat, prevData.lon, data.lat, data.lon);
        }

        // Apply orientation to 3D Model
        // 為了抵銷大部分預設模型朝向 +X 的特性，Heading 會減去 90 度 (Math.PI/2)
        const hpr = new Cesium.HeadingPitchRoll(
            Cesium.Math.toRadians(heading - 90), 
            pitch, 
            0 // Roll
        );
        cesiumMarker.orientation = Cesium.Transforms.headingPitchRollQuaternion(position, hpr);

        // --- Pilot View Camera Update ---
        if (isPilotView) {
            let heading = 0;
            let pitch = -15; // 視角向下 15 度，以便看見前下方
            
            // Calculate heading to next point
            if (index < missionData.length - 1) {
                const nextData = missionData[index + 1];
                heading = getBearing(data.lat, data.lon, nextData.lat, nextData.lon);
            } else if (index > 0) {
                const prevData = missionData[index - 1];
                heading = getBearing(prevData.lat, prevData.lon, data.lat, data.lon);
            }

            const hpr = new Cesium.HeadingPitchRoll(
                Cesium.Math.toRadians(heading), 
                Cesium.Math.toRadians(pitch), 
                0
            );
            
            // 計算往前推移的座標偏移量，避免機身 (放大 10 倍) 擋住視線
            // 約往前 20 公尺，往上 5 公尺
            const forwardMeters = 20;
            const upMeters = 5;
            
            const latOffset = (forwardMeters / 111320) * Math.cos(Cesium.Math.toRadians(heading));
            const lonOffset = (forwardMeters / (111320 * Math.cos(Cesium.Math.toRadians(data.lat)))) * Math.sin(Cesium.Math.toRadians(heading));
            
            const cameraLat = data.lat + latOffset;
            const cameraLon = data.lon + lonOffset;
            const cameraAlt = data.alt * 0.3048 + upMeters;
            
            viewer.camera.setView({
                destination: Cesium.Cartesian3.fromDegrees(cameraLon, cameraLat, cameraAlt),
                orientation: hpr
            });
        }

    }

}

// --- Event Listeners ---

let isPilotView = false;
let playbackInterval = null;
let currentSpeedMultiplier = 1;
let isPlaying = false;
let lastTick = 0;
let currentPlaybackIdx = 0;

const pilotViewBtn = document.getElementById('pilotViewBtn');
const playbackControls = document.getElementById('playbackControls');

if (pilotViewBtn) {
    pilotViewBtn.addEventListener('click', () => {
        isPilotView = !isPilotView;
        pilotViewBtn.textContent = isPilotView ? 'PILOT VIEW: ON' : 'PILOT VIEW: OFF';
        pilotViewBtn.style.backgroundColor = isPilotView ? '#44cc44' : '#222';
        pilotViewBtn.style.color = isPilotView ? '#000' : 'var(--neon-blue)';
        
        // 為了確保「完全不被機身擋到」，在飛行員視角時直接隱藏直升機模型
        if (cesiumMarker) {
            cesiumMarker.show = !isPilotView;
        }

        // 顯示或隱藏播放控制列
        if (playbackControls) {
            playbackControls.style.display = isPilotView ? 'flex' : 'none';
        }
        
        // 如果關閉了 Pilot View，自動停止播放
        if (!isPilotView && isPlaying) {
            const playBtn = document.getElementById('playBtn');
            if (playBtn) playBtn.click();
        }

        if (!isPilotView && viewer && viewer.entities) {
            viewer.zoomTo(viewer.entities);
        } else {
            const sliders = document.querySelectorAll('.time-slider');
            if (sliders.length > 0) {
                seek(parseInt(sliders[0].value) || 0);
            }
        }
    });
}

const playBtn = document.getElementById('playBtn');
if (playBtn) {
    playBtn.addEventListener('click', () => {
        isPlaying = !isPlaying;
        playBtn.textContent = isPlaying ? '⏸ PAUSE' : '▶ PLAY';
        if (isPlaying) {
            startPlayback();
        } else {
            stopPlayback();
        }
    });
}

const speedCycleBtn = document.getElementById('speedCycleBtn');
const speeds = [1, 3, 5, 10, 20, 30];
let currentSpeedIndex = 0;

if (speedCycleBtn) {
    speedCycleBtn.addEventListener('click', () => {
        currentSpeedIndex = (currentSpeedIndex + 1) % speeds.length;
        currentSpeedMultiplier = speeds[currentSpeedIndex];
        speedCycleBtn.textContent = `SPEED: ${currentSpeedMultiplier}X`;
        
        if (currentSpeedMultiplier === 1) {
            speedCycleBtn.style.background = 'var(--tactical-gold)';
            speedCycleBtn.style.color = '#000';
        } else {
            speedCycleBtn.style.background = '#d9534f'; // 紅色警示，代表高速播放
            speedCycleBtn.style.color = '#fff';
        }
    });
}

function startPlayback() {
    if (playbackInterval) cancelAnimationFrame(playbackInterval);
    lastTick = performance.now();
    const slider = document.getElementById('mainTimeSlider');
    currentPlaybackIdx = parseFloat(slider.value) || 0;
    
    // 如果已經在最後，從頭開始
    if (currentPlaybackIdx >= missionData.length - 1) {
        currentPlaybackIdx = 0;
    }

    function loop(now) {
        if (!isPlaying) return;
        
        // 基礎速率: 1X = 每秒前進 2 個點 (以確保不會太慢)
        const basePointsPerSec = 2;
        const deltaSec = (now - lastTick) / 1000;
        lastTick = now;
        
        const advanceAmount = basePointsPerSec * currentSpeedMultiplier * deltaSec;
        currentPlaybackIdx += advanceAmount;
        
        if (currentPlaybackIdx >= missionData.length - 1) {
            currentPlaybackIdx = missionData.length - 1;
            seek(Math.floor(currentPlaybackIdx));
            if (playBtn) playBtn.click(); // 自動暫停
            return;
        }
        
        seek(Math.floor(currentPlaybackIdx));
        playbackInterval = requestAnimationFrame(loop);
    }
    
    playbackInterval = requestAnimationFrame(loop);
}

function stopPlayback() {
    isPlaying = false;
    if (playbackInterval) {
        cancelAnimationFrame(playbackInterval);
        playbackInterval = null;
    }
}



importBtn.addEventListener('click', () => fileInput.click());
const backBtn = document.getElementById('backBtn');
if (backBtn) {
    backBtn.addEventListener('click', () => {
        // 嘗試直接關閉分頁 (若是被 window.open 打開的)
        window.close();
        // 如果瀏覽器阻擋腳本關閉視窗，則退回上一頁
        setTimeout(() => {
            window.location.href = '../index.html';
        }, 100);
    });
}
fileInput.addEventListener('change', handleFileUpload);
timeSliders.forEach(slider => {
    slider.addEventListener('input', (e) => seek(e.target.value));
});

window.onload = () => {
    initCesium();

    let gpxLoadedFromStorage = false;

    // 1) 優先讀網址 hash 中挾帶的資料。file:// 雙擊開啟時，index.html 與
    //    FDR/analysis.html 常被瀏覽器視為不同來源，sessionStorage 及 window.opener
    //    都不保證跨分頁可用；直接掛在網址上是唯一保證能送達的方式。
    if (location.hash && location.hash.indexOf('#data=') === 0) {
        try {
            const payload = JSON.parse(decodeURIComponent(location.hash.slice('#data='.length)));
            if (payload.threat) {
                activeThreatData = payload.threat;
                if (viewer) drawThreatDome(activeThreatData);
            }
            if (payload.gpx) {
                parseGPXText(payload.gpx);
                gpxLoadedFromStorage = true;
            }
        } catch (e) {
            console.error("Failed to parse mission data from URL hash:", e);
        }
    }

    // 2) 次要：sessionStorage（同來源情境下可用，例如透過本機伺服器開啟）
    if (!gpxLoadedFromStorage) {
        const storedThreat = sessionStorage.getItem('mission_threat');
        if (storedThreat) {
            try {
                activeThreatData = JSON.parse(storedThreat);
                if (viewer) drawThreatDome(activeThreatData);
            } catch (e) {
                console.error(e);
            }
        }

        const storedGpx = sessionStorage.getItem('mission_gpx');
        if (storedGpx) {
            parseGPXText(storedGpx);
            sessionStorage.removeItem('mission_gpx');
            gpxLoadedFromStorage = true;
        }
    }

    // 3) 最後備援：postMessage 跟開啟者要資料
    // 只有在前兩種方式都沒能帶入航路資料時才使用，避免同一份資料被重複載入、
    // 導致 updateUI() 的 removeAll()/zoomTo() 互相搶跑，鏡頭抓到空的 entity 集合而看不到航路
    if (!gpxLoadedFromStorage && window.opener) {
        console.log("Requesting mission data from opener via postMessage...");
        window.opener.postMessage({ type: 'REQUEST_MISSION_DATA' }, '*');
    }
};

// 監聽來自父分頁的 postMessage 資料傳遞
window.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'DELIVER_MISSION_DATA') {
        console.log("Successfully received mission data via postMessage bridge!");
        if (event.data.threat) {
            activeThreatData = event.data.threat;
        }
        if (event.data.gpx) {
            parseGPXText(event.data.gpx);
        }
    }
});
