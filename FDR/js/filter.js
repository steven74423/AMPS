/**
 * FDR-Alpha Advanced Algorithms
 * Kalman Filter & Rotorcraft Optimization
 */

/**
 * Kinematic 2D Kalman Filter
 * Predicts based on Ground Speed & Heading, corrects with GPS coordinates.
 */
class KinematicKalmanFilter {
    constructor(processNoise = 0.00001, measurementNoise = 0.0001, initialLat, initialLon) {
        this.q = processNoise; // Confidence in kinematic prediction
        this.r = measurementNoise; // Confidence in GPS measurement
        this.pLat = 1;
        this.pLon = 1;
        this.lat = initialLat;
        this.lon = initialLon;
        this.R_EARTH = 6371000; // Earth radius in meters
    }

    update(gpsLat, gpsLon, speedKts, headingDeg, dtSec = 1) {
        if (this.lat === undefined || this.lon === undefined) {
            this.lat = gpsLat;
            this.lon = gpsLon;
            return { lat: this.lat, lon: this.lon };
        }

        // 1. PREDICTION STEP (Physical Kinematics based on GS & Heading)
        const speedMs = speedKts / 1.94384;
        const headingRad = headingDeg * (Math.PI / 180);
        const distMeters = speedMs * dtSec;

        const dLat = (distMeters * Math.cos(headingRad)) / this.R_EARTH * (180 / Math.PI);
        const dLon = (distMeters * Math.sin(headingRad)) / (this.R_EARTH * Math.cos(this.lat * Math.PI / 180)) * (180 / Math.PI);

        let predLat = this.lat + dLat;
        let predLon = this.lon + dLon;

        this.pLat += this.q;
        this.pLon += this.q;

        // 2. CORRECTION STEP (Weighted average with actual GPS reading)
        const kLat = this.pLat / (this.pLat + this.r);
        const kLon = this.pLon / (this.pLon + this.r);

        this.lat = predLat + kLat * (gpsLat - predLat);
        this.lon = predLon + kLon * (gpsLon - predLon);

        this.pLat = (1 - kLat) * this.pLat;
        this.pLon = (1 - kLon) * this.pLon;

        return { lat: this.lat, lon: this.lon };
    }
}

/**
 * Rotorcraft Optimization: Deadband Logic
 * Freezes coordinates if speed < 3 knots AND distance change < 5m
 */
function applyRotorcraftDeadband(points, speedThreshold = 3, distThreshold = 5) {
    if (points.length < 2) return points;

    let optimizedPoints = [points[0]];
    let lastAnchor = points[0];

    for (let i = 1; i < points.length; i++) {
        const pt = points[i];
        const dist = calculateDistance(lastAnchor.lat, lastAnchor.lon, pt.lat, pt.lon);
        
        if (pt.speed < speedThreshold && dist < distThreshold) {
            // Hover detected - Keep anchor coordinates but update time
            optimizedPoints.push({
                ...pt,
                lat: lastAnchor.lat,
                lon: lastAnchor.lon,
                isHover: true
            });
        } else {
            optimizedPoints.push(pt);
            lastAnchor = pt;
        }
    }
    return optimizedPoints;
}

/**
 * WGS84 to MSL Conversion (Simplified)
 * MSL = H - N (H = Ellipsoid Height, N = Geoid Undulation)
 * Uses a coarse EGM96 approximation.
 */
function convertToMSL(lat, lon, wgs84Alt) {
    // In a real military app, we'd use a 1x1 degree EGM96 grid.
    // For this prototype, we'll use a simplified approximation or 
    // leave room for a grid lookup.
    const geoidUndulation = -30; // Placeholder for Taiwan area (approx -20 to -40m)
    return wgs84Alt - (geoidUndulation * 3.28084); // Convert meters to feet
}

function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
