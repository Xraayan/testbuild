/**
 * Hardware Diagnostics - Device Testing Tool
 * Version 1.0.0
 */

// ============================================
// Global State
// ============================================

const state = {
    camera: {
        stream: null,
        active: false
    },
    microphone: {
        stream: null,
        audioContext: null,
        analyser: null,
        source: null,
        gainNode: null,
        mediaRecorder: null,
        recordedChunks: [],
        active: false,
        levelMonitorInterval: null
    },
    speaker: {
        audioContext: null
    }
};

// ============================================
// Initialization
// ============================================

document.addEventListener('DOMContentLoaded', () => {
    // Bind event listeners
    document.getElementById('cameraBtn').addEventListener('click', openCameraTest);
    document.getElementById('micBtn').addEventListener('click', openMicrophoneTest);
    document.getElementById('speakerBtn').addEventListener('click', openSpeakerTest);
    document.getElementById('captureBtn').addEventListener('click', capturePhoto);
    document.getElementById('startRecordBtn').addEventListener('click', toggleRecording);
    document.getElementById('playAudioBtn').addEventListener('click', playTestAudio);

    // Close modals on backdrop click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                closeAllModals();
            }
        });
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeAllModals();
        }
    });

    console.log('Hardware Diagnostics initialized');
});

// ============================================
// Camera Functions
// ============================================

async function openCameraTest() {
    const modal = document.getElementById('cameraModal');
    const video = document.getElementById('cameraFeed');
    const status = document.getElementById('cameraStatus');
    const indicator = document.getElementById('cameraStatusIndicator');

    modal.classList.add('show');
    updateStatus(status, indicator, 'Requesting camera access...', 'active');

    try {
        const constraints = {
            video: {
                width: { ideal: 1280 },
                height: { ideal: 720 },
                facingMode: 'user'
            },
            audio: false
        };

        state.camera.stream = await navigator.mediaDevices.getUserMedia(constraints);
        video.srcObject = state.camera.stream;
        state.camera.active = true;

        updateStatus(status, indicator, 'Camera is operational', 'success');
    } catch (error) {
        console.error('Camera error:', error);
        state.camera.active = false;

        if (error.name === 'NotAllowedError') {
            updateStatus(status, indicator, 'Permission denied. Please allow camera access in browser settings.', 'error');
        } else if (error.name === 'NotFoundError') {
            updateStatus(status, indicator, 'No camera detected. Please connect a camera device.', 'error');
        } else {
            updateStatus(status, indicator, `Camera error: ${error.message}`, 'error');
        }
    }
}

function closeCameraModal() {
    const modal = document.getElementById('cameraModal');
    modal.classList.remove('show');

    if (state.camera.stream) {
        state.camera.stream.getTracks().forEach(track => track.stop());
        state.camera.stream = null;
        state.camera.active = false;
    }
}

function capturePhoto() {
    if (!state.camera.active) return;

    const video = document.getElementById('cameraFeed');
    const canvas = document.getElementById('captureCanvas');
    const ctx = canvas.getContext('2d');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(blob => {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `capture_${timestamp}.png`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }, 'image/png');
}

// ============================================
// Microphone Functions
// ============================================

async function openMicrophoneTest() {
    const modal = document.getElementById('micModal');
    const status = document.getElementById('micStatus');
    const indicator = document.getElementById('micStatusIndicator');
    const recordBtn = document.getElementById('startRecordBtn');

    modal.classList.add('show');
    updateStatus(status, indicator, 'Requesting microphone access...', 'active');

    try {
        const constraints = {
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        };

        state.microphone.stream = await navigator.mediaDevices.getUserMedia(constraints);

        // Initialize audio context
        if (!state.microphone.audioContext) {
            state.microphone.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        state.microphone.source = state.microphone.audioContext.createMediaStreamSource(state.microphone.stream);
        state.microphone.analyser = state.microphone.audioContext.createAnalyser();
        state.microphone.analyser.fftSize = 2048;

        // Create gain node for real-time audio output
        state.microphone.gainNode = state.microphone.audioContext.createGain();
        state.microphone.gainNode.gain.value = 0.8;

        // Connect nodes: source -> analyser -> gain -> destination (speakers)
        state.microphone.source.connect(state.microphone.analyser);
        state.microphone.analyser.connect(state.microphone.gainNode);
        state.microphone.gainNode.connect(state.microphone.audioContext.destination);

        state.microphone.active = true;
        recordBtn.disabled = false;

        updateStatus(status, indicator, 'Microphone is operational. Audio passthrough enabled.', 'success');

        // Start visualizations
        startAudioVisualization();
        startLevelMeter();

    } catch (error) {
        console.error('Microphone error:', error);
        state.microphone.active = false;
        recordBtn.disabled = true;

        if (error.name === 'NotAllowedError') {
            updateStatus(status, indicator, 'Permission denied. Please allow microphone access in browser settings.', 'error');
        } else if (error.name === 'NotFoundError') {
            updateStatus(status, indicator, 'No microphone detected. Please connect an audio input device.', 'error');
        } else {
            updateStatus(status, indicator, `Microphone error: ${error.message}`, 'error');
        }
    }
}

function closeMicModal() {
    const modal = document.getElementById('micModal');
    modal.classList.remove('show');

    // Stop recording if active
    if (state.microphone.mediaRecorder && state.microphone.mediaRecorder.state === 'recording') {
        state.microphone.mediaRecorder.stop();
    }

    // Clear level monitor
    if (state.microphone.levelMonitorInterval) {
        clearInterval(state.microphone.levelMonitorInterval);
        state.microphone.levelMonitorInterval = null;
    }

    // Disconnect audio nodes
    if (state.microphone.gainNode) {
        state.microphone.gainNode.disconnect();
    }

    // Stop stream
    if (state.microphone.stream) {
        state.microphone.stream.getTracks().forEach(track => track.stop());
        state.microphone.stream = null;
        state.microphone.active = false;
    }

    // Reset button state
    const recordBtn = document.getElementById('startRecordBtn');
    recordBtn.textContent = 'Start Recording';
    recordBtn.classList.remove('btn-danger');
    recordBtn.classList.add('btn-primary');
}

function toggleRecording() {
    const recordBtn = document.getElementById('startRecordBtn');
    const status = document.getElementById('micStatus');
    const indicator = document.getElementById('micStatusIndicator');

    if (!state.microphone.mediaRecorder) {
        // Start recording
        state.microphone.recordedChunks = [];
        state.microphone.mediaRecorder = new MediaRecorder(state.microphone.stream);

        state.microphone.mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                state.microphone.recordedChunks.push(event.data);
            }
        };

        state.microphone.mediaRecorder.onstop = () => {
            const blob = new Blob(state.microphone.recordedChunks, { type: 'audio/webm' });
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = `recording_${timestamp}.webm`;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

            recordBtn.textContent = 'Start Recording';
            recordBtn.classList.remove('btn-danger');
            recordBtn.classList.add('btn-primary');
            updateStatus(status, indicator, 'Recording saved successfully', 'success');
            state.microphone.mediaRecorder = null;
        };

        state.microphone.mediaRecorder.start();
        recordBtn.textContent = 'Stop Recording';
        recordBtn.classList.remove('btn-primary');
        recordBtn.classList.add('btn-danger');
        updateStatus(status, indicator, 'Recording in progress...', 'active');

    } else if (state.microphone.mediaRecorder.state === 'recording') {
        state.microphone.mediaRecorder.stop();
    }
}

function startAudioVisualization() {
    const canvas = document.getElementById('audioCanvas');
    const ctx = canvas.getContext('2d');
    const analyser = state.microphone.analyser;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    function draw() {
        if (!state.microphone.active) return;
        requestAnimationFrame(draw);

        analyser.getByteFrequencyData(dataArray);

        // Clear canvas
        ctx.fillStyle = '#f9fafb';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw frequency bars
        const barWidth = (canvas.width / bufferLength) * 4;
        let x = 0;

        for (let i = 0; i < bufferLength; i++) {
            const barHeight = (dataArray[i] / 255) * canvas.height * 0.9;

            // Gradient based on intensity
            const intensity = dataArray[i] / 255;
            const hue = 200 - intensity * 60; // Blue to cyan
            ctx.fillStyle = `hsla(${hue}, 70%, 50%, 0.8)`;
            
            ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
            x += barWidth;

            if (x > canvas.width) break;
        }
    }

    draw();
}

function startLevelMeter() {
    const analyser = state.microphone.analyser;
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const levelBar = document.getElementById('levelBar');

    state.microphone.levelMonitorInterval = setInterval(() => {
        if (!analyser) return;

        analyser.getByteFrequencyData(dataArray);
        const average = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
        const percentage = Math.min((average / 128) * 100, 100);

        levelBar.style.width = `${percentage}%`;

        // Color based on level
        if (percentage > 80) {
            levelBar.style.background = 'linear-gradient(90deg, #dc2626, #ef4444)';
        } else if (percentage > 50) {
            levelBar.style.background = 'linear-gradient(90deg, #d97706, #f59e0b)';
        } else {
            levelBar.style.background = 'linear-gradient(90deg, #059669, #10b981)';
        }
    }, 50);
}

// ============================================
// Speaker Functions
// ============================================

async function openSpeakerTest() {
    const modal = document.getElementById('speakerModal');
    const status = document.getElementById('speakerStatus');
    const indicator = document.getElementById('speakerStatusIndicator');

    modal.classList.add('show');

    try {
        if (!state.speaker.audioContext) {
            state.speaker.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        updateStatus(status, indicator, 'Speaker is ready for testing', 'success');
    } catch (error) {
        console.error('Speaker initialization error:', error);
        updateStatus(status, indicator, 'Audio context initialization warning', 'warning');
    }
}

function closeSpeakerModal() {
    const modal = document.getElementById('speakerModal');
    modal.classList.remove('show');
    
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
}

async function playTestAudio() {
    const status = document.getElementById('speakerStatus');
    const indicator = document.getElementById('speakerStatusIndicator');
    const playBtn = document.getElementById('playAudioBtn');

    try {
        playBtn.disabled = true;
        updateStatus(status, indicator, 'Playing audio...', 'active');

        // Use Web Speech API
        const utterance = new SpeechSynthesisUtterance('I am a robot');
        utterance.rate = 1;
        utterance.pitch = 1.5;
        utterance.volume = 1;

        // Get voices
        const voices = window.speechSynthesis.getVoices();
        if (voices.length > 0) {
            utterance.voice = voices[0];
        }

        utterance.onstart = () => {
            visualizeSpeaker();
        };

        utterance.onend = () => {
            updateStatus(status, indicator, 'Audio playback completed successfully', 'success');
            playBtn.disabled = false;
        };

        utterance.onerror = (error) => {
            updateStatus(status, indicator, `Speech synthesis error: ${error.error}`, 'error');
            playBtn.disabled = false;
        };

        window.speechSynthesis.speak(utterance);

    } catch (error) {
        console.error('Speaker error:', error);
        updateStatus(status, indicator, `Speaker error: ${error.message}`, 'error');
        playBtn.disabled = false;
    }
}

function visualizeSpeaker() {
    const canvas = document.getElementById('speakerCanvas');
    const ctx = canvas.getContext('2d');
    const startTime = Date.now();
    const duration = 2000;

    function animate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Clear canvas
        ctx.fillStyle = '#f9fafb';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Draw animated bars
        const barCount = 32;
        const barWidth = canvas.width / barCount;

        for (let i = 0; i < barCount; i++) {
            const x = i * barWidth;
            const wave = Math.sin((i / barCount + progress * 4) * Math.PI * 2);
            const random = Math.random() * 0.2;
            const height = (Math.abs(wave) * 0.6 + random) * (1 - progress * 0.3);
            const barHeight = height * canvas.height * 0.8;

            const hue = 160 + i * 2;
            ctx.fillStyle = `hsla(${hue}, 60%, 45%, 0.8)`;
            ctx.fillRect(x, canvas.height - barHeight, barWidth - 2, barHeight);
        }

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            // Final state
            ctx.fillStyle = '#f9fafb';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
        }
    }

    animate();
}

// ============================================
// Utility Functions
// ============================================

function updateStatus(statusElement, indicatorElement, message, type) {
    statusElement.textContent = message;
    
    // Remove all state classes
    indicatorElement.classList.remove('success', 'error', 'warning', 'active');
    
    // Add appropriate class
    if (type) {
        indicatorElement.classList.add(type);
    }
}

function closeAllModals() {
    closeCameraModal();
    closeMicModal();
    closeSpeakerModal();
}

// Clean up on page unload
window.addEventListener('beforeunload', () => {
    closeAllModals();
});
