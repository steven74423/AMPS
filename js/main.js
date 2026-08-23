// --- 設定檔防呆：js/config.js 未被提交到 git，在沒有該檔案的環境(如剛 clone 下來或部署後)
        // APP_CONFIG 會是 undefined，避免整支 script 因此中斷，改為降級為停用相關功能 ---
        if (typeof APP_CONFIG === 'undefined') {
            console.warn('js/config.js 不存在：登入密碼保護、3D 地形 token 相關功能將被停用。請複製 js/config.example.js 為 js/config.js 並填入你的設定值。');
            window.APP_CONFIG = { LOGIN_PASSWORD: null, CESIUM_ION_TOKEN: null };
        }

        // --- 新增：禁用右鍵選單 ---
        document.addEventListener('contextmenu', event => event.preventDefault());

        // --- 1. 初始化與驗證 ---
        const loginBtn = document.getElementById('login-btn');
        const passInput = document.getElementById('password-input');
        const overlay = document.getElementById('auth-overlay');

        function checkPassword() {
            if (passInput && passInput.value === APP_CONFIG.LOGIN_PASSWORD) {
                if (overlay) overlay.style.display = 'none';
                map.invalidateSize();
                initRadar();
                initMoonCalc();
            } else {
                alert("密碼錯誤！");
            }
        }

        if (loginBtn && passInput) {
            loginBtn.addEventListener('click', checkPassword);
            passInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') checkPassword(); });
        } else {
            // 沒有登入驗證畫面，直接初始化
            setTimeout(() => {
                if (typeof map !== 'undefined' && map.invalidateSize) map.invalidateSize();
                if (typeof initRadar === 'function') initRadar();
                if (typeof initMoonCalc === 'function') initMoonCalc();
            }, 100);
        }

        // --- 瀏覽次數統計 (伺服器版) ---
        const visitDisplay = document.getElementById('visit-count');
        const namespace = 'amps-planner-steven'; // 專案識別名稱
        const key = 'visits';

        if (visitDisplay) { visitDisplay.innerText = "讀取伺服器數據..."; }

        if (!sessionStorage.getItem('has_counted')) {
            // 新 Session：呼叫 API 增加數值 (/up)
            fetch(`https://api.counterapi.dev/v1/${namespace}/${key}/up`)
                .then(res => res.json())
                .then(data => {
                    if (visitDisplay) if (visitDisplay) visitDisplay.innerText = "累積瀏覽次數: " + data.count;
                    sessionStorage.setItem('has_counted', 'true');
                })
                .catch(() => { if (visitDisplay) visitDisplay.innerText = "無法連接計數伺服器"; });
        } else {
            // 同 Session：僅讀取數值
            fetch(`https://api.counterapi.dev/v1/${namespace}/${key}`)
                .then(res => res.json())
                .then(data => {
                    visitDisplay.innerText = "累積瀏覽次數: " + data.count;
                })
                .catch(() => { if (visitDisplay) visitDisplay.innerText = "無法連接計數伺服器"; });
        }

        // --- 2. 地圖圖層 (完整) ---
        const satellite = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 20 });
        const osm = L.tileLayer('https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', { maxZoom: 20 });
        const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17 });
        const night = L.tileLayer('https://map1.vis.earthdata.nasa.gov/wmts-webmerc/VIIRS_Black_Marble/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png', { maxZoom: 20, maxNativeZoom: 8 });

        const map = L.map('map', { zoomControl: false, layers: [satellite] }).setView([23.6, 120.9], 8);
        L.control.zoom({ position: 'topright' }).addTo(map);
        L.control.scale({ position: 'topright', maxWidth: 150, metric: true, imperial: false }).addTo(map);

        // 強制立即建立 SVG 渲染器，讓限制空域的綠色網格 <pattern> 一開始就能掛進 SVG <defs>
        L.svg({ padding: 0.5 }).addTo(map);

        // [DIAG-臨時] 追蹤是誰把 popup 關掉的，排除機場天氣彈窗一秒內自動消失的問題
        map.on('popupopen', (e) => {
            console.log('[DIAG] popupopen', e.popup && e.popup._source && e.popup._source.options && e.popup._source.options.icon);
        });
        map.on('popupclose', (e) => {
            console.log('[DIAG] popupclose 觸發了！呼叫堆疊如下:');
            console.trace('[DIAG] popupclose stack');
        });
        function ensureRestrictedGridPattern() {
            const svg = map.getPane('overlayPane') && map.getPane('overlayPane').querySelector('svg');
            if (!svg) return;
            let defs = svg.querySelector('defs');
            if (!defs) {
                defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                svg.insertBefore(defs, svg.firstChild);
            }
            if (defs.querySelector('#restrictedGridPattern')) return;
            const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
            pattern.setAttribute('id', 'restrictedGridPattern');
            pattern.setAttribute('width', '10');
            pattern.setAttribute('height', '10');
            pattern.setAttribute('patternUnits', 'userSpaceOnUse');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M0,0 L10,0 M0,0 L0,10');
            path.setAttribute('stroke', '#0080FF');
            path.setAttribute('stroke-width', '1');
            pattern.appendChild(path);
            defs.appendChild(pattern);
        }
        ensureRestrictedGridPattern();

        function ensureUasGridPattern() {
            const svg = map.getPane('overlayPane') && map.getPane('overlayPane').querySelector('svg');
            if (!svg) return;
            let defs = svg.querySelector('defs');
            if (!defs) {
                defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
                svg.insertBefore(defs, svg.firstChild);
            }
            if (defs.querySelector('#uasGridPattern')) return;
            const pattern = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
            pattern.setAttribute('id', 'uasGridPattern');
            pattern.setAttribute('width', '10');
            pattern.setAttribute('height', '10');
            pattern.setAttribute('patternUnits', 'userSpaceOnUse');
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'M0,0 L10,0 M0,0 L0,10');
            path.setAttribute('stroke', '#FF9800');
            path.setAttribute('stroke-width', '1');
            pattern.appendChild(path);
            defs.appendChild(pattern);
        }
        ensureUasGridPattern();

        // --- 3. NVG 月相與照度計算 ---
        let moonMarker = null;
        let moonShadowLayer = null;
        const nightShadowGroup = L.layerGroup(); // 建立陰影圖層群組
        let nightTimeMap = []; // 用於儲存滑桿值到實際日期物件的映射

        // 新增：初始化時間滑桿的函式
        function initializeTimeSlider() {
            const slider = document.getElementById('simTimeSlider');
            const center = map.getCenter();
            const now = new Date();
            const limit = new Date(now.getTime() + 48 * 3600 * 1000);
            nightTimeMap = [];

            // 迭代檢查從昨天到後天的時間，以捕捉所有相關的夜間時段
            for (let i = -1; i < 3; i++) {
                const currentDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
                const nextDay = new Date(currentDay.getTime() + 24 * 3600 * 1000);

                const sunTimesCurrent = SunCalc.getTimes(currentDay, center.lat, center.lng);
                const sunTimesNext = SunCalc.getTimes(nextDay, center.lat, center.lng);

                // 使用民用薄暮 (dusk) 作為夜晚開始時間
                const nightStart = sunTimesCurrent.dusk;
                const nightEnd = sunTimesNext.sunrise;

                // 逐分鐘遍歷這個夜間時段
                for (let t = nightStart.getTime(); t < nightEnd.getTime(); t += 60000) {
                    // 僅當時間在 "現在" 和 "48小時後" 的範圍內時才加入列表
                    if (t >= now.getTime() && t < limit.getTime()) {
                        nightTimeMap.push(new Date(t));
                    }
                }
            }

            // 為確保萬一，過濾重複項並排序
            nightTimeMap = nightTimeMap.filter((date, index, self) =>
                index === self.findIndex((d) => d.getTime() === date.getTime())
            );
            nightTimeMap.sort((a, b) => a - b);

            if (nightTimeMap.length > 0) {
                slider.min = 0;
                slider.max = nightTimeMap.length > 0 ? nightTimeMap.length - 1 : 0;
                slider.value = 0;
            } else {
                slider.min = 0;
                slider.max = 0;
                slider.value = 0;
            }
        }

        function initMoonCalc() {
            initializeTimeSlider();
            updateMoonInfo();
            map.on('moveend', () => {
                // 地圖移動時，緯度變更會影響太陽時間，需重新計算滑桿
                const slider = document.getElementById('simTimeSlider');
                const currentValue = parseInt(slider.value) || 0;
                const currentTime = nightTimeMap[currentValue]; // 重新計算前獲取實際時間

                initializeTimeSlider(); // 重建 nightTimeMap

                // 在新地圖中找到最接近之前時間的索引
                let newIndex = 0;
                if (currentTime && nightTimeMap.length > 0) {
                    let minDiff = Infinity;
                    for (let i = 0; i < nightTimeMap.length; i++) {
                        const diff = Math.abs(nightTimeMap[i].getTime() - currentTime.getTime());
                        if (diff < minDiff) {
                            minDiff = diff;
                            newIndex = i;
                        }
                    }
                }
                slider.value = newIndex;
                updateMoonInfo(); // 更新顯示
            });
        }

        function updateMoonInfo() {
            const sliderValue = parseInt(document.getElementById('simTimeSlider').value) || 0;

            if (nightTimeMap.length === 0) {
                document.getElementById('simTimeDisplay').innerText = `無夜間時段`;
                document.getElementById('moonIllum').innerText = "--%";
                document.getElementById('moonAzimuth').innerText = "--°";
                document.getElementById('moonAlt').innerText = "--°";
                nightShadowGroup.clearLayers();
                if (moonMarker) map.removeLayer(moonMarker);
                return;
            }

            const index = Math.max(0, Math.min(sliderValue, nightTimeMap.length - 1));
            const simDate = nightTimeMap[index];

            if (!simDate) { return; } // 安全檢查

            const hours = String(simDate.getHours()).padStart(2, '0');
            const minutes = String(simDate.getMinutes()).padStart(2, '0');
            const dateStr = `${simDate.getMonth() + 1}/${simDate.getDate()}`;
            document.getElementById('simTimeDisplay').innerText = `${dateStr} ${hours}:${minutes}`;

            const center = map.getCenter();
            const illumination = SunCalc.getMoonIllumination(simDate);
            const position = SunCalc.getMoonPosition(simDate, center.lat, center.lng);

            const illumPercent = Math.round(illumination.fraction * 100);
            const azimuth = (position.azimuth * 180 / Math.PI + 180) % 360;
            const altitude = position.altitude * 180 / Math.PI;

            const illumEl = document.getElementById('moonIllum');
            const altEl = document.getElementById('moonAlt');

            illumEl.innerText = illumPercent + "%";
            document.getElementById('moonAzimuth').innerText = Math.round(azimuth) + "°";
            altEl.innerText = Math.round(altitude) + "°";

            if (illumPercent < 20 || altitude < 0) {
                illumEl.classList.add('nvg-alert');
            } else {
                illumEl.classList.remove('nvg-alert');
            }

            // --- 修改核心：月亮地形陰影圖層邏輯 (加入日夜判斷) ---
            const sunTimes = SunCalc.getTimes(simDate, center.lat, center.lng);
            // 定義夜間：目前時間早於日出 或 晚於終昏 (dusk)
            const isNight = simDate < sunTimes.sunrise || simDate > sunTimes.dusk;
            const isShadowActive = map.hasLayer(nightShadowGroup); // 檢查圖層是否開啟

            // 清除舊狀態
            if (moonMarker) map.removeLayer(moonMarker);

            if (altitude < 0) {
                altEl.style.color = '#FF4444';
                altEl.innerText = "⬇無";
                nightShadowGroup.clearLayers();
            } else if (isNight && altitude >= 20 && isShadowActive) {
                // 夜間 + 仰角夠高 + 圖層已開啟：顯示藍色地形陰影
                altEl.style.color = '#00FF00';
                updateMoonShadowLayer(azimuth, altitude);
            } else {
                // 其他情況：顯示箭頭指示方位 (並清除陰影)
                altEl.style.color = '#FFFF00';
                nightShadowGroup.clearLayers();
                updateMoonArrow(center, azimuth, altitude);
            }

            updateMoonArrow(center, azimuth, altitude);
        }

        function updateMoonArrow(center, azimuth, altitude) {
            if (moonMarker) map.removeLayer(moonMarker);
            if (altitude < 0) return;

            const arrowIcon = L.divIcon({
                className: 'moon-arrow-wrap',
                html: `<div class="moon-arrow" style="transform: rotate(${azimuth}deg);">⬆</div>`,
                iconSize: [40, 40],
                iconAnchor: [20, 20]
            });
            moonMarker = L.marker(center, { icon: arrowIcon, interactive: false }).addTo(map);
        }

        // --- 新增：紫色地形陰影圖層 (類似 MSA 實作) ---
        L.GridLayer.MoonShadow = L.GridLayer.extend({
            createTile: function (coords) {
                const tile = L.DomUtil.create('canvas', 'leaflet-tile');
                const size = this.getTileSize();
                tile.width = size.x; tile.height = size.y;
                const ctx = tile.getContext('2d');
                const img = new Image();
                img.crossOrigin = "Anonymous";
                img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${coords.z}/${coords.x}/${coords.y}.png`;

                const az = this.options.azimuth || 0;
                const alt = this.options.altitude || 45;

                img.onload = function () {
                    ctx.drawImage(img, 0, 0);
                    const imgData = ctx.getImageData(0, 0, size.x, size.y);
                    const data = imgData.data;
                    const w = size.x;
                    const maxOpacity = 190; // [設定] 藍色陰影最大不透明度 (0~255)，數值越小越透明

                    // 計算光照向量 (假設 Canvas 座標: +X向右, +Y向下)
                    // Azimuth 0=North(Up=-Y), 90=East(Right=+X)
                    const radAz = (az * Math.PI) / 180;
                    const radAlt = (alt * Math.PI) / 180;
                    const Lx = Math.sin(radAz) * Math.cos(radAlt);
                    const Ly = -Math.cos(radAz) * Math.cos(radAlt);
                    const Lz = Math.sin(radAlt);

                    for (let i = 0; i < data.length; i += 4) {
                        // 簡易法向量計算 (利用相鄰像素，忽略邊界誤差以求效能)
                        const idx = i / 4;
                        const x = idx % w; const y = Math.floor(idx / w);

                        // 取得當前高度
                        const h = (data[i] * 256 + data[i + 1] + data[i + 2] / 256) - 32768;

                        // 取得右方與下方高度 (若邊界則重複當前高度)
                        let hx = h, hy = h;
                        if (x < w - 1) hx = (data[i + 4] * 256 + data[i + 5] + data[i + 6] / 256) - 32768;
                        if (y < size.y - 1) {
                            const ib = i + w * 4;
                            hy = (data[ib] * 256 + data[ib + 1] + data[ib + 2] / 256) - 32768;
                        }

                        // 計算坡度向量與法向量
                        const dzdx = (h - hx) * 2; // 2 為增強係數
                        const dzdy = (h - hy) * 2;
                        const len = Math.sqrt(dzdx * dzdx + dzdy * dzdy + 1);
                        const Nx = dzdx / len; const Ny = dzdy / len; const Nz = 1 / len;

                        // 光照強度 (Dot Product)
                        let dot = Nx * Lx + Ny * Ly + Nz * Lz;

                        // 著色邏輯：陰影區(dot小)顯示藍色，受光區(dot大)透明
                        // 藍色 (0, 0, 255)
                        data[i] = 0; data[i + 1] = 0; data[i + 2] = 255;

                        // [修改] 嚴格定義陰影區：只有 dot < 0 (背光) 才顯示藍色，受光面完全透明
                        if (dot >= 0) {
                            data[i + 3] = 0;
                        } else {
                            data[i + 3] = Math.min(200, Math.abs(dot) * 255);
                            data[i + 3] = Math.min(maxOpacity, Math.abs(dot) * 255);
                        }
                    }
                    ctx.putImageData(imgData, 0, 0);
                };
                return tile;
            }
        });

        function updateMoonShadowLayer(az, alt) {
            if (!moonShadowLayer) {
                moonShadowLayer = new L.GridLayer.MoonShadow({ zIndex: 40, opacity: 0.8 });
            }
            moonShadowLayer.options.azimuth = az;
            moonShadowLayer.options.altitude = alt;
            if (!nightShadowGroup.hasLayer(moonShadowLayer)) {
                nightShadowGroup.addLayer(moonShadowLayer);
            }
            moonShadowLayer.redraw();
        }

        // --- 4. MSA 著色圖層 ---
        let msaLayer = null;
        L.GridLayer.MsaMask = L.GridLayer.extend({
            createTile: function (coords) {
                const tile = L.DomUtil.create('canvas', 'leaflet-tile');
                const size = this.getTileSize();
                tile.width = size.x; tile.height = size.y;
                const ctx = tile.getContext('2d');
                const img = new Image();
                img.crossOrigin = "Anonymous";
                img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${coords.z}/${coords.x}/${coords.y}.png`;
                img.onload = function () {
                    ctx.drawImage(img, 0, 0);
                    const imgData = ctx.getImageData(0, 0, size.x, size.y);
                    const data = imgData.data;
                    const msaFt = parseFloat(document.getElementById('msaHeight').value) || 2000;
                    const warningOffsetFt = parseFloat(document.getElementById('msaWarningOffset').value) || 500;
                    const redLimit = msaFt / 3.28084;
                    const yellowLimit = (msaFt - warningOffsetFt) / 3.28084;
                    for (let i = 0; i < data.length; i += 4) {
                        const r = data[i]; const g = data[i + 1]; const b = data[i + 2];
                        const h = (r * 256 + g + b / 256) - 32768;
                        if (h > redLimit) {
                            data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 140;
                        } else if (h > yellowLimit) {
                            data[i] = 255; data[i + 1] = 255; data[i + 2] = 0; data[i + 3] = 120;
                        } else {
                            data[i + 3] = 0;
                        }
                    }
                    ctx.putImageData(imgData, 0, 0);
                };
                return tile;
            }
        });
        msaLayer = new L.GridLayer.MsaMask({ zIndex: 50, opacity: 0.8 });
        function updateMsaLayer() { if (map.hasLayer(msaLayer)) msaLayer.redraw(); }

        // --- 5. 電纜圖層 ---
        const powerLayer = L.layerGroup();
        let isPowerLayerActive = false;
        let drawnPowerElementIds = new Set();
        const missileLayer = L.layerGroup(); // 防空隱蔽圖層

        // --- 限制空域 (ENR 5.1) ---
        const restrictedAreaLayer = L.layerGroup(); // 根圖層：所有限制空域
        const restrictedAreaSubLayers = {}; // id -> L.layerGroup (單一空域，供子選項個別開關)

        function buildRestrictedAreaShape(area) {
            const g = area.geometry || {};
            const style = {
                color: '#0080FF',
                weight: 1.5,
                opacity: 0.85,
                fillColor: 'url(#restrictedGridPattern)',
                fillOpacity: 0.9
            };

            if (area.geometry_type === 'circle' && g.center) {
                const radiusNm = g.radius_nm != null ? g.radius_nm : (g.radius_m != null ? g.radius_m / 1852 : null);
                if (radiusNm == null) return null;
                return L.circle([g.center[1], g.center[0]], Object.assign({ radius: radiusNm * 1852 }, style));
            }

            if (area.geometry_type === 'polygon' && g.points && g.points.length > 2) {
                const latlngs = g.points.map(p => [p[1], p[0]]);
                return L.polygon(latlngs, style);
            }

            // 部分空域(如 RCR34、RCR38)只有弧形邊界近似的圓心/半徑資料，以圓形近似顯示
            if (g.circle_part && g.circle_part.center) {
                const radiusNm = g.circle_part.radius_nm != null ? g.circle_part.radius_nm : null;
                if (radiusNm == null) return null;
                return L.circle([g.circle_part.center[1], g.circle_part.center[0]], Object.assign({ radius: radiusNm * 1852, dashArray: '4,4' }, style));
            }

            return null;
        }

        function getAreaDisplayName(area) {
            const place = area.name_zh || area.name_en || '';
            return place ? `${area.id}(${place})` : area.id;
        }

        function buildRestrictedAreaLabel(area) {
            const name = getAreaDisplayName(area);
            const upper = area.upper_limit || (area.upper_limit_ft != null ? `${area.upper_limit_ft} FT` : '?');
            const lower = area.lower_limit || (area.lower_limit_ft != null ? `${area.lower_limit_ft} FT` : '?');
            return `${name}\n${lower} - ${upper}`;
        }

        function initRestrictedAreas() {
            if (typeof RESTRICTED_AREAS_DATA === 'undefined' || !RESTRICTED_AREAS_DATA.areas) return;
            const listEl = document.getElementById('restricted-area-list');

            RESTRICTED_AREAS_DATA.areas.forEach(area => {
                const shape = buildRestrictedAreaShape(area);
                if (!shape) return;

                const label = buildRestrictedAreaLabel(area);
                shape.bindTooltip(label.replace('\n', '<br>'), { permanent: true, direction: 'center', className: 'restricted-area-label', interactive: true });

                let popupHtml = `<div style="color:#333; line-height:1.5; min-width:160px;">`;
                popupHtml += `<div style="font-weight:bold; font-size:1.05em; color:#0066CC;">🚧 ${getAreaDisplayName(area)}</div><hr style="margin:5px 0; border:0; border-top:1px solid #ccc;">`;
                popupHtml += `<b>高度：</b> ${area.lower_limit || 'SFC'} ~ ${area.upper_limit || '-'}<br>`;
                if (area.contact) popupHtml += `<b>聯絡：</b> ${area.contact}<br>`;
                if (area.remarks_zh) popupHtml += `<div style="margin-top:4px; font-size:0.9em; color:#555;">${area.remarks_zh}</div>`;
                popupHtml += `</div>`;

                // 標籤也可被點擊：強制攔截點擊事件，直接開啟 Popup 並阻止傳遞給地圖(避免同一次點擊又觸發新增航點)
                const raClickHandler = (e) => {
                    if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
                    shape.openPopup();
                };
                shape.on('click', raClickHandler);
                shape.bindPopup(popupHtml);
                shape.getTooltip().on('click', raClickHandler);

                const subLayer = L.layerGroup([shape]);
                restrictedAreaSubLayers[area.id] = subLayer;
                subLayer.addTo(restrictedAreaLayer);

                if (listEl) {
                    const row = document.createElement('div');
                    row.className = 'restricted-area-row';
                    const cbId = `ra-cb-${area.id}`;
                    row.innerHTML = `<input type="checkbox" id="${cbId}" checked>
                        <label for="${cbId}"><span class="ra-name">${getAreaDisplayName(area)}</span><br><span class="ra-alt">${area.lower_limit || 'SFC'} ~ ${area.upper_limit || '-'}</span></label>`;
                    listEl.appendChild(row);
                    row.querySelector('input').addEventListener('change', (e) => {
                        if (e.target.checked) {
                            subLayer.addTo(restrictedAreaLayer);
                        } else {
                            restrictedAreaLayer.removeLayer(subLayer);
                        }
                    });
                }
            });

            ensureRestrictedGridPattern();

            const selectAllBtn = document.getElementById('restricted-select-all');
            const selectNoneBtn = document.getElementById('restricted-select-none');
            if (selectAllBtn) selectAllBtn.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('#restricted-area-list input[type="checkbox"]').forEach(cb => {
                    if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
                });
            });
            if (selectNoneBtn) selectNoneBtn.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('#restricted-area-list input[type="checkbox"]').forEach(cb => {
                    if (cb.checked) { cb.checked = false; cb.dispatchEvent(new Event('change')); }
                });
            });

            // 關閉鈕：只關閉子選單面板本身，不動地圖上的圖層 —
            // 使用者已勾選要顯示的空域要繼續留在地圖上，不能連同面板一起被移除
            const closeBtn = document.getElementById('restricted-area-panel-close');
            if (closeBtn) closeBtn.addEventListener('click', () => {
                document.getElementById('restricted-area-panel').style.display = 'none';
            });
        }
        initRestrictedAreas();

        // --- UAS 訓練空域 (ENR 5.2.4) ---
        const uasAreaLayer = L.layerGroup(); // 根圖層：所有 UAS 訓練空域
        const uasAreaSubLayers = {}; // id -> L.layerGroup (單一空域，供子選項個別開關)

        function buildUasAreaShape(area) {
            const g = area.geometry || {};
            const style = {
                color: '#FF9800',
                weight: 1.5,
                opacity: 0.85,
                fillColor: 'url(#uasGridPattern)',
                fillOpacity: 0.9
            };

            if (area.geometry_type === 'polygon' && g.points && g.points.length > 2) {
                const latlngs = g.points.map(p => [p[1], p[0]]);
                return L.polygon(latlngs, style);
            }

            if (area.geometry_type === 'circle' && g.center) {
                const radiusNm = g.radius_nm != null ? g.radius_nm : (g.radius_m != null ? g.radius_m / 1852 : null);
                if (radiusNm == null) return null;
                return L.circle([g.center[1], g.center[0]], Object.assign({ radius: radiusNm * 1852 }, style));
            }

            return null;
        }

        function buildUasAreaLabel(area) {
            const name = getAreaDisplayName(area);
            const upper = area.upper_limit || (area.upper_limit_ft != null ? `${area.upper_limit_ft} FT` : '?');
            const lower = area.lower_limit || (area.lower_limit_ft != null ? `${area.lower_limit_ft} FT` : '?');
            return `${name}\n${lower} - ${upper}`;
        }

        function initUasAreas() {
            if (typeof UAS_AREAS_DATA === 'undefined' || !UAS_AREAS_DATA.areas) return;
            const listEl = document.getElementById('uas-area-list');

            UAS_AREAS_DATA.areas.forEach(area => {
                const shape = buildUasAreaShape(area);
                if (!shape) return;

                const label = buildUasAreaLabel(area);
                shape.bindTooltip(label.replace('\n', '<br>'), { permanent: true, direction: 'center', className: 'uas-area-label', interactive: true });

                let popupHtml = `<div style="color:#333; line-height:1.5; min-width:160px;">`;
                popupHtml += `<div style="font-weight:bold; font-size:1.05em; color:#CC6600;">🛸 ${getAreaDisplayName(area)}</div><hr style="margin:5px 0; border:0; border-top:1px solid #ccc;">`;
                popupHtml += `<b>高度：</b> ${area.lower_limit || 'SFC'} ~ ${area.upper_limit || '-'}<br>`;
                if (area.contact) popupHtml += `<b>聯絡：</b> ${area.contact}<br>`;
                if (area.remarks_zh) popupHtml += `<div style="margin-top:4px; font-size:0.9em; color:#555;">${area.remarks_zh}</div>`;
                popupHtml += `</div>`;

                // 標籤也可被點擊：強制攔截點擊事件，直接開啟 Popup 並阻止傳遞給地圖(避免同一次點擊又觸發新增航點)
                const uasClickHandler = (e) => {
                    if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
                    shape.openPopup();
                };
                shape.on('click', uasClickHandler);
                shape.bindPopup(popupHtml);
                shape.getTooltip().on('click', uasClickHandler);

                const subLayer = L.layerGroup([shape]);
                uasAreaSubLayers[area.id] = subLayer;
                subLayer.addTo(uasAreaLayer);

                if (listEl) {
                    const row = document.createElement('div');
                    row.className = 'uas-area-row';
                    const cbId = `uas-cb-${area.id}`;
                    row.innerHTML = `<input type="checkbox" id="${cbId}" checked>
                        <label for="${cbId}"><span class="uas-name">${getAreaDisplayName(area)}</span><br><span class="uas-alt">${area.lower_limit || 'SFC'} ~ ${area.upper_limit || '-'}</span></label>`;
                    listEl.appendChild(row);
                    row.querySelector('input').addEventListener('change', (e) => {
                        if (e.target.checked) {
                            subLayer.addTo(uasAreaLayer);
                        } else {
                            uasAreaLayer.removeLayer(subLayer);
                        }
                    });
                }
            });

            ensureUasGridPattern();

            const selectAllBtn = document.getElementById('uas-select-all');
            const selectNoneBtn = document.getElementById('uas-select-none');
            if (selectAllBtn) selectAllBtn.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('#uas-area-list input[type="checkbox"]').forEach(cb => {
                    if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change')); }
                });
            });
            if (selectNoneBtn) selectNoneBtn.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('#uas-area-list input[type="checkbox"]').forEach(cb => {
                    if (cb.checked) { cb.checked = false; cb.dispatchEvent(new Event('change')); }
                });
            });

            const closeBtn = document.getElementById('uas-area-panel-close');
            if (closeBtn) closeBtn.addEventListener('click', () => {
                document.getElementById('uas-area-panel').style.display = 'none';
            });
        }
        initUasAreas();

        // --- 點擊選單以外的地方(地圖、其他面板等)自動關閉「限制空域」「UAS訓練空域」選單面板 ---
        // 排除圖層控制本身，避免勾選圖層時觸發的那次點擊被誤判為「點擊外部」而立刻把剛打開的面板關掉
        // 用 capture 階段攔截：Leaflet 的地圖 click(新增航點等)是綁在地圖容器上的 bubble 階段事件，
        // 會比 document 的 bubble 監聽更早觸發；改在 capture 階段判斷「這次點擊是用來關閉選單」時
        // 直接 stopPropagation，讓這次點擊完全不會傳到地圖，不會同時觸發新增航點。下一次點擊(選單
        // 已關閉)就會正常往下傳遞，恢復平常的地圖互動。
        document.addEventListener('click', (e) => {
            let closedAny = false;
            [
                { panel: 'restricted-area-panel' },
                { panel: 'uas-area-panel' }
            ].forEach(({ panel }) => {
                const el = document.getElementById(panel);
                // 用 getComputedStyle 而不是 el.style.display：這兩個面板預設是用 CSS 規則設成
                // display:none，不是 inline style，頁面剛載入、面板還沒被 JS 開關過時 el.style.display
                // 讀到的是空字串，用 !== 'none' 判斷會誤判成「目前是開著的」，導致重新整理頁面後第一次
                // 點擊地圖上任何東西(包含地標、標籤)都會被這裡誤判並用 stopPropagation 整個吃掉。
                const isVisible = el && getComputedStyle(el).display !== 'none';
                if (isVisible && !el.contains(e.target) && !e.target.closest('.leaflet-control-layers')) {
                    el.style.display = 'none';
                    closedAny = true;
                }
            });

            // 空域標籤點擊後開啟的資訊彈窗(白色框)：點擊地圖以外的地方(下方工具列、圖層控制等)
            // 也要能關閉。點擊地圖「內部」則交給 Leaflet 預設的 closePopupOnClick 及既有的
            // isPopupOpen 航點防呆機制處理，這裡不重複攔截，避免影響「點另一個空域標籤切換彈窗」的正常互動。
            if (!e.target.closest('#map')) {
                let popupOpen = false;
                map.eachLayer(layer => { if (layer instanceof L.Popup) popupOpen = true; });
                if (popupOpen && !e.target.closest('.leaflet-popup')) {
                    map.closePopup();
                    closedAny = true;
                }
            }

            if (closedAny) {
                e.stopPropagation();
                e.preventDefault();
            }
        }, true);

        async function loadPowerLines() {
            let q = "";
            // Define query based on mode
            if (waypoints.length > 1) {
                const radiusM = 1000; // 3 NM in meters
                const line = turf.lineString(waypoints.map(p => [p.lng, p.lat]));
                const buffered = turf.buffer(line, radiusM, { units: 'meters' });
                // For long routes, simplify the buffer polygon to reduce query complexity
                const simplified = turf.simplify(buffered, { tolerance: 0.0001, highQuality: false });
                const polyCoords = simplified.geometry.coordinates[0].map(p => `${p[1]} ${p[0]}`).join(' ');
                // Increase timeout for complex queries
                q = `[out:json][timeout:120];(way["power"="line"](poly: "${polyCoords}");node["power"="tower"](poly: "${polyCoords}"););out body;>;out skel qt;`;
            } else { // 'bounds' mode
                if (map.getZoom() < 12) {
                    return; // Zoomed out too far, do nothing, but keep data
                }
                const b = map.getBounds();
                q = `[out:json][timeout:25];(way["power"="line"](${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()});node["power"="tower"](${b.getSouth()},${b.getWest()},${b.getNorth()},${b.getEast()}););out body;>;out skel qt;`;
            }

            document.getElementById('loading-indicator').style.display = 'block';
            try {
                const res = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: q });
                const data = await res.json();

                const nodes = {};
                data.elements.forEach(e => { if (e.type === 'node') nodes[e.id] = [e.lat, e.lon]; });

                data.elements.forEach(e => {
                    if (drawnPowerElementIds.has(e.id)) return; // Skip if already drawn

                    if (e.type === 'way' && e.nodes) {
                        const latlngs = e.nodes.map(id => nodes[id]).filter(n => n);
                        if (latlngs.length > 1) {
                            L.polyline(latlngs, { color: '#FF00FF', weight: 3, opacity: 0.9 }).addTo(powerLayer);
                            drawnPowerElementIds.add(e.id);
                        }
                    }
                    if (e.tags && e.tags.power === 'tower' && e.type === 'node') {
                        L.circleMarker([e.lat, e.lon], { radius: 4, color: '#F00', fillColor: '#FF0', fillOpacity: 1 }).addTo(powerLayer);
                        drawnPowerElementIds.add(e.id);
                    }
                });
            } catch (e) {
                console.error("Overpass API 電纜資料下載失敗:", e);
            } finally {
                document.getElementById('loading-indicator').style.display = 'none';
            }
        }
        map.on('moveend', () => { if (isPowerLayerActive && (typeof waypoints === 'undefined' || waypoints.length === 0)) loadPowerLines(); });

        // --- 6. VFR整合圖層控制 (支援旋轉/歪斜校正，不受限於單純矩形縮放) ---
        // 用「左上/右上/左下」三個對應點做仿射變換，讓圖片可以旋轉、傾斜貼合實際地圖，
        // 校正結果存在 localStorage，換圖後(檔名/內容變了但裁切範圍不變時)不用重新校正
        const VfrRotatedOverlay = L.Layer.extend({
            options: { pane: 'overlayPane' },
            initialize: function (url, corners, options) {
                this._url = url;
                this._corners = corners; // { topleft:[lat,lng], topright:[lat,lng], bottomleft:[lat,lng] }
                L.setOptions(this, options);
            },
            onAdd: function (map) {
                this._map = map;
                if (!this._image) this._initImage();
                this.getPane().appendChild(this._image);
                this._reset();
            },
            onRemove: function () {
                L.DomUtil.remove(this._image);
            },
            getEvents: function () {
                return { zoom: this._reset, viewreset: this._reset, move: this._reset };
            },
            _initImage: function () {
                const img = this._image = L.DomUtil.create('img', 'leaflet-image-layer');
                img.style.transformOrigin = '0 0';
                img.style.position = 'absolute';
                img.style.pointerEvents = 'none';
                img.style.maxWidth = 'none';
                img.style.opacity = this.options.opacity != null ? this.options.opacity : 1;
                img.onload = () => {
                    this._naturalW = img.naturalWidth;
                    this._naturalH = img.naturalHeight;
                    this._reset();
                };
                img.src = this._url;
            },
            _reset: function () {
                if (!this._naturalW || !this._map || !this._image) return;
                const tl = this._map.latLngToLayerPoint(this._corners.topleft);
                const tr = this._map.latLngToLayerPoint(this._corners.topright);
                const bl = this._map.latLngToLayerPoint(this._corners.bottomleft);
                const e = tl.x, f = tl.y;
                const a = (tr.x - e) / this._naturalW, b = (tr.y - f) / this._naturalW;
                const c = (bl.x - e) / this._naturalH, d = (bl.y - f) / this._naturalH;
                this._image.style.width = this._naturalW + 'px';
                this._image.style.height = this._naturalH + 'px';
                this._image.style.transform = `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
            },
            setCorners: function (corners) {
                this._corners = corners;
                this._reset();
            },
            getCorners: function () {
                return this._corners;
            },
            setOpacity: function (v) {
                this.options.opacity = v;
                if (this._image) this._image.style.opacity = v;
            }
        });

        const VFR_CALIBRATION_KEY = 'vfrChartCalibration';
        const VFR_DEFAULT_CONFIG = {
            corners: {
                topleft: [25.99, 119.08],
                topright: [25.99, 122.48],
                bottomleft: [21.56, 119.08]
            },
            opacity: 0.65
        };
        function loadVfrConfig() {
            try {
                const saved = JSON.parse(localStorage.getItem(VFR_CALIBRATION_KEY));
                if (saved && saved.corners && saved.corners.topleft && saved.corners.topright && saved.corners.bottomleft) {
                    return { corners: saved.corners, opacity: saved.opacity != null ? saved.opacity : VFR_DEFAULT_CONFIG.opacity };
                }
            } catch (e) { /* 忽略壞資料，改用預設值 */ }
            return JSON.parse(JSON.stringify(VFR_DEFAULT_CONFIG));
        }

        let vfrSavedConfig = loadVfrConfig();
        const vfrOverlay = new VfrRotatedOverlay('vfr_chart.png', vfrSavedConfig.corners, { opacity: vfrSavedConfig.opacity });
        // --- 助導航設施 (ENR 4.1 無線電助航設施－航路，取代舊版需要 API 金鑰的 OpenAIP 資料) ---
        const navaidLayer = L.layerGroup();

        function navaidIcon(type) {
            if (type === 'NDB') return '🔵';
            if (type === 'DME') return '⬥';
            return '📡'; // VOR/DME 等
        }

        function buildNavaidPopup(n) {
            let html = `<div style="color: #333; line-height: 1.5; min-width: 160px;">`;
            html += `<div style="font-weight:bold; font-size:1.1em; color:#00FFFF; text-shadow: 1px 1px 1px #000;">${navaidIcon(n.type)} ${n.id} ${n.name}</div><hr style="margin: 5px 0; border:0; border-top:1px solid #ccc;">`;
            html += `<b>類型：</b> ${n.type}<br>`;
            html += `<b>頻率：</b> ${n.freq}<br>`;
            if (n.magnetic_variation) html += `<b>磁差：</b> ${n.magnetic_variation}<br>`;
            if (n.elevation_ft != null) html += `⛰️ <b>標高：</b> ${n.elevation_ft} FT<br>`;
            if (n.remarks) html += `<div style="margin-top:4px; font-size:0.9em; color:#555;">⚠️ ${n.remarks}</div>`;
            html += `</div>`;
            return html;
        }

        function initNavaids() {
            if (typeof NAVAIDS_DATA === 'undefined' || !NAVAIDS_DATA.navaids) return;

            NAVAIDS_DATA.navaids.forEach(n => {
                const latlng = [n.coordinates[1], n.coordinates[0]];
                const icon = navaidIcon(n.type);
                const marker = L.marker(latlng, { icon: L.divIcon({ className: 'navaid-icon', html: `<div style="width:30px;height:30px;background:rgba(255,255,255,0.01);cursor:pointer;border-radius:50%;">${icon}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }) });

                let tooltipInfo = `${n.id} ${n.name}<br><span style="color:#FFFF00">${n.freq}</span>`;
                marker.bindTooltip(tooltipInfo, { permanent: true, direction: 'top', offset: [0, -10], className: 'navaid-label', interactive: true });

                // 強制攔截點擊事件，直接開啟 Popup 並阻止傳遞給地圖
                const clickHandler = (e) => {
                    if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
                    marker.openPopup();
                };
                marker.on('click', clickHandler);
                marker.bindPopup(buildNavaidPopup(n));
                marker.getTooltip().on('click', clickHandler);

                navaidLayer.addLayer(marker);
            });
        }
        initNavaids();

        // --- 機場資料 (eAIP AD 2：跑道/空域/通訊/助導航/起飛天氣限度)，併入同一個「機場與助導航」圖層 ---
        function buildAirportPopup(a) {
            let html = `<div style="color:#333; line-height:1.5; min-width:220px; max-width:300px; font-size:0.85em;">`;
            html += `<div style="font-weight:bold; font-size:1.15em; color:#E066FF;">🛫 ${a.id} ${a.name_zh} (${a.name_en})</div>`;
            html += `<div style="color:#666; font-size:0.85em; margin-bottom:4px;">機場標高 ${a.elevation_ft != null ? a.elevation_ft + ' FT' : '-'}${a.ref_temp_c != null ? '　參考溫度 ' + a.ref_temp_c + '°C' : ''}</div>`;
            html += `<hr style="margin:5px 0; border:0; border-top:1px solid #ccc;">`;

            if (a.runways && a.runways.length) {
                html += `<b>🛬 跑道頭/著陸區標高：</b><br><div style="padding-left:10px;">${a.runways.join('<br>')}</div>`;
            }
            if (a.airspace_vertical_limits || a.airspace_classification) {
                html += `<b>📐 空域上下限：</b> ${a.airspace_vertical_limits || '無資料'}<br>`;
                html += `<b>🗂️ 空域類別：</b> ${a.airspace_classification || '無資料'}<br>`;
            }
            if (a.communications && a.communications.length) {
                html += `<b>📻 飛航服務通訊：</b><br><div style="padding-left:10px;">${a.communications.join('<br>')}</div>`;
            }
            if (a.navaids && a.navaids.length) {
                html += `<b>🧭 無線電助導航設施：</b><br><div style="padding-left:10px; font-size:0.92em;">${a.navaids.join('<br>')}</div>`;
            }
            if (a.departure_minima && a.departure_minima.length) {
                html += `<b>🌫️ 儀器飛航起飛天氣限度：</b><br><div style="padding-left:10px;">${a.departure_minima.join('<br>')}</div>`;
            }
            if (a.remarks && a.remarks.length) {
                html += `<div style="margin-top:6px; padding-top:4px; border-top:1px dashed #ccc; font-size:0.9em; color:#555;">⚠️ ${a.remarks.join('；')}</div>`;
            }
            html += `</div>`;
            return html;
        }

        function initAirports() {
            if (typeof AD2_AIRPORTS_DATA === 'undefined' || !AD2_AIRPORTS_DATA.airports) return;

            AD2_AIRPORTS_DATA.airports.forEach(a => {
                if (!a.arp_coordinates) return;
                const latlng = [a.arp_coordinates[1], a.arp_coordinates[0]];
                const marker = L.marker(latlng, { icon: L.divIcon({ className: 'navaid-icon', html: '<div style="width:30px;height:30px;background:rgba(255,255,255,0.01);cursor:pointer;border-radius:50%;">✈️</div>', iconSize: [30, 30], iconAnchor: [15, 15] }) });

                marker.bindTooltip(`${a.id} ${a.name_zh}`, { permanent: true, direction: 'top', offset: [0, -10], className: 'navaid-label', interactive: true });

                const clickHandler = (e) => {
                    if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
                    marker.openPopup();
                };
                marker.on('click', clickHandler);
                marker.bindPopup(buildAirportPopup(a), { maxHeight: 380, maxWidth: 300 });
                marker.getTooltip().on('click', clickHandler);

                navaidLayer.addLayer(marker); // 跟助導航設施共用同一個「機場與助導航」圖層
            });
        }
        initAirports();

        // --- 機場天氣 (METAR，資料源: NOAA Aviation Weather Center，免金鑰) ---
        const WEATHER_ICAO_CODES = ['RCTP', 'RCSS', 'RCKH', 'RCMQ', 'RCFN', 'RCNN', 'RCYU', 'RCQC', 'RCGI', 'RCFG', 'RCMT'];
        const weatherLayer = L.layerGroup();
        const weatherMarkers = {}; // icao -> L.Marker
        let weatherRefreshTimer = null;

        function flightCategoryColor(cat) {
            switch (cat) {
                case 'VFR': return '#00CC44';
                case 'MVFR': return '#0080FF';
                case 'IFR': return '#FF3B30';
                case 'LIFR': return '#FF00FF';
                default: return '#888888';
            }
        }

        function buildWeatherIcon(icao, color) {
            return L.divIcon({
                className: 'weather-icon',
                html: `<div class="weather-badge" style="background:${color};">${icao}</div>`,
                iconSize: [54, 22],
                iconAnchor: [27, 11]
            });
        }

        function buildWeatherPopup(m) {
            const cat = m.fltCat || '?';
            const color = flightCategoryColor(m.fltCat);
            let html = `<div style="color:#333; line-height:1.6; min-width:210px;">`;
            html += `<div style="font-weight:bold; font-size:1.05em; display:flex; align-items:center; gap:6px;">`;
            html += `<span style="color:#0066CC;">🌤️ ${m.icaoId}${m.name ? ' - ' + m.name : ''}</span>`;
            html += `<span style="font-size:0.72em; padding:1px 6px; border-radius:3px; background:${color}; color:#fff;">${cat}</span>`;
            html += `</div><hr style="margin:5px 0; border:0; border-top:1px solid #ccc;">`;

            if (m.temp != null) html += `🌡️ <b>溫度/露點：</b> ${m.temp}°C / ${m.dewp != null ? m.dewp + '°C' : '-'}<br>`;
            if (m.wdir != null || m.wspd != null) {
                const dir = (m.wdir === 0 || m.wdir === 'VRB') ? 'VRB' : `${m.wdir}°`;
                html += `💨 <b>風向風速：</b> ${dir} / ${m.wspd ?? '-'} kt${m.wgst ? ` (陣風 ${m.wgst} kt)` : ''}<br>`;
            }
            if (m.visib != null) html += `👁️ <b>能見度：</b> ${m.visib} SM<br>`;
            if (m.altim != null) html += `📊 <b>高度撥定值：</b> ${m.altim} hPa<br>`;
            if (m.wxString) html += `☔ <b>天氣現象：</b> ${m.wxString}<br>`;
            if (m.clouds && m.clouds.length) {
                const cloudsStr = m.clouds.map(c => `${c.cover}${c.base != null ? ' ' + c.base + 'ft' : ''}`).join(', ');
                html += `☁️ <b>雲況：</b> ${cloudsStr}<br>`;
            }
            html += `<div style="margin-top:6px; padding:5px; background:#f0f0f0; border-radius:4px; font-size:0.78em; font-family:monospace; word-break:break-all; color:#333;">${m.rawOb || ''}</div>`;
            if (m.reportTime) html += `<div style="margin-top:4px; font-size:0.72em; color:#888;">觀測時間：${m.reportTime} UTC</div>`;
            html += `</div>`;
            return html;
        }

        async function loadAirportWeather() {
            // aviationweather.gov 沒有開放瀏覽器跨網域請求(無 CORS 標頭)，改打自架的 metar-proxy
            // (見專案根目錄 metar-proxy/ 資料夾)，由伺服器端代為轉發並附上 CORS 標頭
            if (!APP_CONFIG.METAR_PROXY_URL) {
                console.warn('未設定 APP_CONFIG.METAR_PROXY_URL，機場天氣圖層無法載入資料。請部署 metar-proxy/ 並在 config.js 填入網址。');
                return;
            }
            try {
                const res = await fetch(`${APP_CONFIG.METAR_PROXY_URL}?ids=${WEATHER_ICAO_CODES.join(',')}`);
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const data = await res.json();
                data.forEach(m => {
                    if (!m.icaoId || m.lat == null || m.lon == null) return;
                    const color = flightCategoryColor(m.fltCat);

                    let marker = weatherMarkers[m.icaoId];
                    if (!marker) {
                        marker = L.marker([m.lat, m.lon], { icon: buildWeatherIcon(m.icaoId, color) });
                        marker.addTo(weatherLayer);
                        marker.on('click', (e) => {
                            if (e.originalEvent) L.DomEvent.stopPropagation(e.originalEvent);
                            marker.openPopup();
                        });
                        weatherMarkers[m.icaoId] = marker;
                    } else {
                        marker.setIcon(buildWeatherIcon(m.icaoId, color));
                    }
                    marker.bindPopup(buildWeatherPopup(m));
                });
            } catch (e) {
                console.error('載入機場天氣(METAR)失敗:', e);
            }
        }

        const layerControl = L.control.layers({
            "衛星地圖": satellite,
            "標準地圖": osm,
            "地形地圖": topo, // 已加回
            "光害地圖": night // 已加回
        }, {
            "🔌 高壓電纜(塔)": powerLayer,
            "🚨 MSA地障警示": msaLayer,
            "🛡️ 防空隱蔽分析": missileLayer,
            "🌑 夜間陰影區": nightShadowGroup,
            "✈️ 機場與助導航": navaidLayer,
            "📄 VFR目視航路": vfrOverlay,
            "🚧 限制空域": restrictedAreaLayer,
            "🛸 UAS訓練空域": uasAreaLayer,
            "🌤️ 機場天氣": weatherLayer
        }, { position: 'topleft', collapsed: true }).addTo(map);

        // 強制點擊切換
        const cContainer = layerControl.getContainer();
        cContainer.onmouseover = () => { }; cContainer.onmouseout = () => { };
        cContainer.querySelector('.leaflet-control-layers-toggle').addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            cContainer.classList.contains('leaflet-control-layers-expanded') ? layerControl.collapse() : layerControl.expand();
        });

        // 監聽電纜圖層開關
        map.on('overlayadd', e => { if (e.name === "🔌 高壓電纜(塔)") { isPowerLayerActive = true; loadPowerLines(); } });
        map.on('overlayremove', e => { if (e.name === "🔌 高壓電纜(塔)") { isPowerLayerActive = false; } });

        // --- 圖層與控制面板連動 ---
        map.on('overlayadd', e => {
            if (e.name === "🌑 夜間陰影區") { updateMoonInfo(); document.getElementById('ctrl-nvg').style.display = 'flex'; }
            if (e.name === "🚨 MSA地障警示") { document.getElementById('ctrl-msa').style.display = 'flex'; document.getElementById('msa-legend').style.display = 'flex'; }
            if (e.name === "🛡️ 防空隱蔽分析") { document.getElementById('ctrl-missile').style.display = 'flex'; }
            if (e.name === "🚧 限制空域") { document.getElementById('restricted-area-panel').style.display = 'flex'; }
            if (e.name === "🛸 UAS訓練空域") { document.getElementById('uas-area-panel').style.display = 'flex'; }
            if (e.name === "📄 VFR目視航路") { document.getElementById('ctrl-vfr').style.display = 'flex'; }
            if (e.name === "🌤️ 機場天氣") {
                loadAirportWeather();
                if (weatherRefreshTimer) clearInterval(weatherRefreshTimer);
                weatherRefreshTimer = setInterval(loadAirportWeather, 10 * 60 * 1000); // 每 10 分鐘自動更新一次
            }
        });
        map.on('overlayremove', e => {
            if (e.name === "🌑 夜間陰影區") { updateMoonInfo(); document.getElementById('ctrl-nvg').style.display = 'none'; }
            if (e.name === "🚨 MSA地障警示") { document.getElementById('ctrl-msa').style.display = 'none'; document.getElementById('msa-legend').style.display = 'none'; }
            if (e.name === "🛡️ 防空隱蔽分析") { document.getElementById('ctrl-missile').style.display = 'none'; }
            if (e.name === "🚧 限制空域") { document.getElementById('restricted-area-panel').style.display = 'none'; }
            if (e.name === "🛸 UAS訓練空域") { document.getElementById('uas-area-panel').style.display = 'none'; }
            if (e.name === "📄 VFR目視航路") {
                document.getElementById('ctrl-vfr').style.display = 'none';
                if (vfrCalibrating) exitVfrCalibration(true); // 圖層被關掉時視同放棄未儲存的校正草稿
            }
            if (e.name === "🌤️ 機場天氣") {
                if (weatherRefreshTimer) { clearInterval(weatherRefreshTimer); weatherRefreshTimer = null; }
            }
        });

        // --- VFR 圖校正模式 (按鈕整合在底部工具列，不再用獨立對話框) ---
        let vfrCalibrating = false;
        let vfrCalibMarkers = null; // {topleft, topright, bottomleft} L.Marker
        let vfrDraftConfig = null; // { corners, opacity } 校正中的暫存值

        const vfrCalibBtn = document.getElementById('btn-vfr-calibrate');
        const vfrCalibActions = document.getElementById('vfr-calib-actions');
        const vfrOpacitySlider = document.getElementById('vfr-opacity-slider');

        function makeVfrHandle(latlng, labelText) {
            const marker = L.marker(latlng, {
                draggable: true,
                icon: L.divIcon({ className: 'vfr-calib-handle', html: '📍', iconSize: [30, 30], iconAnchor: [15, 28] })
            });
            marker.bindTooltip(labelText, { permanent: true, direction: 'top', offset: [0, -28] });
            return marker;
        }

        function refreshVfrCalibMarkers() {
            if (!vfrCalibMarkers) return;
            Object.keys(vfrCalibMarkers).forEach(key => vfrCalibMarkers[key].setLatLng(vfrDraftConfig.corners[key]));
        }

        function enterVfrCalibration() {
            if (vfrCalibrating) return;
            vfrCalibrating = true;
            vfrDraftConfig = JSON.parse(JSON.stringify(vfrSavedConfig));

            vfrCalibMarkers = {
                topleft: makeVfrHandle(vfrDraftConfig.corners.topleft, '左上'),
                topright: makeVfrHandle(vfrDraftConfig.corners.topright, '右上'),
                bottomleft: makeVfrHandle(vfrDraftConfig.corners.bottomleft, '左下')
            };
            Object.keys(vfrCalibMarkers).forEach(key => {
                const m = vfrCalibMarkers[key];
                m.addTo(map);
                m.on('drag', () => {
                    vfrDraftConfig.corners[key] = [m.getLatLng().lat, m.getLatLng().lng];
                    vfrOverlay.setCorners(vfrDraftConfig.corners);
                });
            });

            vfrOpacitySlider.value = Math.round(vfrDraftConfig.opacity * 100);
            vfrCalibBtn.style.display = 'none';
            vfrCalibActions.style.display = 'flex';
        }

        function exitVfrCalibration(restoreOriginal) {
            if (!vfrCalibrating) return;
            vfrCalibrating = false;
            if (vfrCalibMarkers) {
                Object.values(vfrCalibMarkers).forEach(m => map.removeLayer(m));
                vfrCalibMarkers = null;
            }
            if (restoreOriginal) {
                vfrOverlay.setCorners(vfrSavedConfig.corners);
                vfrOverlay.setOpacity(vfrSavedConfig.opacity);
            }
            vfrCalibBtn.style.display = '';
            vfrCalibActions.style.display = 'none';
        }

        vfrCalibBtn.addEventListener('click', enterVfrCalibration);

        vfrOpacitySlider.addEventListener('input', (e) => {
            const v = parseInt(e.target.value, 10) / 100;
            vfrOverlay.setOpacity(v);
            if (vfrCalibrating) vfrDraftConfig.opacity = v;
        });

        document.getElementById('vfr-calibrate-save').addEventListener('click', () => {
            vfrSavedConfig = JSON.parse(JSON.stringify(vfrDraftConfig));
            localStorage.setItem(VFR_CALIBRATION_KEY, JSON.stringify(vfrSavedConfig));
            exitVfrCalibration(false);
        });

        document.getElementById('vfr-calibrate-export').addEventListener('click', () => {
            const snippet = JSON.stringify(vfrDraftConfig);
            window.prompt('複製這串設定(Ctrl+C)，貼給 Claude 說「幫我把這個寫回 VFR_DEFAULT_CONFIG」，他會直接改程式碼並推上 GitHub：', snippet);
        });

        document.getElementById('vfr-calibrate-reset').addEventListener('click', () => {
            vfrDraftConfig = JSON.parse(JSON.stringify(VFR_DEFAULT_CONFIG));
            vfrOverlay.setCorners(vfrDraftConfig.corners);
            vfrOverlay.setOpacity(vfrDraftConfig.opacity);
            vfrOpacitySlider.value = Math.round(vfrDraftConfig.opacity * 100);
            refreshVfrCalibMarkers();
        });

        document.getElementById('vfr-calibrate-cancel').addEventListener('click', () => {
            exitVfrCalibration(true);
        });

        // --- 7. 雷達播放器 ---
        let cwaRadarLayer = null;
        let radarTimer = null;
        let isRadarPlaying = false;
        let radarCurrentFrame = 11;

        function generateRadarUrls() {
            const urls = [];
            const labels = [];
            const now = new Date();
            // [關鍵修正] 經過測試，官網歷史圖資位於 Data/radar/ 下，且產製延遲約 10-15 分鐘
            let baseTime = new Date(now.getTime() - 15 * 60000);
            baseTime.setMinutes(Math.floor(baseTime.getMinutes() / 10) * 10, 0, 0);

            for (let i = 0; i <= 12; i++) {
                const t = new Date(baseTime.getTime() - (12 - i) * 10 * 60000);
                const yyyy = t.getFullYear();
                const mm = String(t.getMonth() + 1).padStart(2, '0');
                const dd = String(t.getDate()).padStart(2, '0');
                const hh = String(t.getHours()).padStart(2, '0');
                const min = String(t.getMinutes()).padStart(2, '0');
                const timestamp = `${yyyy}${mm}${dd}${hh}${min}`;

                // 使用經測試有效的官網 3600 規格路徑
                urls.push(`https://www.cwa.gov.tw/Data/radar/CV1_3600_${timestamp}.png`);
                labels.push(`${hh}:${min}`);
            }
            return { urls, labels };
        }

        const radarPlayer = {
            data: { urls: [], labels: [] },
            preloaded: {},
            init: function () {
                const { urls, labels } = generateRadarUrls();
                this.data.urls = urls;
                this.data.labels = labels;
                this.preloaded = {};

                const slider = document.getElementById('radar-slider');
                slider.max = urls.length - 1;
                slider.value = urls.length - 1;
                radarCurrentFrame = urls.length - 1;

                // 預載圖片機制
                urls.forEach((url, i) => {
                    const img = new Image();
                    img.src = url;
                    this.preloaded[i] = img;
                });

                document.getElementById('radar-prev').onclick = () => this.step(-1);
                document.getElementById('radar-next').onclick = () => this.step(1);
                document.getElementById('radar-play').onclick = () => this.toggle();
                slider.oninput = (e) => {
                    this.pause();
                    this.showFrame(parseInt(e.target.value));
                };

                this.showFrame(radarCurrentFrame);
            },
            showFrame: function (index) {
                radarCurrentFrame = index;
                const url = this.data.urls[index];
                const label = this.data.labels[index];

                document.getElementById('radar-slider').value = index;
                document.getElementById('current-radar-time').innerText = label;

                const bounds = [[17.75, 115.00], [29.25, 126.50]];
                if (cwaRadarLayer) {
                    cwaRadarLayer.setUrl(url);
                } else {
                    cwaRadarLayer = L.imageOverlay(url, bounds, {
                        opacity: 0.65,
                        zIndex: 500,
                        interactive: false,
                        className: 'radar-image-layer' // 新增 class 以便用 CSS 去除白底
                    });
                    cwaRadarLayer.addTo(map);
                }
            },
            step: function (delta) {
                this.pause();
                let next = radarCurrentFrame + delta;
                if (next < 0) next = this.data.urls.length - 1;
                if (next >= this.data.urls.length) next = 0;
                this.showFrame(next);
            },
            toggle: function () {
                if (isRadarPlaying) this.pause();
                else this.play();
            },
            play: function () {
                if (isRadarPlaying) return;
                isRadarPlaying = true;
                document.getElementById('radar-play').innerText = "⏸";
                radarTimer = setInterval(() => {
                    radarCurrentFrame = (radarCurrentFrame + 1) % this.data.urls.length;
                    this.showFrame(radarCurrentFrame);
                }, 1000); // 稍微放慢播放速度
            },
            pause: function () {
                isRadarPlaying = false;
                document.getElementById('radar-play').innerText = "▶";
                if (radarTimer) clearInterval(radarTimer);
                radarTimer = null;
            },
            stop: function () {
                this.pause();
                if (cwaRadarLayer) {
                    map.removeLayer(cwaRadarLayer);
                    cwaRadarLayer = null;
                }
            }
        };

        function initRadar() {
            layerControl.addOverlay(L.layerGroup([]), "🌧️ 氣象雷達");
        }

        map.on('overlayadd', e => {
            if (e.name === "🌧️ 氣象雷達") {
                document.getElementById('radar-legend').style.display = 'flex';
                document.getElementById('radar-player-ctrl').style.display = 'flex';
                radarPlayer.init();
            }
        });

        map.on('overlayremove', e => {
            if (e.name === "🌧️ 氣象雷達") {
                document.getElementById('radar-legend').style.display = 'none';
                document.getElementById('radar-player-ctrl').style.display = 'none';
                radarPlayer.stop();
            }
        });

        // 已徹底移除 RainViewer 龐大的迴圈輪播機制與 429 Error 風險，大幅提升系統效能

        // --- 8. 航路規劃核心 ---
        let waypoints = [], markers = [], segmentLabels = [], polyline = null;

        // 確保標籤樣式正確 (透明背景)
        const toDegMin = (deg, isLat) => {
            const abs = Math.abs(deg); const d = Math.floor(abs); const m = ((abs - d) * 60).toFixed(1);
            return `${isLat ? (deg >= 0 ? 'N' : 'S') : (deg >= 0 ? 'E' : 'W')} ${d}° ${m}'`;
        };
        const formatTime = (s) => {
            const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
            return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
        };
        async function getElev(lat, lng) {
            try {
                const z = 14;
                const tileXYZ = getTileXYZ(lat, lng, z);
                const tilePos = getTileFraction(lng, lat, z);

                const img = new Image();
                img.crossOrigin = "Anonymous";
                img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${tileXYZ.x}/${tileXYZ.y}.png`;

                await new Promise((resolve, reject) => {
                    img.onload = resolve;
                    img.onerror = reject;
                });

                const canvas = document.createElement('canvas');
                canvas.width = 1;
                canvas.height = 1;
                const ctx = canvas.getContext('2d');

                const px = Math.floor((tilePos.x % 1) * 256);
                const py = Math.floor((tilePos.y % 1) * 256);

                ctx.drawImage(img, -px, -py);
                const data = ctx.getImageData(0, 0, 1, 1).data;
                const h = (data[0] * 256 + data[1] + data[2] / 256) - 32768;
                return Math.round(h * 3.28084); // 轉換為英呎
            } catch (e) {
                return "---";
            }
        }

        // --- [新增] 航線廊道最高點分析 ---
        async function getCorridorMaxElevation(latlng1, latlng2) {
            const calcIndicator = document.getElementById('calc-indicator');
            calcIndicator.innerText = '🛰️ 分析航線地形剖面中...';
            calcIndicator.style.display = 'block';

            try {
                const corridorWidthKm = 1.0; // 1km total width
                const z = 13; // Zoom level for terrain tiles
                const tileSize = 256;

                const line = turf.lineString([[latlng1.lng, latlng1.lat], [latlng2.lng, latlng2.lat]]);
                const buffered = turf.buffer(line, corridorWidthKm / 2, { units: 'kilometers' });
                const bbox = turf.bbox(buffered);

                const topLeftTile = getTileXYZ(bbox[3], bbox[0], z);
                const bottomRightTile = getTileXYZ(bbox[1], bbox[2], z);

                const cols = bottomRightTile.x - topLeftTile.x + 1;
                const rows = bottomRightTile.y - topLeftTile.y + 1;

                const canvas = document.createElement('canvas');
                canvas.width = cols * tileSize;
                canvas.height = rows * tileSize;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });

                const promises = [];
                for (let x = topLeftTile.x; x <= bottomRightTile.x; x++) {
                    for (let y = topLeftTile.y; y <= bottomRightTile.y; y++) {
                        const p = new Promise((resolve) => {
                            const img = new Image();
                            img.crossOrigin = "Anonymous";
                            img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
                            img.onload = () => {
                                ctx.drawImage(img, (x - topLeftTile.x) * tileSize, (y - topLeftTile.y) * tileSize);
                                resolve();
                            };
                            img.onerror = () => {
                                ctx.fillStyle = 'black';
                                ctx.fillRect((x - topLeftTile.x) * tileSize, (y - topLeftTile.y) * tileSize, tileSize, tileSize);
                                resolve();
                            };
                        });
                        promises.push(p);
                    }
                }
                await Promise.all(promises);

                const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

                const workerCode = `
                    self.importScripts('https://unpkg.com/@turf/turf/turf.min.js');
                    function pointToLatLng(x, y, z) {
                        const n = Math.pow(2, z);
                        const lng = x / n * 360 - 180;
                        const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
                        return { lat, lng };
                    }
                    self.onmessage = function(e) {
                        const { buffer, width, height, corridor, z, topLeftTileX, topLeftTileY } = e.data;
                        const data = new Uint8ClampedArray(buffer);
                        let maxElev = -Infinity;
                        for (let y = 0; y < height; y+=4) { // Sample every 4 pixels for performance
                            for (let x = 0; x < width; x+=4) {
                                const tileX = topLeftTileX + (x + 0.5) / 256;
                                const tileY = topLeftTileY + (y + 0.5) / 256;
                                const { lat, lng } = pointToLatLng(tileX, tileY, z);
                                const pt = turf.point([lng, lat]);
                                if (turf.booleanPointInPolygon(pt, corridor)) {
                                    const i = (y * width + x) * 4;
                                    const h = (data[i] * 256 + data[i+1] + data[i+2] / 256) - 32768;
                                    if (h > maxElev) maxElev = h;
                                }
                            }
                        }
                        self.postMessage(maxElev);
                    };
                `;
                const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
                const workerUrl = URL.createObjectURL(workerBlob);
                const worker = new Worker(workerUrl);

                const maxElevMeters = await new Promise((resolve) => {
                    worker.onmessage = (e) => resolve(e.data);
                    worker.postMessage({
                        buffer: imgData.data.buffer,
                        width: canvas.width,
                        height: canvas.height,
                        corridor: buffered,
                        z: z,
                        topLeftTileX: topLeftTile.x,
                        topLeftTileY: topLeftTile.y
                    }, [imgData.data.buffer]);
                });

                worker.terminate();
                URL.revokeObjectURL(workerUrl);
                return maxElevMeters;
            } catch (err) {
                console.error("Error in getCorridorMaxElevation:", err);
                return -1;
            } finally {
                calcIndicator.style.display = 'none';
                calcIndicator.innerText = '📡 計算雷達視域中...';
            }
        }

        map.on('click', e => {
            // 嚴格攔截所有在地標與標籤上的點擊，防止穿透到底圖生成航向點
            if (e.originalEvent && e.originalEvent.target && e.originalEvent.target.closest) {
                if (e.originalEvent.target.closest('.leaflet-popup') ||
                    e.originalEvent.target.closest('.leaflet-marker-icon') ||
                    e.originalEvent.target.closest('.leaflet-tooltip') ||
                    e.originalEvent.target.closest('.navaid-icon') ||
                    e.originalEvent.target.closest('.navaid-label')) {
                    return;
                }
            }

            // 如果當前畫面上有任何 Popup 已經是開啟狀態，這次的點擊目的是為了「關閉 Popup」，所以不應該生成航線點！
            let isPopupOpen = false;
            map.eachLayer(layer => {
                if (layer instanceof L.Popup) isPopupOpen = true;
            });
            if (isPopupOpen) {
                return;
            }

            if (!isPlacingMissile) addWP(e.latlng);
        });
        async function addWP(latlng) {
            const marker = L.marker(latlng, { draggable: true }).addTo(map);
            marker.elevText = "---";
            // 綁定透明標籤
            marker.bindTooltip("", { permanent: true, direction: "top", offset: [0, -15], className: 'big-label' });
            marker.coordTooltip = L.tooltip({ permanent: true, direction: 'left', offset: [-20, 0], className: 'big-label' });
            marker.bindTooltip(marker.coordTooltip);
            const refresh = async (m) => { m.elevText = await getElev(m.getLatLng().lat, m.getLatLng().lng); updatePlan(); if (isPowerLayerActive) loadPowerLines(); };
            marker.on('dragend', () => { const i = markers.indexOf(marker); waypoints[i] = marker.getLatLng(); refresh(marker); });

            // [新增] 拖曳時：方位角吸附 + 即時顯示航段資訊 (手機長按拖曳時參考用)
            marker.on('drag', (e) => {
                const i = markers.indexOf(marker);
                let newPos = e.latlng;
                if (i > 0) {
                    const prev = waypoints[i - 1];
                    const b = turf.bearing([prev.lng, prev.lat], [newPos.lng, newPos.lat]);
                    let snap = null;
                    if (Math.abs(b) < 5) snap = 0;
                    else if (Math.abs(b - 90) < 5) snap = 90;
                    else if (Math.abs(Math.abs(b) - 180) < 5) snap = 180;
                    else if (Math.abs(b + 90) < 5) snap = -90;
                    if (snap !== null) {
                        const dist = turf.distance([prev.lng, prev.lat], [newPos.lng, newPos.lat]);
                        const dest = turf.destination([prev.lng, prev.lat], dist, snap);
                        newPos = new L.LatLng(dest.geometry.coordinates[1], dest.geometry.coordinates[0]);
                        marker.setLatLng(newPos);
                    }
                }

                waypoints[i] = newPos;
                if (polyline) polyline.setLatLngs(waypoints);

                // --- 即時資訊顯示計算 ---
                const k = 120;
                let info = `<div style="text-align:center; font-weight:bold; color:#00FFFF; font-size:1.1em; margin-bottom: 2px;">${i === 0 ? "SP" : `ACP ${i}`}</div>`;

                // 計算與"前一點"的關係 (Inbound)
                if (i > 0) {
                    const prev = waypoints[i - 1];
                    const prevMarker = markers[i - 1];
                    let prevK = prevMarker && prevMarker.customAirspeed ? parseFloat(prevMarker.customAirspeed) : k;
                    const d = turf.distance([prev.lng, prev.lat], [newPos.lng, newPos.lat], { units: 'nauticalmiles' });
                    const b = (turf.bearing([prev.lng, prev.lat], [newPos.lng, newPos.lat]) + 360) % 360;

                    let calcD = d;
                    if ((i - 1) === 0) calcD += 2; // 起飛段緩衝

                    const s = Math.round((calcD / prevK) * 3600);
                    info += `<div style="font-size:0.9em; color:#FFFF00; border-top:1px solid #555; padding-top:2px;">
                                ⬅ ${b.toFixed(0)}° / ${d.toFixed(1)} NM / ${prevK} KT<br>
                                ⏱ ${formatTime(s)}
                             </div>`;
                }

                // 計算與"後一點"的關係 (Outbound)
                if (i < waypoints.length - 1) {
                    const next = waypoints[i + 1];
                    let currentK = marker.customAirspeed ? parseFloat(marker.customAirspeed) : k;
                    const d = turf.distance([newPos.lng, newPos.lat], [next.lng, next.lat], { units: 'nauticalmiles' });
                    const b = (turf.bearing([newPos.lng, newPos.lat], [next.lng, next.lat]) + 360) % 360;

                    let calcD = d;
                    if (i === waypoints.length - 2) calcD += 2; // 落地段緩衝

                    const s = Math.round((calcD / currentK) * 3600);
                    info += `<div style="font-size:0.9em; color:#00FF00; border-top:1px solid #555; margin-top:2px; padding-top:2px;">
                                ➡ ${b.toFixed(0)}° / ${d.toFixed(1)} NM / ${currentK} KT<br>
                                ⏱ ${formatTime(s)}
                             </div>`;
                }

                // 強制開啟並更新標籤
                if (marker.getTooltip()) {
                    marker.setTooltipContent(info);
                    marker.openTooltip();
                }
            });

            markers.push(marker); waypoints.push(latlng); refresh(marker); updatePlan();
        }
        function updatePlan() {
            const k = 120;
            if (polyline) map.removeLayer(polyline);
            segmentLabels.forEach(l => map.removeLayer(l));
            segmentLabels = [];
            let tD = 0, tS = 0, tF = 0;

            waypoints.forEach((pt, i) => {
                if (!markers[i]) return; // Marker might have been deleted
                let defaultTitle = i === 0 ? "SP" : `ACP ${i}`;
                const title = markers[i].customName || defaultTitle;
                markers[i].getTooltip().setContent(title);
                markers[i].coordTooltip.setContent(`<div>${title}</div>標高: <span>${markers[i].elevText}</span> ft`);

                if (i < waypoints.length - 1) {
                    const next = waypoints[i + 1];
                    const d = turf.distance([pt.lng, pt.lat], [next.lng, next.lat], { units: 'nauticalmiles' });
                    const b = (turf.bearing([pt.lng, pt.lat], [next.lng, next.lat]) + 360) % 360;

                    let calcD = d;
                    if (i === 0) calcD += 2;
                    if (i === waypoints.length - 2) calcD += 2;

                    let currentK = markers[i].customAirspeed ? parseFloat(markers[i].customAirspeed) : (k || 120);
                    let currentFuelRate = markers[i].customFuelRate ? parseFloat(markers[i].customFuelRate) : 800;
                    const s = Math.round((calcD / currentK) * 3600);
                    tD += d; tS += s; tF += (s / 3600) * currentFuelRate;

                    const mid = turf.midpoint([pt.lng, pt.lat], [next.lng, next.lat]);
                    const labelHtml = `${b.toFixed(0)}°/${d.toFixed(1)}NM/${currentK}KT<br>${Math.floor(s / 60)}'${s % 60}"&nbsp;/&nbsp;...`;
                    const label = L.marker([mid.geometry.coordinates[1], mid.geometry.coordinates[0]], {
                        icon: L.divIcon({ className: 'big-label segment-label', html: labelHtml })
                    }).addTo(map);
                    label.segmentIndex = i;
                    segmentLabels.push(label);

                    getCorridorMaxElevation(pt, next).then(maxElevM => {
                        const currentLabel = segmentLabels.find(l => l.segmentIndex === i);
                        if (!currentLabel) return; // Label was removed, do nothing

                        if (maxElevM === -Infinity || maxElevM === -1) {
                            const failedHtml = `${b.toFixed(0)}°/${d.toFixed(1)}NM/${currentK}KT<br>${Math.floor(s / 60)}'${s % 60}"&nbsp;/&nbsp;<span style="color:#FF4444;">失敗</span>`;
                            currentLabel.setIcon(L.divIcon({ className: 'big-label segment-label', html: failedHtml }));
                            return;
                        }
                        const suggestedAltFt = Math.ceil(((maxElevM * 3.28084) + 500) / 100) * 100;
                        currentLabel.suggestedAltFt = suggestedAltFt; // Store for potential future use
                        let altDisplay = markers[i].customAlt || suggestedAltFt;
const newHtml = `${b.toFixed(0)}°/${d.toFixed(1)}NM/${currentK}KT<br>${Math.floor(s / 60)}'${s % 60}"&nbsp;/&nbsp;${altDisplay}FT`;
                        currentLabel.setIcon(L.divIcon({ className: 'big-label segment-label', html: newHtml }));
                    });
                }
            });
            if (waypoints.length > 1) polyline = L.polyline(waypoints, { color: '#00FFFF', weight: 5, dashArray: '15, 10' }).addTo(map);
            document.getElementById('totalDistance').textContent = tD.toFixed(1) + ' NM';
            document.getElementById('totalTime').textContent = formatTime(tS);
            document.getElementById('totalFuel').textContent = tF.toFixed(1) + ' lbs';
        }
        document.getElementById('delete-btn').onclick = () => { if (waypoints.length > 0) { waypoints.pop(); map.removeLayer(markers.pop()); updatePlan(); if (isPowerLayerActive) loadPowerLines(); } };

        // ===== 匯出CSV用的座標格式轉換 =====
        // 度分(DDM): 例如 N23°30.123'　度分秒(DMS): 例如 N23°30'07.4"
        function formatCoordDDM(value, isLat) {
            const hemi = isLat ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
            const abs = Math.abs(value);
            const deg = Math.floor(abs);
            const min = (abs - deg) * 60;
            return `${hemi}${deg}°${min.toFixed(3)}'`;
        }
        function formatCoordDMS(value, isLat) {
            const hemi = isLat ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
            const abs = Math.abs(value);
            const deg = Math.floor(abs);
            const minFull = (abs - deg) * 60;
            const min = Math.floor(minFull);
            const sec = (minFull - min) * 60;
            return `${hemi}${deg}°${min}'${sec.toFixed(1)}"`;
        }

        // MGRS(軍事座標格式)轉換：經緯度 -> UTM -> MGRS 100k方格命名，移植自公開的
        // WGS84 UTM/MGRS 轉換演算法(proj4js/mgrs，MIT授權)，只保留正向(經緯度->MGRS)所需的部分，
        // 包成 IIFE 避免通用命名(A/I/O/Z...)汙染到外層作用域
        const latLngToMGRS = (function () {
            const NUM_100K_SETS = 6;
            const SET_ORIGIN_COLUMN_LETTERS = 'AJSAJS';
            const SET_ORIGIN_ROW_LETTERS = 'AFAFAF';
            const A = 65, I = 73, O = 79, V = 86, Z = 90;
            const ECC_SQUARED = 0.00669438;
            const SCALE_FACTOR = 0.9996;
            const SEMI_MAJOR_AXIS = 6378137;
            const EASTING_OFFSET = 500000;
            const NORTHING_OFFSET = 10000000;
            const UTM_ZONE_WIDTH = 6;
            const HALF_UTM_ZONE_WIDTH = UTM_ZONE_WIDTH / 2;

            function degToRad(deg) { return deg * (Math.PI / 180); }

            function getLetterDesignator(latitude) {
                if (latitude <= 84 && latitude >= 72) return 'X';
                if (latitude < 72 && latitude >= -80) {
                    const bandLetters = 'CDEFGHJKLMNPQRSTUVWX';
                    return bandLetters[Math.floor((latitude - (-80)) / 8)];
                }
                return 'Z';
            }

            function LLtoUTM(lat, lon) {
                const a = SEMI_MAJOR_AXIS;
                const LatRad = degToRad(lat);
                const LongRad = degToRad(lon);
                let ZoneNumber = Math.floor((lon + 180) / 6) + 1;
                if (lon === 180) ZoneNumber = 60;
                if (lat >= 56 && lat < 64 && lon >= 3 && lon < 12) ZoneNumber = 32;
                if (lat >= 72 && lat < 84) {
                    if (lon >= 0 && lon < 9) ZoneNumber = 31;
                    else if (lon >= 9 && lon < 21) ZoneNumber = 33;
                    else if (lon >= 21 && lon < 33) ZoneNumber = 35;
                    else if (lon >= 33 && lon < 42) ZoneNumber = 37;
                }
                const LongOrigin = (ZoneNumber - 1) * UTM_ZONE_WIDTH - 180 + HALF_UTM_ZONE_WIDTH;
                const LongOriginRad = degToRad(LongOrigin);
                const eccPrimeSquared = ECC_SQUARED / (1 - ECC_SQUARED);

                const N = a / Math.sqrt(1 - ECC_SQUARED * Math.sin(LatRad) * Math.sin(LatRad));
                const T = Math.tan(LatRad) * Math.tan(LatRad);
                const C = eccPrimeSquared * Math.cos(LatRad) * Math.cos(LatRad);
                const Ap = Math.cos(LatRad) * (LongRad - LongOriginRad);

                const M = a * ((1 - ECC_SQUARED / 4 - 3 * ECC_SQUARED * ECC_SQUARED / 64 - 5 * ECC_SQUARED * ECC_SQUARED * ECC_SQUARED / 256) * LatRad
                    - (3 * ECC_SQUARED / 8 + 3 * ECC_SQUARED * ECC_SQUARED / 32 + 45 * ECC_SQUARED * ECC_SQUARED * ECC_SQUARED / 1024) * Math.sin(2 * LatRad)
                    + (15 * ECC_SQUARED * ECC_SQUARED / 256 + 45 * ECC_SQUARED * ECC_SQUARED * ECC_SQUARED / 1024) * Math.sin(4 * LatRad)
                    - (35 * ECC_SQUARED * ECC_SQUARED * ECC_SQUARED / 3072) * Math.sin(6 * LatRad));

                const UTMEasting = SCALE_FACTOR * N * (Ap + (1 - T + C) * Ap * Ap * Ap / 6
                    + (5 - 18 * T + T * T + 72 * C - 58 * eccPrimeSquared) * Ap * Ap * Ap * Ap * Ap / 120) + EASTING_OFFSET;

                let UTMNorthing = SCALE_FACTOR * (M + N * Math.tan(LatRad) * (Ap * Ap / 2 + (5 - T + 9 * C + 4 * C * C) * Ap * Ap * Ap * Ap / 24
                    + (61 - 58 * T + T * T + 600 * C - 330 * eccPrimeSquared) * Ap * Ap * Ap * Ap * Ap * Ap / 720));
                if (lat < 0) UTMNorthing += NORTHING_OFFSET;

                return {
                    northing: Math.trunc(UTMNorthing),
                    easting: Math.trunc(UTMEasting),
                    zoneNumber: ZoneNumber,
                    zoneLetter: getLetterDesignator(lat)
                };
            }

            function get100kSetForZone(i) {
                let setParm = i % NUM_100K_SETS;
                if (setParm === 0) setParm = NUM_100K_SETS;
                return setParm;
            }

            function getLetter100kID(column, row, parm) {
                const index = parm - 1;
                const colOrigin = SET_ORIGIN_COLUMN_LETTERS.charCodeAt(index);
                const rowOrigin = SET_ORIGIN_ROW_LETTERS.charCodeAt(index);

                let colInt = colOrigin + column - 1;
                let rowInt = rowOrigin + row;
                let rollover = false;

                if (colInt > Z) { colInt = colInt - Z + A - 1; rollover = true; }
                if (colInt === I || (colOrigin < I && colInt > I) || ((colInt > I || colOrigin < I) && rollover)) colInt++;
                if (colInt === O || (colOrigin < O && colInt > O) || ((colInt > O || colOrigin < O) && rollover)) {
                    colInt++;
                    if (colInt === I) colInt++;
                }
                if (colInt > Z) colInt = colInt - Z + A - 1;

                if (rowInt > V) { rowInt = rowInt - V + A - 1; rollover = true; } else { rollover = false; }
                if (((rowInt === I) || ((rowOrigin < I) && (rowInt > I))) || (((rowInt > I) || (rowOrigin < I)) && rollover)) rowInt++;
                if (((rowInt === O) || ((rowOrigin < O) && (rowInt > O))) || (((rowInt > O) || (rowOrigin < O)) && rollover)) {
                    rowInt++;
                    if (rowInt === I) rowInt++;
                }
                if (rowInt > V) rowInt = rowInt - V + A - 1;

                return String.fromCharCode(colInt) + String.fromCharCode(rowInt);
            }

            function get100kID(easting, northing, zoneNumber) {
                const setParm = get100kSetForZone(zoneNumber);
                const setColumn = Math.floor(easting / 100000);
                const setRow = Math.floor(northing / 100000) % 20;
                return getLetter100kID(setColumn, setRow, setParm);
            }

            function encode(utm, accuracy) {
                const seasting = '00000' + utm.easting;
                const snorthing = '00000' + utm.northing;
                return utm.zoneNumber + utm.zoneLetter + get100kID(utm.easting, utm.northing, utm.zoneNumber)
                    + seasting.substr(seasting.length - 5, accuracy) + snorthing.substr(snorthing.length - 5, accuracy);
            }

            // 南北極區(80°S以南、84°N以北)MGRS不適用，退回顯示十進位度並註記
            return function (lat, lon, accuracy) {
                accuracy = (typeof accuracy === 'number') ? accuracy : 5;
                if (lat < -80 || lat > 84) {
                    return `${lat.toFixed(5)},${lon.toFixed(5)}(超出MGRS適用範圍)`;
                }
                return encode(LLtoUTM(lat, lon), accuracy);
            };
        })();

        document.getElementById('export-btn').onclick = async () => {
            if (waypoints.length < 2) return alert("請至少設定兩個航點");

            const calcIndicator = document.getElementById('calc-indicator');
            calcIndicator.innerText = '🚢 準備匯出資料...';
            calcIndicator.style.display = 'block';

            const k = 120;
            const coordFormatEl = document.getElementById('csv-coord-format');
            const coordFormat = coordFormatEl ? coordFormatEl.value : 'dd';
            // MGRS 是單一格子座標字串，跟緯度/經度分成兩欄的表示法不同，欄位數量要跟著格式調整，
            // 否則後面「總計」那一列的空欄位數量會對不齊
            const coordHeaderCols = (coordFormat === 'mgrs') ? ['座標(MGRS)'] : ['緯度', '經度'];
            const headerCols = ['航點', '航向', '距離(NM)', '時間', '空速(KT)', '油耗(lb)', '建議高度(ft)', ...coordHeaderCols, '標高(ft)'];
            let csv = "\ufeff" + headerCols.join(',') + "\n";
            let tD = 0, tS = 0, tF = 0;

            const segmentAlts = [];
            for (let i = 0; i < waypoints.length - 1; i++) {
                calcIndicator.innerText = `分析第 ${i + 1} 段航線地形...`;
                const pt = waypoints[i];
                const next = waypoints[i + 1];
                const maxElevM = await getCorridorMaxElevation(pt, next);
                if (maxElevM === -Infinity || maxElevM === -1) {
                    segmentAlts.push("計算失敗");
                } else {
                    const suggestedAltFt = Math.ceil(((maxElevM * 3.28084) + 500) / 100) * 100;
                    segmentAlts.push(suggestedAltFt);
                }
            }
            calcIndicator.innerText = `✅ 地形分析完成，正在產生CSV...`;

            waypoints.forEach((pt, i) => {
                let c = "", d = "", t = "", spd = "", f = "", sa = "";
                if (i < waypoints.length - 1) {
                    const next = waypoints[i + 1];
                    const dist = turf.distance([pt.lng, pt.lat], [next.lng, next.lat], { units: 'nauticalmiles' });
                    const brg = (turf.bearing([pt.lng, pt.lat], [next.lng, next.lat]) + 360) % 360;

                    let calcDist = dist;
                    if (i === 0) calcDist += 2;
                    if (i === waypoints.length - 2) calcDist += 2;

                    let currentK = markers[i].customAirspeed ? parseFloat(markers[i].customAirspeed) : (k || 120);
                    let currentFuelRate = markers[i].customFuelRate ? parseFloat(markers[i].customFuelRate) : 800;
                    const sec = Math.round((calcDist / currentK) * 3600);
                    const fuel = (sec / 3600) * currentFuelRate;
                    tD += dist; tS += sec; tF += fuel;
                    c = brg.toFixed(0) + "°";
                    d = dist.toFixed(1);
                    t = formatTime(sec);
                    spd = currentK;
                    f = fuel.toFixed(1);
                    sa = segmentAlts[i];
                    if (markers[i].customAlt) sa = markers[i].customAlt;
                }
                let defaultTitle = i === 0 ? 'SP' : `ACP ${i}`;
                const name = markers[i] && markers[i].customName ? markers[i].customName : defaultTitle;
                const elevText = markers[i] ? markers[i].elevText : '---';

                let coordCols;
                if (coordFormat === 'mgrs') {
                    coordCols = [latLngToMGRS(pt.lat, pt.lng)];
                } else if (coordFormat === 'ddm') {
                    coordCols = [formatCoordDDM(pt.lat, true), formatCoordDDM(pt.lng, false)];
                } else if (coordFormat === 'dms') {
                    coordCols = [formatCoordDMS(pt.lat, true), formatCoordDMS(pt.lng, false)];
                } else {
                    coordCols = [pt.lat.toFixed(5), pt.lng.toFixed(5)];
                }

                csv += [name, c, d, t, spd, f, sa, ...coordCols, elevText].join(',') + '\n';
            });

            const coordTotalBlanks = coordHeaderCols.map(() => '');
            csv += ['總計', '', tD.toFixed(1), formatTime(tS), '', tF.toFixed(1), '', ...coordTotalBlanks, ''].join(',') + '\n';
            calcIndicator.style.display = 'none';

            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = "航空計畫_Summary.csv";
            link.click();
        };

        // 取得目前地圖上「勾選中」的限制空域/UAS訓練空域，供 3D PVW 使用
        function getActiveRestrictedAreas() {
            if (typeof RESTRICTED_AREAS_DATA === 'undefined' || !map.hasLayer(restrictedAreaLayer)) return [];
            return RESTRICTED_AREAS_DATA.areas
                .filter(area => {
                    const sub = restrictedAreaSubLayers[area.id];
                    return sub && restrictedAreaLayer.hasLayer(sub);
                })
                .map(area => ({
                    id: area.id,
                    name: getAreaDisplayName(area),
                    geometry_type: area.geometry_type,
                    geometry: area.geometry,
                    upper_limit_ft: area.upper_limit_ft,
                    lower_limit_ft: area.lower_limit_ft
                }));
        }

        function getActiveUasAreas() {
            if (typeof UAS_AREAS_DATA === 'undefined' || !map.hasLayer(uasAreaLayer)) return [];
            return UAS_AREAS_DATA.areas
                .filter(area => {
                    const sub = uasAreaSubLayers[area.id];
                    return sub && uasAreaLayer.hasLayer(sub);
                })
                .map(area => ({
                    id: area.id,
                    name: getAreaDisplayName(area),
                    geometry_type: area.geometry_type,
                    geometry: area.geometry,
                    upper_limit_ft: area.upper_limit_ft,
                    lower_limit_ft: area.lower_limit_ft
                }));
        }

        // 取得目前地圖上已下載、勾選顯示中的高壓電纜線段/電塔點位，供 3D PVW 使用
        function getActivePowerLines() {
            if (!map.hasLayer(powerLayer)) return { lines: [], towers: [] };
            const lines = [];
            const towers = [];
            powerLayer.eachLayer(layer => {
                if (layer instanceof L.CircleMarker) {
                    const ll = layer.getLatLng();
                    towers.push([ll.lng, ll.lat]);
                } else if (layer instanceof L.Polyline) {
                    const latlngs = layer.getLatLngs().map(ll => [ll.lng, ll.lat]);
                    if (latlngs.length > 1) lines.push(latlngs);
                }
            });
            return { lines, towers };
        }

        document.getElementById('export-gpx-btn').onclick = () => {
            if (waypoints.length < 2) return alert("請至少設定兩個航點");

            let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n';
            gpx += '<gpx version="1.1" creator="簡易航空計畫器" xmlns="http://www.topografix.com/GPX/1/1">\n';

            // 1. Export Waypoints (Using plan altitude)
            waypoints.forEach((pt, i) => {
                let defaultTitle = i === 0 ? 'SP' : `ACP ${i}`;
                const name = markers[i] && markers[i].customName ? markers[i].customName : defaultTitle;
                
                let altFt = 0;
                if (i === 0 || i === waypoints.length - 1) {
                    // SP(起點)及最後一點：高度設為該點標高(地面高度)，符合起降時位於地面的實際情況
                    altFt = (markers[i] && markers[i].elevText && !isNaN(parseFloat(markers[i].elevText))) ? parseFloat(markers[i].elevText) : 0;
                } else {
                    altFt = (markers[i] && markers[i].customAlt) ? parseFloat(markers[i].customAlt) :
                            (segmentLabels[i-1] && segmentLabels[i-1].suggestedAltFt ? segmentLabels[i-1].suggestedAltFt : 0);
                }
                const elev = altFt / 3.28084;

                gpx += `  <wpt lat="${pt.lat.toFixed(6)}" lon="${pt.lng.toFixed(6)}">\n`;
                gpx += `    <name>${name}</name>\n`;
                if (elev) gpx += `    <ele>${elev.toFixed(1)}</ele>\n`;
                gpx += `  </wpt>\n`;
            });

            // 2. Export Track with interpolated points and TIME
            gpx += `  <trk>\n`;
            gpx += `    <name>飛行計畫航線</name>\n`;
            gpx += `    <trkseg>\n`;

            const intervalKm = 0.5; // 每 500 公尺一個點
            let currentTimeMs = Date.now(); // 從現在開始起算

            for (let i = 0; i < waypoints.length - 1; i++) {
                const ptA = waypoints[i];
                const ptB = waypoints[i+1];
                
                let eleA_ft = 0;
                if (i === 0) {
                    eleA_ft = (markers[0] && markers[0].elevText && !isNaN(parseFloat(markers[0].elevText))) ? parseFloat(markers[0].elevText) : 0;
                } else {
                    eleA_ft = (markers[i] && markers[i].customAlt) ? parseFloat(markers[i].customAlt) : 
                              (segmentLabels[i-1] && segmentLabels[i-1].suggestedAltFt ? segmentLabels[i-1].suggestedAltFt : 0);
                }
                const eleA = eleA_ft / 3.28084;

                let eleB_ft = 0;
                if (i + 1 === waypoints.length - 1) {
                    // 這段的終點是最後一個航點：高度設為該點標高
                    eleB_ft = (markers[i+1] && markers[i+1].elevText && !isNaN(parseFloat(markers[i+1].elevText))) ? parseFloat(markers[i+1].elevText) : 0;
                } else if (markers[i+1] && markers[i+1].customAlt) {
                    eleB_ft = parseFloat(markers[i+1].customAlt);
                } else {
                    eleB_ft = (segmentLabels[i] && segmentLabels[i].suggestedAltFt) ? segmentLabels[i].suggestedAltFt : eleA_ft;
                }
                const eleB = eleB_ft / 3.28084;

                const currentK = (markers[i] && markers[i].customAirspeed) ? parseFloat(markers[i].customAirspeed) : 120;
                const speedKmh = currentK * 1.852;
                const msPerKm = (1 / speedKmh) * 3600 * 1000;

                const line = turf.lineString([[ptA.lng, ptA.lat], [ptB.lng, ptB.lat]]);
                const totalDist = turf.length(line, {units: 'kilometers'});
                
                // Add start point of segment
                const timeStrA = new Date(currentTimeMs).toISOString();
                gpx += `      <trkpt lat="${ptA.lat.toFixed(6)}" lon="${ptA.lng.toFixed(6)}"><ele>${eleA.toFixed(1)}</ele><time>${timeStrA}</time></trkpt>\n`;
                
                // Interpolate
                let currentDist = intervalKm;
                while (currentDist < totalDist) {
                    const along = turf.along(line, currentDist, {units: 'kilometers'});
                    const fraction = currentDist / totalDist;
                    const interpEle = eleA + (eleB - eleA) * fraction;
                    const coords = along.geometry.coordinates; // [lng, lat]
                    
                    const timeStr = new Date(currentTimeMs + currentDist * msPerKm).toISOString();
                    
                    gpx += `      <trkpt lat="${coords[1].toFixed(6)}" lon="${coords[0].toFixed(6)}"><ele>${interpEle.toFixed(1)}</ele><time>${timeStr}</time></trkpt>\n`;
                    currentDist += intervalKm;
                }
                currentTimeMs += totalDist * msPerKm;
            }
            
            // Add the very last point (高度設為該點標高，與 SP 起點相同邏輯)
            const lastPt = waypoints[waypoints.length - 1];
            const lastIdx = waypoints.length - 1;
            const lastEle_ft = (markers[lastIdx] && markers[lastIdx].elevText && !isNaN(parseFloat(markers[lastIdx].elevText))) ? parseFloat(markers[lastIdx].elevText) : 0;
            const lastEle = lastEle_ft / 3.28084;
            
            const timeStrLast = new Date(currentTimeMs).toISOString();
            gpx += `      <trkpt lat="${lastPt.lat.toFixed(6)}" lon="${lastPt.lng.toFixed(6)}"><ele>${lastEle.toFixed(1)}</ele><time>${timeStrLast}</time></trkpt>\n`;

            gpx += `    </trkseg>\n`;
            gpx += `  </trk>\n`;
            gpx += `</gpx>`;

            // Save GPX to sessionStorage for 3D analysis
            sessionStorage.setItem('mission_gpx', gpx);

            // Save missile threat data for 3D analysis
            let threatData = null;
            if (typeof lastMissileLatLng !== 'undefined' && lastMissileLatLng) {
                const altEl = document.getElementById('missile-alt');
                const rangeEl = document.getElementById('missile-range');
                threatData = {
                    lat: lastMissileLatLng.lat,
                    lng: lastMissileLatLng.lng,
                    altFt: altEl ? (parseInt(altEl.value) || 0) : 0,
                    rangeNm: rangeEl ? (parseFloat(rangeEl.value) || 0) : 0
                };
            }
            // 威脅範圍的紅色遮罩圖(跟地圖上顯示的是同一份計算結果)，一併帶到 3D PVW，
            // 這樣 3D 畫面呈現的可偵測範圍會跟 2D 地圖上看到的完全一致，不用在 3D 端另外簡化重算
            const viewshedImageForExport = (threatData && window.lastViewshedResult) ? window.lastViewshedResult : null;

            if (threatData) {
                sessionStorage.setItem('mission_threat', JSON.stringify(threatData));
                if (viewshedImageForExport) sessionStorage.setItem('mission_viewshed_image', JSON.stringify(viewshedImageForExport));
                else sessionStorage.removeItem('mission_viewshed_image');
            } else {
                sessionStorage.removeItem('mission_threat'); // clear if none
                sessionStorage.removeItem('mission_viewshed_image');
            }

            // 目前地圖上有勾選顯示的限制空域/UAS訓練空域，一併帶到 3D PVW
            const restrictedAreasForExport = getActiveRestrictedAreas();
            const uasAreasForExport = getActiveUasAreas();
            sessionStorage.setItem('mission_restricted_areas', JSON.stringify(restrictedAreasForExport));
            sessionStorage.setItem('mission_uas_areas', JSON.stringify(uasAreasForExport));

            // 目前已下載、勾選顯示中的高壓電纜(塔)資料，一併帶到 3D PVW
            const powerLinesForExport = getActivePowerLines();
            sessionStorage.setItem('mission_power_lines', JSON.stringify(powerLinesForExport));

            // Store in global window object for cross-tab postMessage bridge (file:// fallback)
            window.latestGpxString = gpx;
            window.latestThreatData = threatData;
            window.latestViewshedImage = viewshedImageForExport;
            window.latestRestrictedAreas = restrictedAreasForExport;
            window.latestUasAreas = uasAreasForExport;
            window.latestPowerLines = powerLinesForExport;

            // 把資料直接掛在網址 hash 上：file:// 雙擊開啟時，每個檔案常被視為不同來源，
            // sessionStorage / window.opener 不保證能跨分頁使用，網址傳遞才是唯一保證能送達的方式
            const missionPayload = encodeURIComponent(JSON.stringify({
                gpx,
                threat: threatData,
                viewshedImage: viewshedImageForExport,
                restrictedAreas: restrictedAreasForExport,
                uasAreas: uasAreasForExport,
                powerLines: powerLinesForExport
            }));

            // Open 3D analysis page
            window.open('FDR/analysis.html#data=' + missionPayload, '_blank');
        };

        // 監聽 3D 分析頁面 (FDR/analysis.html) 發送的資料請求
        window.addEventListener('message', (event) => {
            if (event.data && event.data.type === 'REQUEST_MISSION_DATA') {
                if (window.latestGpxString) {
                    event.source.postMessage({
                        type: 'DELIVER_MISSION_DATA',
                        gpx: window.latestGpxString,
                        threat: window.latestThreatData,
                        viewshedImage: window.latestViewshedImage,
                        restrictedAreas: window.latestRestrictedAreas,
                        uasAreas: window.latestUasAreas,
                        powerLines: window.latestPowerLines
                    }, '*');
                }
            }
        });

        // --- 9. 防空隱蔽分析 (Viewshed Analysis) ---
        let isPlacingMissile = false;
        let lastMissileLatLng = null;
        const btnMissile = document.getElementById('btn-missile');

        // 監聽參數變更，即時重新計算
        document.getElementById('missile-range').onchange = () => { if (lastMissileLatLng) calculateViewshed(lastMissileLatLng); };
        document.getElementById('missile-alt').onchange = () => { if (lastMissileLatLng) calculateViewshed(lastMissileLatLng); };

        function adjustAlt(delta) {
            const el = document.getElementById('missile-alt');
            let val = parseInt(el.value) || 0;
            val += delta;
            if (val < 0) val = 0;
            el.value = val;
            if (lastMissileLatLng) calculateViewshed(lastMissileLatLng);
        }

        function adjustRange(delta) {
            const el = document.getElementById('missile-range');
            let val = parseFloat(el.value) || 0;
            val += delta;
            if (val < 1) val = 1; // 最小範圍限制為 1 NM
            el.value = val;
            if (lastMissileLatLng) calculateViewshed(lastMissileLatLng);
        }

        function adjustAirspeed(delta) {
            const el = document.getElementById('airspeed');
            let val = parseFloat(el.value) || 0;
            val += delta;
            if (val < 1) val = 1;
            el.value = val;
            updatePlan();
        }

        function adjustFuel(delta) {
            const el = document.getElementById('fuelBurn');
            let val = parseFloat(el.value) || 0;
            val += delta;
            if (val < 0) val = 0;
            el.value = val;
            updatePlan();
        }

        function adjustMsaHeight(delta) {
            const el = document.getElementById('msaHeight');
            let val = parseFloat(el.value) || 0;
            val += delta;
            if (val < 0) val = 0;
            el.value = val;
            updateMsaLayer();
        }

        function adjustMsaWarning(delta) {
            const el = document.getElementById('msaWarningOffset');
            let val = parseFloat(el.value) || 0;
            val += delta;
            if (val < 0) val = 0;
            el.value = val;
            updateMsaLayer();
        }

        btnMissile.onclick = () => {
            isPlacingMissile = !isPlacingMissile;
            btnMissile.style.background = isPlacingMissile ? "#ff0000" : "#d63384";
            btnMissile.innerText = isPlacingMissile ? "📍 點擊地圖" : "🚀 部署飛彈";
            map.getContainer().style.cursor = isPlacingMissile ? "crosshair" : "";
        };

        map.on('click', async (e) => {
            if (!isPlacingMissile) return;
            isPlacingMissile = false;
            btnMissile.style.background = "#d63384";
            btnMissile.innerText = "🚀 部署飛彈";
            map.getContainer().style.cursor = "";

            // 確保圖層已開啟
            if (!map.hasLayer(missileLayer)) {
                map.addLayer(missileLayer);
            }

            await calculateViewshed(e.latlng);
        });

        async function calculateViewshed(latlng) {
            lastMissileLatLng = latlng;
            const rangeNm = parseFloat(document.getElementById('missile-range').value) || 20;
            const targetAltFt = parseFloat(document.getElementById('missile-alt').value) || 500;
            const rangeKm = rangeNm * 1.852;

            document.getElementById('calc-indicator').style.display = 'block';
            missileLayer.clearLayers();

            // 1. 標示飛彈位置與範圍
            L.marker(latlng, { icon: L.divIcon({ className: 'missile-icon', html: '🚀', iconSize: [40, 40], iconAnchor: [20, 20] }) }).addTo(missileLayer);
            L.circle(latlng, { radius: rangeKm * 1000, color: '#FF0000', dashArray: '5, 10', fill: false }).addTo(missileLayer);

            // 2. 取得地形資料 (使用 Zoom 10 的瓦片，範圍涵蓋半徑)
            // 簡易計算：1度約111km。Zoom 10 瓦片約 0.35度寬。
            const z = 10;
            const centerTile = getTileXYZ(latlng.lat, latlng.lng, z);
            const buffer = 2; // 下載周圍 5x5 瓦片以確保覆蓋
            const tiles = [];

            // 建立 Canvas 繪製地形高度圖
            const canvas = document.createElement('canvas');
            const tileSize = 256;
            canvas.width = tileSize * (buffer * 2 + 1);
            canvas.height = tileSize * (buffer * 2 + 1);
            const ctx = canvas.getContext('2d');

            const promises = [];
            for (let x = centerTile.x - buffer; x <= centerTile.x + buffer; x++) {
                for (let y = centerTile.y - buffer; y <= centerTile.y + buffer; y++) {
                    const p = new Promise((resolve) => {
                        const img = new Image();
                        img.crossOrigin = "Anonymous";
                        img.src = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
                        img.onload = () => {
                            ctx.drawImage(img, (x - (centerTile.x - buffer)) * tileSize, (y - (centerTile.y - buffer)) * tileSize);
                            resolve();
                        };
                        img.onerror = resolve; // 忽略錯誤
                    });
                    promises.push(p);
                }
            }
            await Promise.all(promises);

            // 3. 進行視域分析 (Ray Casting)
            const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const data = imgData.data;

            // 中心點像素座標
            const tilePos = getTileFraction(latlng.lng, latlng.lat, z);
            const cx = buffer * tileSize + (tilePos.x % 1) * tileSize;
            const cy = buffer * tileSize + (tilePos.y % 1) * tileSize;

            // 取得中心點(飛彈)高度
            const idx = (Math.floor(cy) * canvas.width + Math.floor(cx)) * 4;
            const missileElev = (data[idx] * 256 + data[idx + 1] + data[idx + 2] / 256) - 32768;
            const targetAltM = targetAltFt * 0.3048; // 換算公尺
            const rangeM = rangeKm * 1000; // 雷達最大偵測距離(斜距)，換算成公尺
            // 雷達本身的最大偵測距離(斜距)決定了立體範圍能拉多高：正上方最多只能偵測到
            // missileElev + rangeM 的高度，不可能超過雷達的最大射程
            const ceilingAltM = missileElev + rangeM;
            const numAltSlices = 10; // 立體圓頂用幾層高度切片堆疊出來，越多越平滑但資料量越大

            // --- [精準優化] 計算該緯度下的實際每像素公尺數 (Web Mercator) ---
            const earthCircumference = 40075016.686; // 赤道周長 (公尺)
            const metersPerPixel = (earthCircumference * Math.cos(latlng.lat * Math.PI / 180)) / Math.pow(2, z + 8);

            // 根據精準公尺數，計算涵蓋半徑所需的最大像素數量
            const maxDistPx = rangeM / metersPerPixel;

            // --- 使用 Web Worker 進行計算以避免凍結主線程 ---
            const workerCode = `
                self.onmessage = function(e) {
                    const { buffer, width, height, cx, cy, missileElev, targetAltM, maxDistPx, metersPerPixel, ceilingAltM, numAltSlices, rangeM } = e.data;
                    const data = new Uint8ClampedArray(buffer);
                    const outData = new Uint8ClampedArray(width * height * 4); // 預設全部為透明(0)

                    const angleStep = 0.25;
                    const angleCount = Math.round(360 / angleStep);
                    // 每個角度「最遠可偵測到的像素距離」(0 = 這個方向完全偵測不到)，
                    // 這是沿著同一條掃描線順便記錄下來的，不用另外重算，用來畫出平滑邊緣的可偵測範圍多邊形
                    const boundaryR = new Float32Array(angleCount);

                    // 雷達的最大偵測距離(rangeM)是「斜距」，不是單純的水平距離：真正的偵測範圍(排除地形前)
                    // 是以飛彈為球心、rangeM 為半徑的球體。目標跟飛彈的高度差(dAlt)越大，該高度能達到的
                    // 水平距離就必須越小(勾股定理: 水平距離 <= sqrt(rangeM^2 - dAlt^2))，離飛彈高度剛好
                    // rangeM 時，水平距離降到 0。這樣疊出來的立體範圍才會是球狀圓頂，而不是同一個水平半徑
                    // 從頭到尾往上拉伸的柱狀體。
                    function maxHorizPxAtAlt(altM) {
                        const dAlt = altM - missileElev;
                        const remain = rangeM * rangeM - dAlt * dAlt;
                        return remain > 0 ? Math.sqrt(remain) / metersPerPixel : 0;
                    }
                    const maxHorizPxTarget = maxHorizPxAtAlt(targetAltM);

                    // 高度切片：從設定高度到天花板均分成 numAltSlices 層，同一條掃描線一次算出
                    // 每一層的可偵測邊界，飛越高邊界通常越遠(地形遮蔽角固定、飛越高越容易超過)，
                    // 但同時受限於上面的球面水平距離上限；疊起來就會呈現隨高度展開、越接近天花板越窄的
                    // 球狀立體圓頂；某方向若連天花板都被地形擋住(或超出球面水平距離上限)，
                    // 該方向每一層的邊界會趨近 0，堆疊起來就是自然內凹的缺口
                    const sliceAltM = new Float32Array(numAltSlices);
                    const sliceMaxHorizPx = new Float32Array(numAltSlices);
                    for (let k = 0; k < numAltSlices; k++) {
                        sliceAltM[k] = targetAltM + (ceilingAltM - targetAltM) * (k / (numAltSlices - 1));
                        sliceMaxHorizPx[k] = maxHorizPxAtAlt(sliceAltM[k]);
                    }
                    const sliceBoundaryR = new Float32Array(angleCount * numAltSlices);
                    const sliceFarthest = new Float32Array(numAltSlices);

                    for (let ai = 0; ai < angleCount; ai++) {
                        const angle = ai * angleStep;
                        const rad = angle * Math.PI / 180;
                        const dx = Math.cos(rad); const dy = Math.sin(rad);
                        let maxSlope = -9999;
                        let farthestVisibleR = 0;
                        sliceFarthest.fill(0);

                        for (let r = 1; r < maxDistPx; r++) {
                            const px = Math.floor(cx + dx * r);
                            const py = Math.floor(cy + dy * r);
                            if (px < 0 || py < 0 || px >= width || py >= height) break;

                            const i = (py * width + px) * 4;
                            const terrainElev = (data[i] * 256 + data[i+1] + data[i+2] / 256) - 32768;

                            // [論文等級優化] 根據緯度精準計算當下像素的實際距離
                            const distM = r * metersPerPixel;
                            const curvatureDrop = (distM * distM) / 12742000; // 地球曲率修正
                            const effectiveTerrainElev = terrainElev - curvatureDrop;

                            const slope = (effectiveTerrainElev - missileElev) / r;
                            if (slope > maxSlope) maxSlope = slope;

                            const targetSlope = (targetAltM - curvatureDrop - missileElev) / r;

                            if (targetSlope > maxSlope && targetAltM > terrainElev && r <= maxHorizPxTarget) {
                                outData[i] = 255;   // R
                                outData[i+1] = 0;   // G
                                outData[i+2] = 0;   // B
                                outData[i+3] = 100; // Alpha
                                farthestVisibleR = r;
                            }

                            for (let k = 0; k < numAltSlices; k++) {
                                const sAlt = sliceAltM[k];
                                const sSlope = (sAlt - curvatureDrop - missileElev) / r;
                                if (sSlope > maxSlope && sAlt > terrainElev && r <= sliceMaxHorizPx[k]) {
                                    sliceFarthest[k] = r;
                                }
                            }
                        }
                        boundaryR[ai] = farthestVisibleR;
                        for (let k = 0; k < numAltSlices; k++) sliceBoundaryR[ai * numAltSlices + k] = sliceFarthest[k];
                    }
                    // 將結果傳回主線程 (同樣使用記憶體轉移)
                    self.postMessage({ outBuffer: outData.buffer, boundaryR: Array.from(boundaryR), sliceBoundaryR: Array.from(sliceBoundaryR) }, [outData.buffer]);
                };
            `;

            const workerBlob = new Blob([workerCode], { type: 'application/javascript' });
            const workerUrl = URL.createObjectURL(workerBlob);
            const worker = new Worker(workerUrl);

            await new Promise((resolve) => {
                worker.onmessage = function (e) {
                    // 接收 Worker 計算完成的數據
                    const outImgData = new ImageData(new Uint8ClampedArray(e.data.outBuffer), canvas.width, canvas.height);
                    const outputCanvas = document.createElement('canvas');
                    outputCanvas.width = canvas.width; outputCanvas.height = canvas.height;
                    const outCtx = outputCanvas.getContext('2d');
                    outCtx.putImageData(outImgData, 0, 0);

                    const southWest = pointToLatLng(centerTile.x - buffer, centerTile.y + buffer + 1, z);
                    const northEast = pointToLatLng(centerTile.x + buffer + 1, centerTile.y - buffer, z);
                    const bounds = L.latLngBounds(southWest, northEast);

                    L.imageOverlay(outputCanvas.toDataURL(), bounds).addTo(missileLayer);

                    // 把每個角度算出的「最遠可偵測距離」轉成經緯度多邊形：跟掃描時同一個角度解析度，
                    // 取樣夠密(每1度一個頂點)所以邊緣是平滑的，不是網格/馬賽克，3D PVW 可以直接拿來拉伸成立體範圍
                    const boundaryR = e.data.boundaryR || [];
                    let viewshedPolygon = null;
                    if (boundaryR.length > 0) {
                        const angleStep = 360 / boundaryR.length;
                        const downsampleEvery = 4; // 0.25° * 4 = 每1度取一個頂點，360個頂點已經很平滑
                        const ring = [];
                        for (let ai = 0; ai < boundaryR.length; ai += downsampleEvery) {
                            const rad = (ai * angleStep) * Math.PI / 180;
                            const r = boundaryR[ai];
                            const px = cx + Math.cos(rad) * r;
                            const py = cy + Math.sin(rad) * r;
                            const tileX = (centerTile.x - buffer) + px / tileSize;
                            const tileY = (centerTile.y - buffer) + py / tileSize;
                            const ll = pointToLatLng(tileX, tileY, z);
                            ring.push([ll.lng, ll.lat]);
                        }
                        if (ring.length > 2) {
                            ring.push(ring[0]); // 封閉環
                            viewshedPolygon = ring;
                        }
                    }

                    // 把多層高度切片的邊界也轉成經緯度多邊形，由低到高疊起來，3D PVW 可以拉出
                    // 隨高度展開、缺口自然內凹的立體圓頂，而不是同一個平面形狀直接拉伸
                    const sliceBoundaryRFlat = e.data.sliceBoundaryR || [];
                    const polygonSlices = [];
                    if (sliceBoundaryRFlat.length > 0 && numAltSlices > 0) {
                        const totalAngles = sliceBoundaryRFlat.length / numAltSlices;
                        const sliceAngleStep = 360 / totalAngles;
                        const sliceDownsampleEvery = 8; // 每2度取一個頂點(多層堆疊，稍微降低單層密度以控制資料量)
                        for (let k = 0; k < numAltSlices; k++) {
                            const sAltM = targetAltM + (ceilingAltM - targetAltM) * (k / (numAltSlices - 1));
                            const ring = [];
                            for (let ai = 0; ai < totalAngles; ai += sliceDownsampleEvery) {
                                const rad = (ai * sliceAngleStep) * Math.PI / 180;
                                const r = sliceBoundaryRFlat[ai * numAltSlices + k];
                                const px = cx + Math.cos(rad) * r;
                                const py = cy + Math.sin(rad) * r;
                                const tileX = (centerTile.x - buffer) + px / tileSize;
                                const tileY = (centerTile.y - buffer) + py / tileSize;
                                const ll = pointToLatLng(tileX, tileY, z);
                                ring.push([ll.lng, ll.lat]);
                            }
                            if (ring.length > 2) {
                                ring.push(ring[0]); // 封閉環
                                polygonSlices.push({ altM: sAltM, ring: ring });
                            }
                        }
                    }

                    // 記錄這次計算結果(紅色遮罩圖+範圍+平滑多邊形+多層高度切片)，供 3D PVW 直接沿用
                    // 同一份計算結果，確保 2D/3D 呈現的雷達可偵測範圍完全一致(3D 端不再另外用簡化公式重算一次)
                    window.lastViewshedResult = {
                        dataUrl: outputCanvas.toDataURL(),
                        bounds: { south: southWest.lat, west: southWest.lng, north: northEast.lat, east: northEast.lng },
                        polygon: viewshedPolygon,
                        polygonSlices: polygonSlices, // 由低(設定高度)到高(雷達最大射程天花板)排列
                        missileElev: missileElev, // 飛彈(威脅源)所在地面高程(MSL公尺)
                        ceilingAltM: ceilingAltM
                    };
                    resolve();
                };

                // 將資料與 ArrayBuffer 的所有權轉移給 Worker 進行非同步計算
                worker.postMessage({
                    buffer: imgData.data.buffer,
                    width: canvas.width,
                    height: canvas.height,
                    cx: cx,
                    cy: cy,
                    missileElev: missileElev,
                    targetAltM: targetAltM,
                    maxDistPx: maxDistPx,
                    metersPerPixel: metersPerPixel,
                    ceilingAltM: ceilingAltM,
                    numAltSlices: numAltSlices,
                    rangeM: rangeM
                }, [imgData.data.buffer]);
            });

            // 清理資源
            worker.terminate();
            URL.revokeObjectURL(workerUrl);

            document.getElementById('calc-indicator').style.display = 'none';
        }

        // 輔助函式
        function getTileXYZ(lat, lng, z) {
            const n = Math.pow(2, z);
            const x = Math.floor((lng + 180) / 360 * n);
            const y = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
            return { x, y };
        }
        function pointToLatLng(x, y, z) {
            const n = Math.pow(2, z);
            const lng = x / n * 360 - 180;
            const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * 180 / Math.PI;
            return L.latLng(lat, lng);
        }
        function getTileFraction(lng, lat, z) {
            const n = Math.pow(2, z);
            const x = (lng + 180) / 360 * n;
            const y = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
            return { x: x, y: y };
        }
    

/* --- SCRIPT BLOCK SPLIT --- */


        // --- 計畫側邊欄邏輯 ---
        const planBtn = document.getElementById('plan-btn');
        const planPanel = document.getElementById('plan-panel');
        const planPanelClose = document.getElementById('plan-panel-close');
        const planPanelBody = document.getElementById('plan-panel-body');
        const btnConfirmPlan = document.getElementById('btn-confirm-plan');

        planBtn.onclick = () => {
            renderPlanPanel();
            planPanel.classList.add('active');
        };

        planPanelClose.onclick = () => {
            commitPlanChanges();
            planPanel.classList.remove('active');
        };

        function stepPlanValue(id, delta) {
            const el = document.getElementById(id);
            if (el) {
                let val = parseFloat(el.value);
                if (isNaN(val)) val = 0;
                let newVal = val + delta;
                if (newVal < 0) newVal = 0;
                el.value = newVal;
            }
        }

        function deleteWaypointAt(i) {
            if (i < 0 || i >= waypoints.length) return;
            const defaultTitle = i === 0 ? 'SP' : `ACP ${i}`;
            const name = (markers[i] && markers[i].customName) ? markers[i].customName : defaultTitle;
            if (!confirm(`確定要刪除航點「${name}」嗎？`)) return;

            map.removeLayer(markers[i]);
            waypoints.splice(i, 1);
            markers.splice(i, 1);
            updatePlan();
            if (isPowerLayerActive) loadPowerLines();
            renderPlanPanel();
        }

        function renderPlanPanel() {
            planPanelBody.innerHTML = '';
            if (waypoints.length === 0) {
                planPanelBody.innerHTML = '<p style="text-align:center; color:#ccc;">尚無航點</p>';
                return;
            }

            let html = '';

            waypoints.forEach((pt, i) => {
                let defaultTitle = i === 0 ? "SP" : `ACP ${i}`;
                let name = (markers[i] && markers[i].customName) ? markers[i].customName : defaultTitle;

                let sa = '';
                if (i < waypoints.length - 1 && segmentLabels[i] && segmentLabels[i].suggestedAltFt) {
                    sa = segmentLabels[i].suggestedAltFt;
                }

                let alt = (markers[i] && markers[i].customAlt) ? markers[i].customAlt : sa;
                let spd = (markers[i] && markers[i].customAirspeed) ? markers[i].customAirspeed : 120;
                let fuelRate = (markers[i] && markers[i].customFuelRate) ? markers[i].customFuelRate : 800;

                let t = "---", f = "---";
                const isLast = i === waypoints.length - 1;
                if (!isLast) {
                    const next = waypoints[i + 1];
                    const dist = turf.distance([pt.lng, pt.lat], [next.lng, next.lat], { units: 'nauticalmiles' });

                    let calcDist = dist;
                    if (i === 0) calcDist += 2;
                    if (i === waypoints.length - 2) calcDist += 2;

                    let currentK = spd ? parseFloat(spd) : 120;
                    const sec = Math.round((calcDist / currentK) * 3600);
                    const fuel = (sec / 3600) * parseFloat(fuelRate);

                    t = formatTime(sec);
                    f = fuel.toFixed(1);
                }

                html += `
                    <div class="plan-card">
                        <div class="plan-card-header">
                            <input type="text" id="plan-name-${i}" value="${name}" class="plan-name-input">
                            <button type="button" class="plan-delete-btn" onclick="deleteWaypointAt(${i})" title="刪除此航點">🗑</button>
                        </div>
                        <div class="plan-card-meta">
                            <span>⏱ ${t}</span>
                            <span>⛽ ${f} lb</span>
                        </div>
                        ${!isLast ? `
                        <div class="plan-card-field">
                            <label>高度(ft)</label>
                            <div class="stepper">
                                <button type="button" onclick="stepPlanValue('plan-alt-${i}', -100)">-</button>
                                <input type="number" id="plan-alt-${i}" value="${alt}">
                                <button type="button" onclick="stepPlanValue('plan-alt-${i}', 100)">+</button>
                            </div>
                        </div>
                        <div class="plan-card-field">
                            <label>空速(KT)</label>
                            <div class="stepper">
                                <button type="button" onclick="stepPlanValue('plan-spd-${i}', -5)">-</button>
                                <input type="number" id="plan-spd-${i}" value="${spd}">
                                <button type="button" onclick="stepPlanValue('plan-spd-${i}', 5)">+</button>
                            </div>
                        </div>
                        <div class="plan-card-field">
                            <label>耗油率(lb/h)</label>
                            <div class="stepper">
                                <button type="button" onclick="stepPlanValue('plan-fuelrate-${i}', -10)">-</button>
                                <input type="number" id="plan-fuelrate-${i}" value="${fuelRate}">
                                <button type="button" onclick="stepPlanValue('plan-fuelrate-${i}', 10)">+</button>
                            </div>
                        </div>` : `<div class="plan-card-endnote">終點（無後續航段）</div>`}
                    </div>
                `;
            });

            planPanelBody.innerHTML = html;
        }

        function commitPlanChanges() {
            waypoints.forEach((pt, i) => {
                if (!markers[i]) return;
                const nameInput = document.getElementById(`plan-name-${i}`);
                if (nameInput) markers[i].customName = nameInput.value;

                if (i < waypoints.length - 1) {
                    const altInput = document.getElementById(`plan-alt-${i}`);
                    const spdInput = document.getElementById(`plan-spd-${i}`);
                    const fuelRateInput = document.getElementById(`plan-fuelrate-${i}`);
                    if (altInput) markers[i].customAlt = altInput.value;
                    if (spdInput) markers[i].customAirspeed = spdInput.value;
                    if (fuelRateInput) markers[i].customFuelRate = fuelRateInput.value;
                }
            });
            updatePlan();
        }

        btnConfirmPlan.onclick = () => {
            commitPlanChanges();
            planPanel.classList.remove('active');
        };

        // --- AI 分析功能 ---
        const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
        const AI_KEY_STORAGE = 'amps_groq_api_key';

        // ↓↓↓ 在引號內填入您的 Groq API Key ↓↓↓
        const HARDCODED_API_KEY = '';
        // ↑↑↑ 在引號內填入您的 Groq API Key ↑↑↑

        const aiBtn = document.getElementById('ai-btn');
        const aiOverlay = document.getElementById('ai-modal-overlay');
        const aiClose = document.getElementById('ai-modal-close');
        const aiApiInput = document.getElementById('ai-api-key-input');
        const aiSaveCb = document.getElementById('ai-save-key-cb');
        const aiAnalyze = document.getElementById('ai-analyze-btn');
        const aiLoading = document.getElementById('ai-loading');
        const aiPlaceholder = document.getElementById('ai-placeholder');
        const aiResult = document.getElementById('ai-result');

        // 初始化 API Key：優先使用內寫金鑰，否則讀取 localStorage
        if (HARDCODED_API_KEY) {
            aiApiInput.value = HARDCODED_API_KEY;
            // 已內寫金鑰：只隱藏輸入欄列，按鈕仍然可見
            document.getElementById('ai-modal-api-row').style.display = 'none';
        } else {
            const savedKey = localStorage.getItem(AI_KEY_STORAGE);
            if (savedKey) { aiApiInput.value = savedKey; aiSaveCb.checked = true; }
        }

        aiBtn.onclick = () => aiOverlay.classList.add('active');
        aiClose.onclick = () => aiOverlay.classList.remove('active');
        aiOverlay.addEventListener('click', (e) => { if (e.target === aiOverlay) aiOverlay.classList.remove('active'); });

        aiSaveCb.onchange = () => {
            if (aiSaveCb.checked && aiApiInput.value) localStorage.setItem(AI_KEY_STORAGE, aiApiInput.value);
            else localStorage.removeItem(AI_KEY_STORAGE);
        };
        aiApiInput.oninput = () => { if (aiSaveCb.checked) localStorage.setItem(AI_KEY_STORAGE, aiApiInput.value); };

        async function buildFlightPlanText() {
            const taiwanAirspaces = [
                { name: "RCSS CTR (松山機場管制區)", poly: turf.circle([121.5525, 25.0697], 5, { units: 'nauticalmiles' }) },
                { name: "RCR11 (博愛特區禁航區)", poly: turf.circle([121.5119, 25.0397], 1, { units: 'nauticalmiles' }) },
                { name: "RCR14 (龍潭限航區)", poly: turf.circle([121.2400, 24.8500], 2, { units: 'nauticalmiles' }) }
            ];

            const k = 120;
            const totalDist = document.getElementById('totalDistance').textContent;
            const totalTime = document.getElementById('totalTime').textContent;
            const totalFuel = document.getElementById('totalFuel').textContent;
            const msaHeightEl = document.getElementById('msaHeight');
            const msaHeight = msaHeightEl ? msaHeightEl.value : 'N/A';

            let weatherInfo = "無法取得天氣資料";
            try {
                if (waypoints.length > 0) {
                    const startPt = waypoints[0];
                    const res = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${startPt.lat}&longitude=${startPt.lng}&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max&timezone=auto&forecast_days=2`);
                    if (res.ok) {
                        const wData = await res.json();
                        const tomorrow = wData.daily;
                        weatherInfo = `明日預報: 最高溫 ${tomorrow.temperature_2m_max[1]}°C, 最低溫 ${tomorrow.temperature_2m_min[1]}°C, 降水機率 ${tomorrow.precipitation_probability_max[1]}%, 最大風速 ${tomorrow.wind_speed_10m_max[1]} km/h`;
                    }
                }
            } catch (e) { console.error("天氣獲取失敗", e); }

            let wpLines = '';
            for (let i = 0; i < waypoints.length; i++) {
                const pt = waypoints[i];
                let defaultTitle = i === 0 ? 'SP' : `ACP ${i}`;
                const name = (markers[i] && markers[i].customName) ? markers[i].customName : defaultTitle;
                const elev = (markers[i] && markers[i].elevText) ? markers[i].elevText : '---';
                let seg = '';
                if (i < waypoints.length - 1) {
                    const next = waypoints[i + 1];
                    const d = turf.distance([pt.lng, pt.lat], [next.lng, next.lat], { units: 'nauticalmiles' });
                    const b = (turf.bearing([pt.lng, pt.lat], [next.lng, next.lat]) + 360) % 360;
                    let calcD = d;
                    if (i === 0) calcD += 2;
                    if (i === waypoints.length - 2) calcD += 2;
                    let currentK = (markers[i] && markers[i].customAirspeed) ? parseFloat(markers[i].customAirspeed) : (k || 120);
                    let currentFuelRate = (markers[i] && markers[i].customFuelRate) ? parseFloat(markers[i].customFuelRate) : 800;
                    const s = Math.round((calcD / currentK) * 3600);
                    const segFuel = ((s / 3600) * currentFuelRate).toFixed(1);

                    let maxElevFt = '未知';
                    if (typeof getCorridorMaxElevation === 'function') {
                        const maxElevM = await getCorridorMaxElevation(pt, next);
                        if (maxElevM !== -Infinity && maxElevM !== -1) {
                            maxElevFt = Math.round(maxElevM * 3.28084);
                        }
                    }

                    let intersectedAirspaces = [];
                    try {
                        const segmentLine = turf.lineString([[pt.lng, pt.lat], [next.lng, next.lat]]);
                        taiwanAirspaces.forEach(airspace => {
                            if (turf.booleanIntersects(segmentLine, airspace.poly)) {
                                intersectedAirspaces.push(airspace.name);
                            }
                        });
                    } catch (e) { console.error("空域交集計算失敗", e); }
                    const airspaceWarning = intersectedAirspaces.length > 0 ? ` / ⚠️ 穿越空域: ${intersectedAirspaces.join(", ")}` : '';

                    seg = ` → 下一段: 航向 ${b.toFixed(0)}° / ${d.toFixed(1)} NM / ${Math.floor(s / 60)}分${s % 60}秒 / 航段最高地形約 ${maxElevFt} ft${airspaceWarning} / 油耗 ${segFuel} lbs`;
                }
                const latStr = `${pt.lat >= 0 ? 'N' : 'S'}${Math.abs(pt.lat).toFixed(4)}`;
                const lngStr = `${pt.lng >= 0 ? 'E' : 'W'}${Math.abs(pt.lng).toFixed(4)}`;
                wpLines += `  ${name}: ${latStr} ${lngStr}, 地面標高 ${elev} ft${seg}\n`;
            }

            return [
                `【飛行計畫摘要】`,
                `航點數: ${waypoints.length}`,
                `飛行空速: ${k} 節`,
                `燃油消耗率: ${f} lbs/hr`,
                `設定飛行高度 (MSA): ${msaHeight} ft`,
                `天氣資訊: ${weatherInfo}`,
                ``,
                `【航點清單（含地形高度與各段數據）】`,
                wpLines,
                `【總計】`,
                `總航程: ${totalDist}`,
                `總航時: ${totalTime}`,
                `總油耗: ${totalFuel}`,
            ].join('\n');
        }

        function renderMarkdownLike(text) {
            return text
                .replace(/^### (.+)$/gm, '<h3>$1</h3>')
                .replace(/^## (.+)$/gm, '<h3>$1</h3>')
                .replace(/^# (.+)$/gm, '<h3>$1</h3>')
                .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
                .replace(/^[\*\-] (.+)$/gm, '<li>$1</li>')
                .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
                .replace(/\n{2,}/g, '</p><p>')
                .replace(/\n/g, '<br>')
                .replace(/^/, '<p>').replace(/$/, '</p>')
                .replace(/<p><\/p>/g, '');
        }

        aiAnalyze.onclick = async () => {
            const apiKey = aiApiInput.value.trim();
            if (!apiKey) { alert('請輸入 Groq API Key'); return; }
            if (waypoints.length < 2) { alert('請先在地圖上設定至少兩個航點'); return; }

            aiPlaceholder.style.display = 'none';
            aiResult.innerHTML = '';
            aiLoading.style.display = 'block';
            aiAnalyze.disabled = true;

            const planText = await buildFlightPlanText();
            const prompt = `你是一位資深的直升機飛行安全官，熟悉台灣地形、空域、軍事飛行規程與航空安全。
請用繁體中文，針對以下飛行計畫進行全面的安全分析，並以清楚的章節格式（使用 ## 標題）輸出報告，包含：
1. 計畫摘要與整體評估 (包含天氣預報分析)
2. 各航段風險分析（請針對系統在各航段後方標註的「⚠️ 穿越空域」給出確切的飛安警告與無線電通訊建議。注意：請**完全依賴系統標註的空域**進行分析，**絕對不要憑空猜測或捏造系統未列出的空域**！）
3. 未來一日天氣影響評估（基於提供的天氣資訊，分析對飛行的潛在影響）
4. 油量安全評估（是否充裕，建議備用量）
5. 飛行前注意事項與總體建議

以下為飛行計畫資料：
\`\`\`
${planText}
\`\`\``;

            try {
                const res = await fetch(GROQ_API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: 'llama-3.3-70b-versatile',
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.7,
                        max_tokens: 2048
                    })
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error?.message || err.message || `HTTP ${res.status}`);
                }
                const data = await res.json();
                const text = data.choices?.[0]?.message?.content || '（AI 未返回內容）';

                const totalDist = document.getElementById('totalDistance').textContent;
                const totalTime = document.getElementById('totalTime').textContent;
                const totalFuel = document.getElementById('totalFuel').textContent;
                const k = document.getElementById('airspeed').value;

                aiResult.innerHTML = `
                    <div class="ai-plan-summary">
                        <div><div class="si-val">${waypoints.length}</div><div class="si-lbl">航點數</div></div>
                        <div><div class="si-val">${totalDist}</div><div class="si-lbl">總航程</div></div>
                        <div><div class="si-val">${totalTime}</div><div class="si-lbl">總航時</div></div>
                        <div><div class="si-val">${totalFuel}</div><div class="si-lbl">總油耗</div></div>
                        <div><div class="si-val">${k} kt</div><div class="si-lbl">飛行空速</div></div>
                        <div><div class="si-val">${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}</div><div class="si-lbl">分析時間</div></div>
                    </div>
                    <div class="ai-result-content">${renderMarkdownLike(text)}</div>
                `;
            } catch (err) {
                aiResult.innerHTML = `<p class="warn">❌ 分析失敗：${err.message}</p><p style="color:#567;font-size:0.85em;">請確認 API Key 是否正確，以及網路連線是否正常。</p>`;
            } finally {
                aiLoading.style.display = 'none';
                aiAnalyze.disabled = false;
            }
        };
    