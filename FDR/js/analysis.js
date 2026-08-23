// js/config.js 未被提交到 git，在沒有該檔案的環境(如剛 clone 下來或部署後)
// APP_CONFIG 會是 undefined，避免整支 script 因此中斷，改為降級為停用 3D 地形 token
if (typeof APP_CONFIG === 'undefined') {
    console.warn('js/config.js 不存在：Cesium 3D 地形 token 未設定，3D 預覽將無法載入地形資料。');
    window.APP_CONFIG = { LOGIN_PASSWORD: null, CESIUM_ION_TOKEN: null };
}

let activeThreatData = null;
let activeViewshedImage = null;
let activeRestrictedAreas = [];
let activeUasAreas = [];
let activePowerLines = null;
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

// 沿指定方位角、距離推算目的地座標 (球面大圓，跟 getBearing/getDistance 同一套簡化模型)
function destinationPoint(lat, lng, bearingRad, distM) {
    const R = 6371e3;
    const delta = distM / R;
    const phi1 = lat * Math.PI / 180, lambda1 = lng * Math.PI / 180;
    const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(bearingRad));
    const lambda2 = lambda1 + Math.atan2(Math.sin(bearingRad) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
    return { lat: phi2 * 180 / Math.PI, lng: lambda2 * 180 / Math.PI };
}

// 對飛彈周圍每個方位角做地形剖面掃描，找出「地形水平線」的最大遮蔽仰角(maxSlope)。
// 邏輯與地圖端(main.js)的防空隱蔽分析(viewshed)一致：某方向若有高山擋住視線，
// 該方向的水平線就會被墊高，圓頂在該方向的底部也要跟著墊高，代表低於此處看不到目標。
async function computeTerrainHorizon(centerLat, centerLng, rangeNm, bearingsCount, samplesPerBearing) {
    const rangeM = rangeNm * 1852;
    const cartographics = [];
    const meta = [];

    for (let b = 0; b < bearingsCount; b++) {
        const bearingRad = (b / bearingsCount) * 2 * Math.PI;
        for (let s = 1; s <= samplesPerBearing; s++) {
            const distM = (s / samplesPerBearing) * rangeM;
            const dest = destinationPoint(centerLat, centerLng, bearingRad, distM);
            cartographics.push(Cesium.Cartographic.fromDegrees(dest.lng, dest.lat));
            meta.push({ b, distM });
        }
    }
    cartographics.push(Cesium.Cartographic.fromDegrees(centerLng, centerLat)); // 飛彈自身位置，取地面高度

    const sampled = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartographics);
    const missileElev = sampled[sampled.length - 1].height || 0;

    const maxSlopePerBearing = new Array(bearingsCount).fill(-Infinity);
    for (let i = 0; i < meta.length; i++) {
        const h = sampled[i].height || 0;
        const { b, distM } = meta[i];
        const curvatureDrop = (distM * distM) / 12742000; // 地球曲率修正，跟 2D 端同公式
        const slope = (h - curvatureDrop - missileElev) / Math.max(distM, 1);
        if (slope > maxSlopePerBearing[b]) maxSlopePerBearing[b] = slope;
    }

    return { missileElev, maxSlopePerBearing };
}

let threatDomeEntities = [];

// Cesium.Terrain.fromWorldTerrain() 是非同步載入的：viewer 建立當下 viewer.terrainProvider
// 通常還是預設的平面橢球體地形(沒有 .availability)，這時呼叫 sampleTerrainMostDetailed 會直接丟例外。
// 輪詢等到真正的地形資料就緒(出現 .availability)再繼續，逾時就放棄讓外層 catch 走退回方案。
function waitForTerrainReady(timeoutMs) {
    return new Promise((resolve, reject) => {
        const start = Date.now();
        (function check() {
            if (viewer && viewer.terrainProvider && viewer.terrainProvider.availability) {
                resolve();
            } else if (Date.now() - start > timeoutMs) {
                reject(new Error('地形資料載入逾時'));
            } else {
                setTimeout(check, 200);
            }
        })();
    });
}

let threatViewshedLayer = null;
let threatDomePrimitives = [];

function removeThreatDomeVisuals() {
    threatDomeEntities.forEach(ent => { try { viewer.entities.remove(ent); } catch (e) { } });
    threatDomeEntities = [];
    threatDomePrimitives.forEach(prim => { try { viewer.scene.primitives.remove(prim); } catch (e) { } });
    threatDomePrimitives = [];
    if (threatViewshedLayer) {
        try { viewer.imageryLayers.remove(threatViewshedLayer); } catch (e) { }
        threatViewshedLayer = null;
    }
}

// 把多層高度切片(polygonSlices，由低到高每層都是以飛彈為中心的星形多邊形邊界)
// 組成一個立體網格：側面用相鄰兩層之間逐段連成三角形，底面/頂面用「以飛彈位置為圓心」的
// 扇形三角化封起來(邊界本身保證是星形、不自相交，所以扇形三角化一定合法)。
// 這樣拉出來的形狀會隨高度自然展開變寬，某方向若連天花板都被地形擋住(該層邊界趨近飛彈位置本身)，
// 堆疊起來就會呈現自然內凹的缺口，而不是同一個平面形狀直接拉伸成的柱體。
function buildThreatDomePrimitive(polygonSlices, centerLng, centerLat) {
    const slices = (polygonSlices || []).filter(s => s && Array.isArray(s.ring) && s.ring.length > 2);
    if (slices.length < 2) return null;
    const vertsPerRing = slices[0].ring.length;
    for (const s of slices) {
        if (s.ring.length !== vertsPerRing) return null; // 每層頂點數應該一致，不一致就放棄改用備援方案
    }

    const positions = [];
    slices.forEach(s => {
        s.ring.forEach(pt => {
            const c = Cesium.Cartesian3.fromDegrees(pt[0], pt[1], s.altM);
            positions.push(c.x, c.y, c.z);
        });
    });
    const bottomCenter = Cesium.Cartesian3.fromDegrees(centerLng, centerLat, slices[0].altM);
    const topCenter = Cesium.Cartesian3.fromDegrees(centerLng, centerLat, slices[slices.length - 1].altM);
    const bottomCenterIdx = positions.length / 3;
    positions.push(bottomCenter.x, bottomCenter.y, bottomCenter.z);
    const topCenterIdx = bottomCenterIdx + 1;
    positions.push(topCenter.x, topCenter.y, topCenter.z);

    const indices = [];
    const N = vertsPerRing - 1; // 每層最後一點是封閉環重複的第一點，實際邊數是 N

    for (let k = 0; k < slices.length - 1; k++) {
        const baseA = k * vertsPerRing;
        const baseB = (k + 1) * vertsPerRing;
        for (let i = 0; i < N; i++) {
            const a0 = baseA + i, a1 = baseA + i + 1;
            const b0 = baseB + i, b1 = baseB + i + 1;
            indices.push(a0, a1, b0);
            indices.push(a1, b1, b0);
        }
    }
    for (let i = 0; i < N; i++) {
        indices.push(bottomCenterIdx, i + 1, i);
    }
    const topBase = (slices.length - 1) * vertsPerRing;
    for (let i = 0; i < N; i++) {
        indices.push(topCenterIdx, topBase + i, topBase + i + 1);
    }

    const geometry = new Cesium.Geometry({
        attributes: {
            position: new Cesium.GeometryAttribute({
                componentDatatype: Cesium.ComponentDatatype.DOUBLE,
                componentsPerAttribute: 3,
                values: new Float64Array(positions)
            })
        },
        indices: new Uint32Array(indices),
        primitiveType: Cesium.PrimitiveType.TRIANGLES,
        boundingSphere: Cesium.BoundingSphere.fromVertices(positions)
    });

    const instance = new Cesium.GeometryInstance({
        geometry: geometry,
        attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(Cesium.Color.RED.withAlpha(0.35))
        }
    });

    // closed 保持預設(false) 不啟用背面剔除，避免手刻三角形時繞向沒抓對導致某些角度看不到
    return new Cesium.Primitive({
        geometryInstances: instance,
        appearance: new Cesium.PerInstanceColorAppearance({ flat: true, translucent: true }),
        asynchronous: false
    });
}

async function drawThreatDome(threatData, viewshedImage) {
    if (!viewer || !threatData) return;

    removeThreatDomeVisuals();

    // 最優方案：地圖端(main.js)在逐角度掃描地形時，同步算出多層高度切片(polygonSlices)的
    // 可偵測邊界，組成隨高度展開、缺口自然內凹的立體網格。
    if (viewshedImage && Array.isArray(viewshedImage.polygonSlices) && viewshedImage.polygonSlices.length >= 2) {
        try {
            const primitive = buildThreatDomePrimitive(viewshedImage.polygonSlices, threatData.lng, threatData.lat);
            if (primitive) {
                viewer.scene.primitives.add(primitive);
                threatDomePrimitives.push(primitive);
                return;
            }
        } catch (e) {
            console.error('威脅範圍立體網格繪製失敗，改用單層拉伸:', e);
            showCesiumWarning('威脅範圍立體網格繪製失敗，已改用較簡化的單層拉伸。錯誤原因：' + (e && e.message ? e.message : e));
        }
    }

    // 次要方案：地圖端(main.js)在逐角度掃描地形時，同步記錄了每個角度「目標高度仍可被偵測到」
    // 的最遠距離，這些點連起來天生就是一個平滑、不自相交的多邊形(星形polygon)，
    // 不需要額外做等高線追蹤。
    // 拉伸範圍是「設定高度 -> 天花板」，不是「地面 -> 設定高度」：
    // 同一個地面位置，飛得越高，越容易超過地形遮蔽角而被偵測到(targetSlope 隨高度增加而增加、
    // maxSlope 只跟地形有關、不受高度影響)，所以「設定高度以上」保證仍在此範圍內可被偵測到；
    // 反過來「設定高度以下」並未實際驗證過，很可能因為地形遮蔽反而看不到，畫進去會誤導。
    if (viewshedImage && Array.isArray(viewshedImage.polygon) && viewshedImage.polygon.length > 3) {
        try {
            const degreesArray = [];
            viewshedImage.polygon.forEach(pt => { degreesArray.push(pt[0], pt[1]); });
            const targetAltM = (threatData.altFt || 500) * 0.3048;
            // 天花板用雷達本身的最大偵測距離(斜距)當上限，不是隨便設一個常數：
            // 雷達在正上方時，能偵測到的最大高度差 = 最大偵測距離(斜距不可能超過雷達的最大射程)。
            // 用威脅源地面高程(missileElev，2D 端算好一併帶過來) + 設定的距離(rangeNm) 換算。
            const rangeM = (threatData.rangeNm || 0) * 1852;
            const missileElev = (typeof viewshedImage.missileElev === 'number') ? viewshedImage.missileElev : targetAltM;
            const ceilingM = Math.max(missileElev + rangeM, targetAltM + 100);

            const entity = viewer.entities.add({
                name: '雷達可偵測範圍(立體，設定高度以上)',
                polygon: {
                    hierarchy: Cesium.Cartesian3.fromDegreesArray(degreesArray),
                    height: targetAltM,
                    extrudedHeight: ceilingM,
                    material: Cesium.Color.RED.withAlpha(0.35),
                    outline: true,
                    outlineColor: Cesium.Color.RED.withAlpha(0.9),
                    outlineWidth: 2,
                    perPositionHeight: false,
                    closeTop: true,
                    closeBottom: true
                }
            });
            threatDomeEntities.push(entity);
            return;
        } catch (e) {
            console.error('威脅範圍立體多邊形繪製失敗，改用平面貼圖:', e);
            showCesiumWarning('威脅範圍立體多邊形繪製失敗，已改用平面貼圖。錯誤原因：' + (e && e.message ? e.message : e));
        }
    }

    // 次要方案：直接沿用地圖端(main.js 防空隱蔽分析)已經逐點算好的雷達可偵測範圍遮罩圖，
    // 貼到地球表面上(跟貼衛星圖同一種機制，會自動服貼地形)。這張圖本來就已經考慮了地形遮蔽、
    // 地球曲率、以及同一方向不同距離的差異，不是只依方位角的簡化估算，
    // 確保 3D 看到的可偵測範圍跟 2D 地圖上完全一致。
    if (viewshedImage && viewshedImage.dataUrl && viewshedImage.bounds) {
        try {
            const b = viewshedImage.bounds;
            const rectangle = Cesium.Rectangle.fromDegrees(b.west, b.south, b.east, b.north);
            const provider = await Cesium.SingleTileImageryProvider.fromUrl(viewshedImage.dataUrl, { rectangle: rectangle });
            threatViewshedLayer = viewer.imageryLayers.addImageryProvider(provider);
            threatViewshedLayer.alpha = 0.75;
            return;
        } catch (e) {
            console.error('威脅範圍遮罩圖貼圖失敗，改用簡化的方位角地形水平線估算:', e);
            showCesiumWarning('威脅範圍遮罩圖貼圖失敗，已改用較粗略的方位角地形遮蔽估算。錯誤原因：' + (e && e.message ? e.message : e));
        }
    }

    // 備援方案(沒有遮罩圖，或貼圖失敗時)：退回用方位角地形水平線做簡化估算。
    // 注意這個方法沒辦法呈現「同一方向、不同距離遮蔽程度不同」的情況，精確度不如遮罩圖。
    const rangeM = threatData.rangeNm * 1852;
    const targetAltM = (threatData.altFt || 500) * 0.3048;
    const ceilingM = Math.max(targetAltM * 2, 6000);
    const bearingsCount = 72; // 每 5 度一條剖面

    try {
        await waitForTerrainReady(8000);
        const { missileElev, maxSlopePerBearing } = await computeTerrainHorizon(threatData.lat, threatData.lng, threatData.rangeNm, bearingsCount, 12);

        const curvatureDropAtRange = (rangeM * rangeM) / 12742000;
        const floors = [];
        for (let bi = 0; bi < bearingsCount; bi++) {
            let floor = missileElev + maxSlopePerBearing[bi] * rangeM + curvatureDropAtRange;
            floor = Math.max(floor, missileElev); // 不低於地面
            floor = Math.min(floor, ceilingM - 10); // 不高於天花板
            floors.push(floor);
        }

        // 除錯用：把每個方位角被地形墊高多少(公尺)記到 console，方便確認地形遮蔽計算是否真的有算出差異
        const aboveGround = floors.map(f => f - missileElev);
        console.log('威脅圓頂地形遮蔽統計(公尺，高於飛彈自身地面高度)：最小', Math.min(...aboveGround).toFixed(0),
            '最大', Math.max(...aboveGround).toFixed(0), '平均', (aboveGround.reduce((a, b) => a + b, 0) / aboveGround.length).toFixed(0));

        // 每個方位角區間各畫一段獨立的牆，並依「被地形遮蔽的程度」上色：
        // 貼近地面(幾乎沒被遮蔽) = 鮮紅色，遮蔽越多(牆底墊得越高) = 越偏暗灰色，
        // 這樣不管高度差在畫面上明不明顯，一眼就能看出哪些方向被排除在威脅範圍外。
        const MASK_COLOR_REF_M = 1500; // 遮蔽程度達到這個高度差時，顏色會變到最暗
        for (let b = 0; b < bearingsCount; b++) {
            const biA = b;
            const biB = (b + 1) % bearingsCount;
            const bearingRadA = (biA / bearingsCount) * 2 * Math.PI;
            const bearingRadB = (biB / bearingsCount) * 2 * Math.PI;
            const destA = destinationPoint(threatData.lat, threatData.lng, bearingRadA, rangeM);
            const destB = destinationPoint(threatData.lat, threatData.lng, bearingRadB, rangeM);

            const t = Math.max(0, Math.min(1, ((aboveGround[biA] + aboveGround[biB]) / 2) / MASK_COLOR_REF_M));
            const segColor = Cesium.Color.lerp(Cesium.Color.RED, Cesium.Color.SLATEGRAY, t, new Cesium.Color());

            const entity = viewer.entities.add({
                name: 'Missile Threat Coverage (Terrain-Masked)',
                wall: {
                    positions: Cesium.Cartesian3.fromDegreesArray([destA.lng, destA.lat, destB.lng, destB.lat]),
                    minimumHeights: [floors[biA], floors[biB]],
                    maximumHeights: [ceilingM, ceilingM],
                    material: segColor.withAlpha(0.4),
                    outline: true,
                    outlineColor: segColor.withAlpha(0.9)
                }
            });
            threatDomeEntities.push(entity);
        }
    } catch (e) {
        console.error("地形水平線計算失敗，改用未考慮地形遮蔽的簡易圓頂:", e);
        showCesiumWarning('飛彈威脅圓頂的地形遮蔽計算失敗，已改用未排除遮蔽區域的簡易圓頂。錯誤原因：' + (e && e.message ? e.message : e));
        try {
            const radiusMeters = rangeM;
            const entity = viewer.entities.add({
                name: 'Missile Threat Dome (fallback)',
                position: Cesium.Cartesian3.fromDegrees(threatData.lng, threatData.lat, 0),
                ellipsoid: {
                    radii: new Cesium.Cartesian3(radiusMeters, radiusMeters, radiusMeters),
                    material: Cesium.Color.RED.withAlpha(0.3),
                    outline: true,
                    outlineColor: Cesium.Color.RED.withAlpha(0.8),
                    maximumCone: Cesium.Math.PI_OVER_TWO
                }
            });
            threatDomeEntities.push(entity);
        } catch (e2) {
            console.error("Error drawing fallback threat dome:", e2);
        }
    }
}

// 把限制空域/UAS訓練空域的圓形範圍近似成多邊形，供 Cesium polygon hierarchy 使用
// (地圖端(main.js)的圓已經是用中心點+半徑表示，這裡用簡易平面投影取樣圓周，
// 半徑通常只有幾十公里，這個近似誤差可忽略)
function circleToDegreesPositions(centerLng, centerLat, radiusM, steps) {
    steps = steps || 48;
    const positions = [];
    const latPerM = 1 / 111320;
    const lonPerM = 1 / (111320 * Math.cos(centerLat * Math.PI / 180));
    for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * 2 * Math.PI;
        const lng = centerLng + radiusM * Math.sin(angle) * lonPerM;
        const lat = centerLat + radiusM * Math.cos(angle) * latPerM;
        positions.push(lng, lat);
    }
    return positions;
}

// 畫出限制空域/UAS訓練空域：以下限~上限高度擠出(extrude)成 3D 立體柱狀空域，
// 這樣可以直接目視判斷飛航路線的高度剖面有沒有穿過這些空域
function drawAirspaceVolumes(areas, colorHex, labelPrefix) {
    if (!viewer || !areas || !areas.length) return;
    const color = Cesium.Color.fromCssColorString(colorHex);

    areas.forEach(area => {
        try {
            const g = area.geometry || {};
            let degreesArray = null;

            if (area.geometry_type === 'polygon' && g.points && g.points.length > 2) {
                degreesArray = [];
                g.points.forEach(p => { degreesArray.push(p[0], p[1]); });
            } else if (area.geometry_type === 'circle' && g.center) {
                const radiusNm = g.radius_nm != null ? g.radius_nm : (g.radius_m != null ? g.radius_m / 1852 : null);
                if (radiusNm == null) return;
                degreesArray = circleToDegreesPositions(g.center[0], g.center[1], radiusNm * 1852);
            } else if (g.circle_part && g.circle_part.center && g.circle_part.radius_nm != null) {
                degreesArray = circleToDegreesPositions(g.circle_part.center[0], g.circle_part.center[1], g.circle_part.radius_nm * 1852);
            }

            if (!degreesArray) return;

            const lowerM = (area.lower_limit_ft || 0) * 0.3048;
            const upperM = (area.upper_limit_ft != null ? area.upper_limit_ft : 5000) * 0.3048;

            viewer.entities.add({
                name: `${labelPrefix || ''}${area.name || area.id}`,
                polygon: {
                    hierarchy: Cesium.Cartesian3.fromDegreesArray(degreesArray),
                    height: lowerM,
                    extrudedHeight: Math.max(upperM, lowerM + 10),
                    material: color.withAlpha(0.3),
                    outline: true,
                    outlineColor: color.withAlpha(0.9),
                    perPositionHeight: false
                }
            });
        } catch (e) {
            console.error('Error drawing airspace volume:', area && area.id, e);
        }
    });
}

// 畫出已下載的高壓電纜線段/電塔，紅色點線表示。
// 不用 clampToGround 貼地線：Cesium 的貼地線材質在地形資料還沒就緒時常會靜默失敗(不丟錯誤、就是不畫)，
// 跟飛彈圓頂遇到的地形時機問題同一類。改成實際批次取樣地形高度，把電纜線抬高一點畫成一般 3D 線，
// 避開貼地線這條限制較多的算繪路徑；取樣失敗時才退回 clampToGround 當作備援。
//
// 每條線/每個電塔各自獨立 try/catch：先把這次要用到的取樣結果切一段出來(不管後面成不成功，
// cursor 都會先往前推進)，再嘗試建立 entity。這樣任何一條線資料異常導致例外，
// 都不會拖累後面其他線段、也不會拖累電塔完全不畫出來(先前的版本是全部包在同一個 try 裡)。
async function drawPowerLines(powerData) {
    if (!viewer || !powerData) return;
    const lines = (powerData.lines || []).filter(l => l && l.length > 1);
    const towers = powerData.towers || [];
    if (!lines.length && !towers.length) return;

    const cartographics = [];
    lines.forEach(line => line.forEach(p => cartographics.push(Cesium.Cartographic.fromDegrees(p[0], p[1]))));
    towers.forEach(t => cartographics.push(Cesium.Cartographic.fromDegrees(t[0], t[1])));

    let sampled = null;
    if (viewer.terrainProvider && viewer.terrainProvider.availability) {
        try {
            const result = await Cesium.sampleTerrainMostDetailed(viewer.terrainProvider, cartographics);
            if (result && result.length === cartographics.length) {
                sampled = result;
            } else {
                console.warn('高壓電纜地形取樣結果數量與座標點數不符，改用貼地線繪製。', result && result.length, cartographics.length);
                showCesiumWarning('高壓電纜地形取樣結果數量異常，改用貼地線繪製(電纜可能因此顯示不出來)。');
            }
        } catch (e) {
            console.warn('高壓電纜地形取樣失敗，改用貼地線繪製:', e);
            showCesiumWarning('高壓電纜地形取樣失敗，改用貼地線繪製(電纜可能因此顯示不出來)。錯誤原因：' + (e && e.message ? e.message : e));
        }
    }

    // 電纜實際高度未知，用高壓電塔常見高度概估(約30公尺)。每個線段頂點在 OSM 資料裡
    // 通常就對應一座電塔的實際位置，各自抬高到自己所在地形高度+塔高後再逐點連線，
    // 呈現的就是「懸掛在各電塔之間」的走向，而不是貼著地形起伏走
    const CABLE_HEIGHT_OFFSET_M = 30;

    let cursor = 0;
    let lineErrorCount = 0;
    lines.forEach(line => {
        const lineSamples = sampled ? sampled.slice(cursor, cursor + line.length) : null;
        if (sampled) cursor += line.length;

        try {
            let positions;
            if (lineSamples) {
                const flat = [];
                line.forEach((p, idx) => {
                    const s = lineSamples[idx];
                    const h = (s && s.height != null ? s.height : 0) + CABLE_HEIGHT_OFFSET_M;
                    flat.push(p[0], p[1], h);
                });
                positions = Cesium.Cartesian3.fromDegreesArrayHeights(flat);
            } else {
                const flat = [];
                line.forEach(p => flat.push(p[0], p[1]));
                positions = Cesium.Cartesian3.fromDegreesArray(flat);
            }

            viewer.entities.add({
                name: '高壓電纜',
                polyline: {
                    positions: positions,
                    width: 3,
                    clampToGround: !lineSamples,
                    material: new Cesium.PolylineDashMaterialProperty({
                        color: Cesium.Color.RED,
                        dashLength: 16
                    })
                }
            });
        } catch (e) {
            lineErrorCount++;
            console.error('繪製單一電纜線段失敗:', e);
        }
    });
    if (lineErrorCount) {
        console.error(`高壓電纜：共 ${lineErrorCount}/${lines.length} 條線段繪製失敗`);
        showCesiumWarning(`高壓電纜：${lines.length} 條線段中有 ${lineErrorCount} 條繪製失敗，詳細錯誤請查看瀏覽器 Console。`);
    }

    let towerErrorCount = 0;
    towers.forEach(t => {
        const towerSample = sampled ? sampled[cursor] : null;
        if (sampled) cursor++;

        try {
            let position, heightReference;
            if (towerSample) {
                position = Cesium.Cartesian3.fromDegrees(t[0], t[1], towerSample.height != null ? towerSample.height : 0);
                heightReference = Cesium.HeightReference.NONE;
            } else {
                position = Cesium.Cartesian3.fromDegrees(t[0], t[1]);
                heightReference = Cesium.HeightReference.CLAMP_TO_GROUND;
            }

            viewer.entities.add({
                name: '電塔',
                position: position,
                point: {
                    pixelSize: 6,
                    color: Cesium.Color.RED,
                    outlineColor: Cesium.Color.BLACK,
                    outlineWidth: 1,
                    heightReference: heightReference
                }
            });
        } catch (e) {
            towerErrorCount++;
            console.error('繪製單一電塔失敗:', e);
        }
    });
    if (towerErrorCount) console.error(`電塔：共 ${towerErrorCount}/${towers.length} 個繪製失敗`);
}

// 在畫面上顯示一個顯眼的警告框(不用開發人員工具也看得到)，用來標示 Cesium token/地形載入問題。
// 多次呼叫會疊加訊息(換行分隔)，讓同一次載入期間發生的好幾個問題可以一次看到，不用重新整理反覆測試。
function showCesiumWarning(message) {
    const el = document.getElementById('cesium-token-warning');
    if (!el) return;
    const line = '⚠️ ' + message;
    el.textContent = el.style.display === 'block' && el.textContent ? (el.textContent + '\n\n' + line) : line;
    el.style.display = 'block';
}

function initCesium() {
    if (viewer || typeof Cesium === 'undefined') return;

    if (APP_CONFIG.CESIUM_ION_TOKEN) {
        Cesium.Ion.defaultAccessToken = APP_CONFIG.CESIUM_ION_TOKEN;
    } else {
        console.warn('未設定 CESIUM_ION_TOKEN，3D 地形資料(World Terrain)可能無法載入。');
        showCesiumWarning('未偵測到 Cesium Ion Token（js/config.js 不存在，或裡面沒有設定 CESIUM_ION_TOKEN）。3D 地形/衛星圖資、飛彈威脅圓頂的地形遮蔽計算、高壓電纜立體線都需要這組 token 才能運作，目前只會顯示航路線與空域幾何形狀。');
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

        // Token有設定的情況下，額外確認地形資料實際上有沒有真的就緒(Token 可能無效/過期/網路連不到 cesium.com)，
        // 這種情況跟「根本沒設定 token」屬於不同原因，訊息也要分開顯示
        if (APP_CONFIG.CESIUM_ION_TOKEN) {
            waitForTerrainReady(8000).catch(() => {
                showCesiumWarning('Cesium 3D 地形資料逾時未能載入（Token 可能無效、已過期，或這台伺服器的網路連不到 cesium.com）。目前只會顯示航路線與空域幾何形狀。');
            });
        }
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
            drawThreatDome(activeThreatData, activeViewshedImage);
        }
        if (activeRestrictedAreas && activeRestrictedAreas.length) {
            drawAirspaceVolumes(activeRestrictedAreas, '#0080FF', '🚧 ');
        }
        if (activeUasAreas && activeUasAreas.length) {
            drawAirspaceVolumes(activeUasAreas, '#FF9800', '🛸 ');
        }
        if (activePowerLines) {
            drawPowerLines(activePowerLines);
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

function seek(rawIndex) {
    const maxIndex = missionData.length - 1;
    if (maxIndex < 0) return;
    // 播放時傳進來的是連續的小數(每個 requestAnimationFrame 都會推進一點點)，
    // 在兩個航跡點之間用線性內插算出當下畫面該顯示的位置，而不是等 index 整數進位才跳一次，
    // 這樣不管原始航跡點間距多寬，播放起來都會是連續移動而不是格放跳格；
    // 手動拖曳時間軸傳進來的一定是整數，frac 會是 0，行為跟以前完全一樣
    const index = Math.max(0, Math.min(parseFloat(rawIndex) || 0, maxIndex));
    const i0 = Math.floor(index);
    const i1 = Math.min(i0 + 1, maxIndex);
    const frac = index - i0;

    const d0 = missionData[i0];
    const d1 = missionData[i1];
    if (!d0) return;

    const data = {
        lat: d0.lat + (d1.lat - d0.lat) * frac,
        lon: d0.lon + (d1.lon - d0.lon) * frac,
        alt: d0.alt + (d1.alt - d0.alt) * frac,
        time: d0.time
    };

    currentTimeLabel.textContent = data.time;

    // Sync all sliders (滑桿本身仍然對齊整數點，避免拖曳體驗變得怪異)
    const sliderIndex = Math.round(index);
    timeSliders.forEach(slider => {
        if (slider.value !== sliderIndex.toString()) {
            slider.value = sliderIndex;
        }
    });

    // Sync Cesium Marker
    if (is3DMode && viewer && cesiumMarker) {
        const position = Cesium.Cartesian3.fromDegrees(data.lon, data.lat, data.alt * 0.3048);
        cesiumMarker.position = position;

        let heading = 0;
        let pitch = 0;

        if (i0 < maxIndex) {
            heading = getBearing(d0.lat, d0.lon, d1.lat, d1.lon);
            const dist = getDistance(d0.lat, d0.lon, d1.lat, d1.lon);
            const altDiff = (d1.alt - d0.alt) * 0.3048; // meters
            pitch = dist > 0 ? Math.atan2(altDiff, dist) : 0;
        } else if (i0 > 0) {
            const prevData = missionData[i0 - 1];
            heading = getBearing(prevData.lat, prevData.lon, d0.lat, d0.lon);
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
            let pitch2 = -15; // 視角向下 15 度，以便看見前下方

            const hpr2 = new Cesium.HeadingPitchRoll(
                Cesium.Math.toRadians(heading),
                Cesium.Math.toRadians(pitch2),
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
                orientation: hpr2
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
            seek(currentPlaybackIdx);
            if (playBtn) playBtn.click(); // 自動暫停
            return;
        }

        // 傳小數進去，seek() 會在相鄰兩個航跡點之間內插，每一幀畫面都會連續移動，
        // 不再是等累積滿一個整數點才跳一次(之前這裡是 Math.floor，會格放)
        seek(currentPlaybackIdx);
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
            if (payload.viewshedImage) activeViewshedImage = payload.viewshedImage;
            if (payload.threat) {
                activeThreatData = payload.threat;
                if (viewer) drawThreatDome(activeThreatData, activeViewshedImage);
            }
            if (payload.restrictedAreas) activeRestrictedAreas = payload.restrictedAreas;
            if (payload.uasAreas) activeUasAreas = payload.uasAreas;
            if (payload.powerLines) activePowerLines = payload.powerLines;
            if (viewer) {
                drawAirspaceVolumes(activeRestrictedAreas, '#0080FF', '🚧 ');
                drawAirspaceVolumes(activeUasAreas, '#FF9800', '🛸 ');
                drawPowerLines(activePowerLines);
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
        try {
            const storedViewshedImage = sessionStorage.getItem('mission_viewshed_image');
            if (storedViewshedImage) activeViewshedImage = JSON.parse(storedViewshedImage);
        } catch (e) {
            console.error(e);
        }

        const storedThreat = sessionStorage.getItem('mission_threat');
        if (storedThreat) {
            try {
                activeThreatData = JSON.parse(storedThreat);
                if (viewer) drawThreatDome(activeThreatData, activeViewshedImage);
            } catch (e) {
                console.error(e);
            }
        }

        try {
            const storedRestricted = sessionStorage.getItem('mission_restricted_areas');
            if (storedRestricted) activeRestrictedAreas = JSON.parse(storedRestricted) || [];
            const storedUas = sessionStorage.getItem('mission_uas_areas');
            if (storedUas) activeUasAreas = JSON.parse(storedUas) || [];
            const storedPower = sessionStorage.getItem('mission_power_lines');
            if (storedPower) activePowerLines = JSON.parse(storedPower) || null;
            if (viewer) {
                drawAirspaceVolumes(activeRestrictedAreas, '#0080FF', '🚧 ');
                drawAirspaceVolumes(activeUasAreas, '#FF9800', '🛸 ');
                drawPowerLines(activePowerLines);
            }
        } catch (e) {
            console.error(e);
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
        if (event.data.viewshedImage) activeViewshedImage = event.data.viewshedImage;
        if (event.data.threat) {
            activeThreatData = event.data.threat;
        }
        if (event.data.restrictedAreas) activeRestrictedAreas = event.data.restrictedAreas;
        if (event.data.uasAreas) activeUasAreas = event.data.uasAreas;
        if (event.data.powerLines) activePowerLines = event.data.powerLines;
        if (event.data.gpx) {
            parseGPXText(event.data.gpx);
        }
    }
});
