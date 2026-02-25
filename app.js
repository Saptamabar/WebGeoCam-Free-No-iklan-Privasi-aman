// === Elemen DOM Utama ===
const els = {
    video: document.getElementById('cameraStream'),
    canvas: document.getElementById('canvas'),
    photoOutput: document.getElementById('photoOutput'),
    infoOverlay: document.getElementById('infoOverlay'),
    container: document.getElementById('cameraContainer'),
    
    controls: {
        capture: document.getElementById('captureBtn'),
        upload: document.getElementById('uploadBtn'),
        switchCam: document.getElementById('switchCamBtn'),
        retake: document.getElementById('retakeBtn'),
        download: document.getElementById('downloadBtn'),
        fileInput: document.getElementById('fileInput')
    },
    
    text: {
        coord: document.getElementById('coordText'),
        time: document.getElementById('timeText'),
        address: document.getElementById('addressText'),
        header: document.getElementById('locationHeader')
    }
};

// === Status Aplikasi Global ===
const state = {
    map: null,
    marker: null,
    stream: null,
    useFrontCamera: false,
    currentLocation: { lat: 0, lon: 0 }
};

// === FUNGSI UTILITAS ===

/** Format waktu saat ini menyesuaikan zona GMT lokal */
function getFormattedTime() {
    const now = new Date();
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    const dayName = days[now.getDay()];
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    
    let hours = now.getHours();
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    
    const offset = -now.getTimezoneOffset();
    const sign = offset >= 0 ? '+' : '-';
    const offsetHours = String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0');
    const offsetMins = String(Math.abs(offset) % 60).padStart(2, '0');
    
    return `${dayName}, ${dd}/${mm}/${yyyy} ${String(hours).padStart(2, '0')}:${minutes} ${ampm} GMT ${sign}${offsetHours}:${offsetMins}`;
}

/** Menghasilkan format ID Timestamp berdasar waktu OS */
function generateFilenameTimestamp() {
    const d = new Date();
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
}

/** Toggler UI Antara Mode Membidik dan Mode Preview */
function togglePreviewMode(isPreview) {
    els.video.style.display = isPreview ? 'none' : 'block';
    els.photoOutput.style.display = isPreview ? 'block' : 'none';
    els.infoOverlay.style.display = isPreview ? 'flex' : 'none';

    els.controls.capture.style.display = isPreview ? 'none' : 'flex';
    els.controls.upload.style.display = isPreview ? 'none' : 'flex';
    els.controls.switchCam.style.display = isPreview ? 'none' : 'flex';

    els.controls.retake.style.display = isPreview ? 'flex' : 'none';
    els.controls.download.style.display = isPreview ? 'flex' : 'none';
    
    if (isPreview) {
        els.text.time.innerText = getFormattedTime();
        // Paksa render map Leaflet ulang pasca blok CSS display: flex diaplikasikan
        setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 500);
    } else {
        els.controls.fileInput.value = "";
    }
}


// === FUNGSI KAMERA & LOKASI ===

/** Memulai aliran video perangkat dengan resolusi tertinggi */
async function startCamera() {
    if (state.stream) {
        state.stream.getTracks().forEach(track => track.stop());
    }
    
    const constraints = {
        video: {
            facingMode: state.useFrontCamera ? "user" : "environment",
            width: { ideal: 3840 }, 
            height: { ideal: 2160 }
        }
    };

    try {
        state.stream = await navigator.mediaDevices.getUserMedia(constraints);
        setupVideoFeed(state.stream);
    } catch (err) {
        console.warn("Gagal muat 4K/Kamera utama. Mencoba fallback default.", err);
        try {
            // Fallback kamera biasa
            state.stream = await navigator.mediaDevices.getUserMedia({ 
                video: { facingMode: state.useFrontCamera ? "user" : "environment" } 
            });
            setupVideoFeed(state.stream);
        } catch (e) {
            alert("Akses kamera ditolak atau tidak didukung pada browser ini.");
        }
    }
}

function setupVideoFeed(stream) {
    els.video.srcObject = stream;
    // Mirror gambar apabila memakai kamera selfie
    els.video.style.transform = state.useFrontCamera ? "scaleX(-1)" : "scaleX(1)";
}

/** Mengambil Lokasi GPS, Memperbarui Mini Map dan Reverse Geocoding */
function fetchGeolocationData() {
    if (!navigator.geolocation) {
        alert("Browser tidak mendukung Geolocation.");
        return;
    }

    navigator.geolocation.getCurrentPosition(async (position) => {
        const { latitude: lat, longitude: lon } = position.coords;
        state.currentLocation = { lat, lon };
        els.text.coord.innerText = `Lat ${lat.toFixed(7)}° Long ${lon.toFixed(7)}°`;

        updateLeafletMap(lat, lon);
        await performReverseGeocoding(lat, lon);

    }, (error) => {
        alert("Gagal membaca lokasi: " + error.message);
        els.text.address.innerText = "Akses lokasi ditolak atau GPS tertutup.";
    }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });
}

function updateLeafletMap(lat, lon) {
    const mapLayerUrl = 'https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}';
    
    if (!state.map) {
        state.map = L.map('miniMap', { zoomControl: false, attributionControl: false, zoomSnap: 0 }).setView([lat, lon], 17);
        L.tileLayer(mapLayerUrl, { subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], crossOrigin: true }).addTo(state.map);
        state.marker = L.marker([lat, lon]).addTo(state.map);
    } else {
        state.map.setView([lat, lon], 17);
        state.marker.setLatLng([lat, lon]);
    }
}

async function performReverseGeocoding(lat, lon) {
    try {
        const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1`);
        const data = await response.json();

        if (data && data.display_name) {
            els.text.address.innerText = data.display_name;
            const addr = data.address || {};
            const title = addr.amenity || addr.building || addr.village || addr.suburb || addr.city_district || addr.county || "Lokasi Terkumpul";
            els.text.header.innerText = `${title}, ${addr.state || ''}`;
        } else {
            throw new Error("Address empty");
        }
    } catch (e) {
         els.text.address.innerText = "Detail alamat tidak dapat dimuat saat ini.";
         els.text.header.innerText = "Koordinat Terdeteksi";
    }
}


// === PEMROSESAN GAMBAR (PENGAMBILAN & CROP) ===

/** Memotong media secara dinamis seukuran bingkai (9:16) layar */
function processMediaToCanvas(mediaSource, isVideo = false) {
    const viewW = els.video.clientWidth || 1;
    const viewH = els.video.clientHeight || 1;
    const viewRatio = viewW / viewH;

    const sourceW = isVideo ? (els.video.videoWidth || 1) : (mediaSource.width || 1);
    const sourceH = isVideo ? (els.video.videoHeight || 1) : (mediaSource.height || 1);
    const sourceRatio = sourceW / sourceH;

    let targetW = sourceW, targetH = sourceH, drawX = 0, drawY = 0;

    if (sourceRatio > viewRatio) {
        targetW = sourceH * viewRatio;
        drawX = (sourceW - targetW) / 2;
    } else {
        targetH = sourceW / viewRatio;
        drawY = (sourceH - targetH) / 2;
    }

    els.canvas.width = targetW;
    els.canvas.height = targetH;
    const ctx = els.canvas.getContext('2d');

    if (isVideo && state.useFrontCamera) {
        ctx.translate(els.canvas.width, 0);
        ctx.scale(-1, 1);
    }

    ctx.drawImage(mediaSource, drawX, drawY, targetW, targetH, 0, 0, targetW, targetH);
    els.photoOutput.src = els.canvas.toDataURL('image/webp', 1.0);
    
    togglePreviewMode(true);
    fetchGeolocationData();
}

/** Mengekspor gabungan kamera & overlay peta menjadi satu gambar menggunakan html2canvas */
function generateAndDownloadImage() {
    const originalText = els.controls.download.innerHTML;
    els.controls.download.innerHTML = "⏳ Memproses...";
    els.controls.download.disabled = true;

    // Memastikan elemen tersusun dulu pasca delay
    setTimeout(() => {
        html2canvas(els.container, {
            useCORS: true, 
            allowTaint: true,
            scale: 2, // Resolusi HD ganda
            backgroundColor: null, 
            logging: false,
            scrollX: 0, scrollY: 0,
            windowWidth: document.documentElement.offsetWidth,
            windowHeight: document.documentElement.offsetHeight
        }).then(canvasOutput => {
            const link = document.createElement('a');
            link.download = `GeoCamera_${generateFilenameTimestamp()}.jpg`;
            link.href = canvasOutput.toDataURL('image/jpeg', 0.95);
            link.click();
        }).catch(err => {
            alert("Gagal memproses gambar. Coba lagi.\nError: " + err.message);
        }).finally(() => {
            els.controls.download.innerHTML = originalText;
            els.controls.download.disabled = false;
        });
    }, 1000); // 1 detik jeda untuk pastikan ubin Leaflet selesai diposisikan
}


// === EVENT LISTENERS ===

els.controls.switchCam.addEventListener('click', () => {
    state.useFrontCamera = !state.useFrontCamera;
    startCamera();
});

els.controls.capture.addEventListener('click', () => processMediaToCanvas(els.video, true));

els.controls.upload.addEventListener('click', () => els.controls.fileInput.click());
els.controls.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
            const img = new Image();
            img.onload = () => processMediaToCanvas(img, false);
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }
});

els.controls.retake.addEventListener('click', () => {
    startCamera();
    togglePreviewMode(false);
});

els.controls.download.addEventListener('click', generateAndDownloadImage);


// === INISIALISASI ===
window.addEventListener('DOMContentLoaded', startCamera);
