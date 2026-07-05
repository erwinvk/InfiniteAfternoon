// Samples --> gainNode --> masterVolumeGainNode --> speakers
var startTime;

const deltaTimeWarp = 25000; // fast forward 25 s so no big silence at the start
//const minSineInterval = 3000; // test
//const maxSineInterval = 20000; // test
const minSineInterval = 16500;
const maxSineInterval = 65000;

const minPianoInterval = 22500;
const maxPianoInterval = 125000;

//const minSubInterval = 1000; // test
//const maxSubInterval = 6000; // test
const minSubInterval = 60000; // 1 minute
const maxSubInterval = 300000; // 5 minutes

//const minFXInterval = 2000;
//const maxFXInterval = 20000; 
const minFXInterval = 45000; 
const maxFXInterval = 900000; // 15 minutes

let randomSineIntervals = [];
let randomPianoIntervals = [];
let randomFxIntervals = [];

let isPlaying = false;
let audioContext;
let analyser;
let gainNode;
let masterVolumeGainNode;
let masterDelayGainNode;
let masterDelayFeedbackNode;
let masterDelayNode;
let sleepGainNode;
let nowPlaying = [];
let pendingTimeouts = new Set();
const bufferCache = new Map();

// every afternoon has a seed; the same seed in the url replays the same schedule
const seed = (function () {
    const param = new URLSearchParams(window.location.search).get('afternoon');
    if (param) {
        const parsed = parseInt(param, 36);
        if (!isNaN(parsed)) return parsed >>> 0;
    }
    return (Math.random() * 4294967296) >>> 0;
})();
let intervalRng;

function mulberry32(a) {
    return function () {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
}

function randomPanValue(rng) {
    return (Math.ceil(rng() * 99) * (rng() < 0.5 ? 1 : -1)) / 100;
}

const samplePathLoops = ['/audio/drone-loop-e2.mp3', '/audio/drone-loop-b2.mp3', '/audio/drone-loop-a2.mp3', '/audio/drone-loop-f2.mp3', '/audio/drone-loop-gsharp2.mp3', '/audio/drone-loop-d3.mp3'];
const samplePathsSines = ['/audio/sine-b4.mp3', '/audio/sine-d4.mp3', '/audio/sine-e4.mp3', '/audio/sine-f4.mp3', '/audio/sine-gsharp4.mp3', '/audio/sine-d5.mp3'];
const samplePathsPiano = ['/audio/piano-a2.mp3', '/audio/piano-b2.mp3', '/audio/piano-d2.mp3', '/audio/piano-e2.mp3', '/audio/piano-gsharp2.mp3'];
const samplePathsSubs = ['/audio/sub-e0.mp3', '/audio/sub-e0-2.mp3'];
const samplePathsFX = ['/audio/fx-birdlike.mp3', '/audio/fx-pizzi1.mp3', '/audio/fx-pizzi2.mp3', '/audio/fx-pizzi3.mp3', '/audio/fx-pizzi4.mp3', '/audio/fx-pizzi5.mp3'];

let loopYPositions = [];
loopYPositions.push({ name: 'd3', yval: '15%' });
loopYPositions.push({ name: 'b2', yval: '25%' });
loopYPositions.push({ name: 'a2', yval: '40%' });
loopYPositions.push({ name: 'gsharp2', yval: '55%' });
loopYPositions.push({ name: 'f2', yval: '70%' });
loopYPositions.push({ name: 'e2', yval: '85%' });

let sineDropYPositions = [];
sineDropYPositions.push({ name:'d5', yval: '10%' });
sineDropYPositions.push({ name: 'b4', yval: '25%' });
sineDropYPositions.push({ name: 'gsharp4', yval:'35%' });
sineDropYPositions.push({ name: 'f4', yval: '45%' });
sineDropYPositions.push({ name: 'e4', yval: '55%' });
sineDropYPositions.push({ name: 'd4', yval: '65%' });

let pianoDropYPositions = [];
pianoDropYPositions.push({ name: 'pb2', yval: '80%' });
pianoDropYPositions.push({ name: 'pa2', yval: '83%' });
pianoDropYPositions.push({ name: 'pgsharp2', yval: '85%' });
pianoDropYPositions.push({ name: 'pd2', yval: '90%' });
pianoDropYPositions.push({ name: 'pe2', yval: '95%' });
pianoDropYPositions.push({ name: 'pf2', yval: '98%' });

$('#volumecontrol').on('input', function () {
    var volval = parseInt($(this).val()) / 100;
    masterVolumeGainNode.gain.value = volval;
});

//startCtxBtn.addEventListener('click', () => {
$('#start').on('click', function () {
    if ($(this).hasClass('pause')) {
        gainNode.gain.exponentialRampToValueAtTime(1, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 2);

        for (const pendingTimeout of pendingTimeouts) {
            clearTimeout(pendingTimeout);
        }
        pendingTimeouts.clear();
        console.log('Intervals cleared');

        setTimeout(function () {
            for (let i = 0; i < nowPlaying.length; i++) {
                nowPlaying[i].stop()
            }

            nowPlaying = [];
        }, 2000);
        $(this).removeClass('pause')
        console.log('samples stopped');
        isPlaying = false;
        clearSleepTimer(true);
        stopEnergyAnimation();
        updateMediaSession(false);
        return false;
    }

    // build the audio graph once; on resume we reuse the context and cached buffers
    if (!audioContext) {
        audioContext = new AudioContext();
        masterVolumeGainNode = audioContext.createGain();
        masterVolumeGainNode.gain.value = parseInt($('#volumecontrol').val()) / 100;

        // sleep timer fades this separate node, so the volume slider stays untouched
        sleepGainNode = audioContext.createGain();
        masterVolumeGainNode.connect(sleepGainNode);
        sleepGainNode.connect(audioContext.destination);

        // tap for the audio-reactive visuals
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.85;
        sleepGainNode.connect(analyser);

        gainNode = audioContext.createGain();
        gainNode.connect(masterVolumeGainNode);

        masterDelayFeedbackNode = audioContext.createGain();
        masterDelayFeedbackNode.gain.value = 0.3;

        var biquadFilter = audioContext.createBiquadFilter();
        biquadFilter.type = 'lowpass';
        biquadFilter.frequency.value = 600;
        //biquadFilter.Q.value = 20;

        masterDelayNode = audioContext.createDelay(3);
        masterDelayNode.delayTime.value = 1.4;
        masterDelayNode.connect(biquadFilter);
        biquadFilter.connect(masterDelayFeedbackNode);
        masterDelayFeedbackNode.connect(masterDelayNode);
        masterDelayFeedbackNode.connect(gainNode);

        console.log('audiocontext started...');
    }

    randomSineIntervals = [];
    randomPianoIntervals = [];
    randomFxIntervals = [];

    // draw the whole schedule up front from the seeded rng, so the same seed
    // always produces the same afternoon regardless of sample load order
    intervalRng = mulberry32(seed);
    history.replaceState(null, '', '?afternoon=' + seed.toString(36));

    const sineIntervals = samplePathsSines.map(function () { return randomIntFromInterval(minSineInterval, maxSineInterval, 'sine'); });
    const pianoIntervals = samplePathsPiano.map(function () { return randomIntFromInterval(minPianoInterval, maxPianoInterval, 'piano'); });
    const subInterval = randomIntFromInterval(minSubInterval, maxSubInterval, 'sub');
    const fxIntervals = samplePathsFX.map(function () { return randomIntFromInterval(minFXInterval, maxFXInterval, 'fx'); });

    $(this).addClass('pause');

    // Loads and play loops
    setupSamples(samplePathLoops).then((response) => {
        var interval = 14000;

        for (var i = 0; i < response.length; i++) {
            (function (i, interval) {
                customInterval(function () {
                    playSample(response[i], 0, false);
                    showBaseNote(samplePathLoops[i]);
                }, interval, true, 13500);
            })(i, interval);
            interval += 7700;
        }

        console.log('initing loop ' + i);

        //fade them in
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(1, audioContext.currentTime + 2);
    });

    // Sines
    setupSamples(samplePathsSines).then((response) => {
        for (var i = 0; i < response.length; i++) {
            (function (i) {
                const noteRng = mulberry32(seed + 1000 + i);
                customInterval(function () {
                    var randomPan = randomPanValue(noteRng);
                    playSample(response[i], 0, false, randomPan);
                    showDrop(samplePathsSines[i], (randomPan + 1) * 50, 'sine');
                }, sineIntervals[i], true)
            })(i);

            console.log('initing note ' + i + ' on interval ' + sineIntervals[i]);
        }
    });

    // Piano
    setupSamples(samplePathsPiano).then((response) => {
        for (var i = 0; i < response.length; i++) {
            (function (i) {
                const noteRng = mulberry32(seed + 2000 + i);
                customInterval(function () {
                    var randomPan = randomPanValue(noteRng);
                    playSample(response[i], 0, false, randomPan);
                    showDrop(samplePathsPiano[i], (randomPan + 1) * 50, 'piano');
                }, pianoIntervals[i], true)
            })(i);

            console.log('initing note ' + i + ' on interval ' + pianoIntervals[i]);
        }
    });

    // subs. Don't want these possibly looping over another, so pick a random interval and at that interval play one of the subs.
    setupSamples(samplePathsSubs).then((response) => {
        const subRng = mulberry32(seed + 3000);

        customInterval(function () {
            //pick a random sub sample
            var randomSampleNumber = Math.floor(subRng() * response.length);

            playSample(response[randomSampleNumber], 0, false);
        }, subInterval);
    });

    // FX
    setupSamples(samplePathsFX).then((response) => {
        for (var i = 0; i < response.length; i++) {
            (function (i) {
                const noteRng = mulberry32(seed + 4000 + i);
                customInterval(function () {
                    var randomPan = randomPanValue(noteRng);
                    playSample(response[i], 0, false, randomPan);
                    console.log('now playing FX ' + fxIntervals[i]);
                }, fxIntervals[i], true)
            })(i);

            console.log('initing note ' + i + ' on interval ' + fxIntervals[i]);
        }
    });

    // set start time
    isPlaying = true;
    startTime = new Date();
    updateMediaSession(true);
    startEnergyAnimation();
    displayTimeElapsed();
});

function updateMediaSession(playing) {
    if (!('mediaSession' in navigator)) return;

    if (!navigator.mediaSession.metadata) {
        navigator.mediaSession.metadata = new MediaMetadata({
            title: 'Infinite Afternoon',
            artist: 'Erwin van Kester',
            album: 'infiniteafternoon.com',
            artwork: [
                { src: '/img/icon-192.png', sizes: '192x192', type: 'image/png' },
                { src: '/img/icon-512.png', sizes: '512x512', type: 'image/png' }
            ]
        });
        navigator.mediaSession.setActionHandler('play', function () { if (!isPlaying) $('#start').trigger('click'); });
        navigator.mediaSession.setActionHandler('pause', function () { if (isPlaying) $('#start').trigger('click'); });
        navigator.mediaSession.setActionHandler('stop', function () { if (isPlaying) $('#start').trigger('click'); });
    }

    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
}

// ---- sleep timer ----
const sleepChoices = [0, 30, 60, 90]; // minutes, 0 = off
const sleepFadeSeconds = 30;
let sleepChoiceIndex = 0;
let sleepTimeouts = [];

$('.sleeptimer').on('click', function () {
    sleepChoiceIndex = (sleepChoiceIndex + 1) % sleepChoices.length;
    armSleepTimer();
    return false;
});

function armSleepTimer() {
    clearSleepTimer(false);
    const minutes = sleepChoices[sleepChoiceIndex];

    if (minutes == 0) {
        $('.sleeptimer').text('timer').removeClass('armed');
        return;
    }

    $('.sleeptimer').text(minutes + 'm').addClass('armed');

    // fade out during the last sleepFadeSeconds, then pause
    sleepTimeouts.push(setTimeout(function () {
        if (!isPlaying || !sleepGainNode) return;
        sleepGainNode.gain.setValueAtTime(1, audioContext.currentTime);
        sleepGainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + sleepFadeSeconds);
    }, minutes * 60000 - sleepFadeSeconds * 1000));

    sleepTimeouts.push(setTimeout(function () {
        if (isPlaying) $('#start').trigger('click');
    }, minutes * 60000));
}

function clearSleepTimer(resetLabel) {
    for (const sleepTimeout of sleepTimeouts) {
        clearTimeout(sleepTimeout);
    }
    sleepTimeouts = [];

    if (sleepGainNode && audioContext) {
        const wasFaded = sleepGainNode.gain.value < 0.9;
        sleepGainNode.gain.cancelScheduledValues(audioContext.currentTime);
        // if the fade already kicked in, restore the gain after the 2s stop fade
        sleepGainNode.gain.setValueAtTime(1, audioContext.currentTime + (wasFaded ? 2.5 : 0));
    }

    if (resetLabel) {
        sleepChoiceIndex = 0;
        $('.sleeptimer').text('timer').removeClass('armed');
    }
}

// ---- audio-reactive visuals ----
let energyFrame;
let smoothedEnergy = 0;
const energyData = new Uint8Array(128);

function startEnergyAnimation() {
    cancelAnimationFrame(energyFrame);
    const noiseEl = document.querySelector('.noise');
    const titleEl = document.getElementById('titlecontainer');

    (function tick() {
        analyser.getByteFrequencyData(energyData);
        let sum = 0;
        for (let i = 0; i < energyData.length; i++) {
            sum += energyData[i];
        }
        const energy = sum / energyData.length / 255;
        smoothedEnergy += (energy - smoothedEnergy) * 0.05;

        noiseEl.style.opacity = Math.min(1, 0.45 + smoothedEnergy * 0.5);
        titleEl.style.opacity = Math.min(1, 0.7 + smoothedEnergy * 0.8);

        energyFrame = requestAnimationFrame(tick);
    })();
}

function stopEnergyAnimation() {
    cancelAnimationFrame(energyFrame);
    document.querySelector('.noise').style.opacity = '';
    document.getElementById('titlecontainer').style.opacity = '';
}

// ---- click to drop a note ----
$('.dropscanvas').on('click', function (e) {
    if (!isPlaying) return;

    setupSamples(samplePathsSines).then((response) => {
        // top-to-bottom bands mapped to notes high-to-low, like the scheduled drops
        const bandToSample = [5, 0, 4, 3, 2, 1]; // d5, b4, gsharp4, f4, e4, d4
        const yFraction = e.clientY / window.innerHeight;
        const sampleIndex = bandToSample[Math.min(5, Math.floor(yFraction * 6))];

        let pan = Math.max(-0.99, Math.min(0.99, (e.clientX / window.innerWidth) * 2 - 1));
        if (Math.abs(pan) < 0.02) pan = 0.02; // keep the panned (and delayed) signal path

        playSample(response[sampleIndex], 0, false, pan);
        showDrop(samplePathsSines[sampleIndex], (e.clientX / window.innerWidth) * 100, 'sine', (yFraction * 100) + '%');
    });
});

// ---- computer keyboard notes ----
const keyboardSineKeys = { 'a': 1, 's': 2, 'd': 3, 'f': 4, 'g': 0, 'h': 5 }; // d4 e4 f4 gsharp4 b4 d5
const keyboardPianoKeys = { 'z': 2, 'x': 3, 'c': 4, 'v': 0, 'b': 1 }; // d2 e2 gsharp2 a2 b2

$(document).on('keydown', function (e) {
    if (!isPlaying || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target && (e.target.tagName == 'INPUT' || e.target.tagName == 'TEXTAREA')) return;

    const key = e.key.toLowerCase();
    let paths, sampleIndex, type;

    if (key in keyboardSineKeys) {
        paths = samplePathsSines;
        sampleIndex = keyboardSineKeys[key];
        type = 'sine';
    } else if (key in keyboardPianoKeys) {
        paths = samplePathsPiano;
        sampleIndex = keyboardPianoKeys[key];
        type = 'piano';
    } else {
        return;
    }

    setupSamples(paths).then(function (response) {
        let pan = (Math.random() * 1.6) - 0.8;
        if (Math.abs(pan) < 0.02) pan = 0.02;
        playSample(response[sampleIndex], 0, false, pan);
        showDrop(paths[sampleIndex], (pan + 1) * 50, type);
    });
});

// ---- web midi ----
// root notes of the samples, so any midi note can be pitched from the nearest one
const sineRootNotes = [
    { index: 0, midi: 71 }, // b4
    { index: 1, midi: 62 }, // d4
    { index: 2, midi: 64 }, // e4
    { index: 3, midi: 65 }, // f4
    { index: 4, midi: 68 }, // gsharp4
    { index: 5, midi: 74 }  // d5
];
const pianoRootNotes = [
    { index: 0, midi: 45 }, // a2
    { index: 1, midi: 47 }, // b2
    { index: 2, midi: 38 }, // d2
    { index: 3, midi: 40 }, // e2
    { index: 4, midi: 44 }  // gsharp2
];

$('.midilink').on('click', function () {
    connectMidi();
    return false;
});

// reconnect silently when access was granted in an earlier visit
try {
    if (navigator.permissions && navigator.requestMIDIAccess) {
        navigator.permissions.query({ name: 'midi' }).then(function (status) {
            if (status.state == 'granted') connectMidi();
        }).catch(function () { });
    }
} catch (e) { }

function connectMidi() {
    if (!navigator.requestMIDIAccess) {
        $('.midilink').text('no midi');
        return;
    }

    navigator.requestMIDIAccess().then(function (access) {
        function attachInputs() {
            let inputCount = 0;
            access.inputs.forEach(function (input) {
                input.onmidimessage = onMidiMessage;
                inputCount++;
            });
            $('.midilink').text(inputCount > 0 ? 'midi ✓' : 'no midi').toggleClass('connected', inputCount > 0);
        }

        access.onstatechange = attachInputs;
        attachInputs();
    }, function () {
        $('.midilink').text('no midi');
    });
}

function onMidiMessage(message) {
    const command = message.data[0] & 0xf0;
    const note = message.data[1];
    const velocity = message.data[2];

    if (command == 0x90 && velocity > 0) {
        playMidiNote(note, velocity);
    }
}

function playMidiNote(noteNumber, velocity) {
    if (!isPlaying) return;

    const useLowSet = noteNumber < 55;
    const roots = useLowSet ? pianoRootNotes : sineRootNotes;
    const paths = useLowSet ? samplePathsPiano : samplePathsSines;

    let nearest = roots[0];
    for (const root of roots) {
        if (Math.abs(root.midi - noteNumber) < Math.abs(nearest.midi - noteNumber)) {
            nearest = root;
        }
    }

    setupSamples(paths).then(function (response) {
        const source = audioContext.createBufferSource();
        source.buffer = response[nearest.index];
        source.playbackRate.value = Math.pow(2, (noteNumber - nearest.midi) / 12);

        const velocityGain = audioContext.createGain();
        velocityGain.gain.value = velocity / 127;

        const panNode = audioContext.createStereoPanner();
        const pan = (Math.random() * 1.2) - 0.6;
        panNode.pan.value = pan;

        source.connect(velocityGain);
        velocityGain.connect(panNode);
        panNode.connect(gainNode);
        panNode.connect(masterDelayNode);
        source.start(0);

        // drop where the pitch sits: high notes near the top
        const yPercent = Math.max(5, Math.min(95, 100 - ((noteNumber - 30) / 60) * 100));
        showDrop(paths[nearest.index], (pan + 1) * 50, useLowSet ? 'piano' : 'sine', useLowSet ? undefined : yPercent + '%');
    });
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
        navigator.serviceWorker.register('/sw.js');
    });
}

$('#stop').on('click', function () {
    gainNode.gain.exponentialRampToValueAtTime(1, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 2);

    setTimeout(function () {
        for (let i = 0; i < nowPlaying.length; i++) {
            nowPlaying[i].stop()
        }
    }, 4000);
});

function customInterval(callback, interval, isFirst, customDelta) {
    // fast forward first loop... 
    let thisDeltaTimewarp = deltaTimeWarp;

    if (customDelta)
        thisDeltaTimewarp = customDelta;

    let tempInterval = interval;
    if (isFirst) {
        tempInterval -= thisDeltaTimewarp;
        // if the interval is now before our start, do original interval, minus the difference
        if (tempInterval < 0) {
            let delta = interval - thisDeltaTimewarp;
            tempInterval = (interval  - Math.abs(delta));
        }

        console.log('temp interval: ' + tempInterval + ' interval:' + interval);
    }
    
    var timeout = setTimeout(function () {
        pendingTimeouts.delete(timeout);
        if (isPlaying) {
            callback();
            customInterval(callback, interval, false);
        }
    }, Math.abs(tempInterval));

    pendingTimeouts.add(timeout);
}

async function getFile(path) {
    // decoded buffers are cached, so pause/resume does not re-download or re-decode
    if (bufferCache.has(path)) {
        return bufferCache.get(path);
    }

    const response = await fetch(path);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    console.log('loaded file: ' + path);
    bufferCache.set(path, audioBuffer);
    return audioBuffer;
}

function setupSamples(paths) {
    // load all samples of a group in parallel
    return Promise.all(paths.map(getFile));
}

function randomIntFromInterval(min, max, type, isDeep) {
    var randomNumber = Math.floor(intervalRng() * (max - min + 1) + min)

    if (type == 'sine') {
        // check if note is not too close to others
        for (let i = 0; i < randomSineIntervals.length; i++) {
            if (Math.abs(randomSineIntervals[i] - randomNumber) < 500) {
                console.log('rechoosing random... diff was ' + Math.abs(randomSineIntervals[i] - randomNumber));
                randomNumber = randomIntFromInterval(min, max, type, true);
            }
        }

        if (!isDeep)
            randomSineIntervals.push(randomNumber);
    }
    else if (type == 'piano') {
        // check if note is not too close to others
        for (let i = 0; i < randomPianoIntervals.length; i++) {
            if (Math.abs(randomPianoIntervals[i] - randomNumber) < 8000) {
                console.log('rechoosing random... diff was ' + Math.abs(randomPianoIntervals[i] - randomNumber));
                randomNumber = randomIntFromInterval(min, max, type, true);
            }
        }

        if (!isDeep)
            randomPianoIntervals.push(randomNumber);
    }
    else if (type == 'fx') {
        // want fx at least 10 seconds apart initially
        for (let i = 0; i < randomFxIntervals.length; i++) {
            if (Math.abs(randomFxIntervals[i] - randomNumber) < 10000) {
                console.log('rechoosing random... diff was ' + Math.abs(randomFxIntervals[i] - randomNumber));
                randomNumber = randomIntFromInterval(min, max, type, true);
            }
        }

        if (!isDeep)
            randomFxIntervals.push(randomNumber);
    }

    return randomNumber;
}

function playSample(audioBuffer, time, loop, panVal) {
    const sampleSource = audioContext.createBufferSource();
    sampleSource.buffer = audioBuffer;
    sampleSource.loop = loop;

    if (panVal) {
        let panNode = audioContext.createStereoPanner();
        panNode.pan.setValueAtTime(panVal, audioContext.currentTime);
        //console.log('panning to ' + panVal);
        sampleSource.connect(panNode);
        panNode.connect(gainNode);
        panNode.connect(masterDelayNode);
    } else {
        sampleSource.connect(gainNode);
    }

    sampleSource.start(time);

    //console.log('sample started and connected to gain node');
    if (loop)
        nowPlaying.push(sampleSource);

    return sampleSource;
}

function showBaseNote(sampleName) {
    var yValue = '50';
    var sampleName = sampleName.replace('/audio/drone-loop-', '').replace('.mp3', '');

    for (var i = 0; i < loopYPositions.length; i++) {
        if (loopYPositions[i].name == sampleName) {
            yValue = loopYPositions[i].yval;
        }
    }

    $('.dropscanvas').append('<div data-sample="' + sampleName + '" class="note" style="top: ' + yValue + '"></div>');

    setTimeout(function () {
        $('.note[data-sample="' + sampleName + '"]').remove();
    }, 14000);
}

function showDrop(sampleName, xValue, type, yOverride) {
    if (type == 'piano') {
        var yValue = '50%';
        sampleName = sampleName.replace('/audio/piano-', 'p').replace('.mp3', '');

        for (var i = 0; i < pianoDropYPositions.length; i++) {
            if (pianoDropYPositions[i].name == sampleName) {
                yValue = pianoDropYPositions[i].yval;
            }
        }

        $('.dropscanvas').append('<div data-sample="' + sampleName + '" class="drop piano" style="top: ' + yValue + '; left: ' + xValue + '%"></div>');

        setTimeout(function () {
            $('.drop[data-sample="' + sampleName + '"]').remove();
        }, 15200);
    } else {
        var yValue = '50%';
        sampleName = sampleName.replace('/audio/sine-', '').replace('.mp3', '');

        for (var i = 0; i < sineDropYPositions.length; i++) {
            if (sineDropYPositions[i].name == sampleName) {
                yValue = sineDropYPositions[i].yval;
            }
        }

        if (yOverride) {
            yValue = yOverride;
        }

        $('.dropscanvas').append('<div data-sample="' + sampleName + '" class="drop" style="top: ' + yValue + '; left: ' + xValue + '%"></div>');

        setTimeout(function () {
            $('.drop[data-sample="' + sampleName + '"]').remove();
        }, 15200);
    }
}

$('.openinfo').on('click', function () {
    if ($('.info').hasClass('hidden')) {
        $('.infocontainer').show();
        $('.info').removeClass('hidden');
    } else {
        $('.info').addClass('hidden');
        setTimeout(function () {
            $('.infocontainer').hide();
        }, 1000);
    }
    return false;
});

$('.share').on('click', function () {
    copyShareText();
});

function copyShareText() {
    // Get the text field
    var timetext = getTimeString();
    var shareUrl = 'https://infiniteafternoon.com/?afternoon=' + seed.toString(36);
    let copyText = '';
    if (timetext.length == 0) {
        copyText = 'I am almost listening to ' + shareUrl;
    } else {
        copyText = 'I listened to ' + shareUrl + ' for ' + timetext + '. That exact afternoon is in the link.';
    }

    $('.share').addClass('copied');
    navigator.clipboard.writeText(copyText);

    setTimeout(function () {
        $('.share').removeClass('copied');
    }, 5000)
}

function displayTimeElapsed() {
    var endTime = new Date();
    var timeDiff = endTime - startTime;
    timeDiff /= 1000;

    // remove seconds from the date
    timeDiff = Math.floor(timeDiff / 60);

    // get minutes
    var minutes = Math.round(timeDiff % 60);

    // remove minutes from the date
    timeDiff = Math.floor(timeDiff / 60);

    // get hours
    var hours = Math.round(timeDiff % 24);
    var timetext = getTimeString();

    if (timetext.length > 0) {
        var timetext = 'listened for ' + timetext;
    }

    $('.time').text(timetext);
    setTimeout(displayTimeElapsed, 5000);
}

function getTimeString() {
    var endTime = new Date();
    var timeDiff = endTime - startTime;
    timeDiff /= 1000;

    // remove seconds from the date
    timeDiff = Math.floor(timeDiff / 60);

    // get minutes
    var minutes = Math.round(timeDiff % 60);

    // remove minutes from the date
    timeDiff = Math.floor(timeDiff / 60);

    // get hours
    var hours = Math.round(timeDiff % 24);

    var timetext = '';
    if (hours == 1) {
        timetext += '1 hour';
    } else if (hours > 1) {
        timetext += (hours + ' hours');
    }

    if (hours > 0 && minutes > 0) {
        timetext += ' and ';
    }

    if (minutes == 0 && hours == 0) {
        timetext += 'under a minute';
    } else if (minutes == 1) {
        timetext += '1 minute';
    } else if (minutes > 1) {
        timetext += (minutes + ' minutes');
    }

    return timetext;
}