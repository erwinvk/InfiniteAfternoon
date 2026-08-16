// Infinite Afternoon — player.
// The composition itself lives in /score.json; this file only performs it.
// Signal path: sample -> [pan -> delay] -> gainNode -> volume -> sleep -> speakers
(function () {
    'use strict';

    const $ = (sel) => document.querySelector(sel);
    // optional controls may be absent from the markup; wiring one up must not
    // throw and take every handler below it with it
    const on = (el, event, fn) => { if (el) el.addEventListener(event, fn); };

    // ---- score ----
    let score = null;
    const scoreReady = fetch('/score.json')
        .then((r) => r.json())
        .then((s) => { score = s; return s; })
        .catch((err) => { console.error('could not load score', err); return null; });

    // ---- seeded randomness ----
    // every afternoon has a seed; the same seed in the url replays the same schedule
    const seed = (function () {
        const param = new URLSearchParams(window.location.search).get('afternoon');
        if (param) {
            const parsed = parseInt(param, 36);
            if (!isNaN(parsed)) return parsed >>> 0;
        }
        return (Math.random() * 4294967296) >>> 0;
    })();

    function mulberry32(a) {
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            let t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    function randomPan(rng) {
        return (Math.ceil(rng() * 99) * (rng() < 0.5 ? 1 : -1)) / 100;
    }

    let intervalRng;
    let lastPlans = null;   // the schedule drawn for this seed, handy when tuning a score

    // draw an interval, keeping it away from the ones already drawn for this layer
    function drawInterval(min, max, taken, spacing, record) {
        let n = Math.floor(intervalRng() * (max - min + 1) + min);

        if (spacing) {
            for (let i = 0; i < taken.length; i++) {
                if (Math.abs(taken[i] - n) < spacing) {
                    n = drawInterval(min, max, taken, spacing, false);
                }
            }
        }

        if (record) taken.push(n);
        return n;
    }

    // ---- audio graph ----
    let isPlaying = false;
    // samples can still be loading when you pause, so every start gets a token.
    // a load that finishes after its own start was abandoned would otherwise
    // schedule a second set of timers and play the whole piece twice.
    let runToken = 0;
    let starting = false;            // a second click before score.json lands
    let audioContext, analyser, gainNode, volumeNode, sleepNode, delayNode, delayFeedbackNode;
    let startTime;
    const pendingTimeouts = new Set();
    const bufferCache = new Map();

    function buildGraph() {
        if (audioContext) return;

        audioContext = new AudioContext();

        volumeNode = audioContext.createGain();
        volumeNode.gain.value = parseInt($('#volumecontrol').value, 10) / 100;

        // sleep timer fades this separate node, so the volume slider stays untouched
        sleepNode = audioContext.createGain();
        volumeNode.connect(sleepNode);
        sleepNode.connect(audioContext.destination);

        // tap for the audio-reactive visuals
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.85;
        sleepNode.connect(analyser);

        gainNode = audioContext.createGain();
        gainNode.connect(volumeNode);

        delayFeedbackNode = audioContext.createGain();
        delayFeedbackNode.gain.value = 0.3;

        const biquadFilter = audioContext.createBiquadFilter();
        biquadFilter.type = 'lowpass';
        biquadFilter.frequency.value = 600;

        delayNode = audioContext.createDelay(3);
        delayNode.delayTime.value = 1.4;
        delayNode.connect(biquadFilter);
        biquadFilter.connect(delayFeedbackNode);
        delayFeedbackNode.connect(delayNode);
        delayFeedbackNode.connect(gainNode);
    }

    async function getBuffer(file) {
        const path = score.audioBase + file;
        // decoded buffers are cached, so pause/resume does not re-download or re-decode
        if (bufferCache.has(path)) return bufferCache.get(path);

        const response = await fetch(path);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
        bufferCache.set(path, audioBuffer);
        return audioBuffer;
    }

    // load every sample of a layer in parallel
    function loadLayer(layer, onEach) {
        return Promise.all(layer.samples.map(function (s) {
            return getBuffer(s.file).then(function (buffer) {
                if (onEach) onEach();
                return buffer;
            });
        }));
    }

    // pressing play used to be followed by silence while 13MB of audio arrived,
    // with nothing on screen to say so. the circle fills as the buffers land.
    let loadedCount = 0;
    let loadTotal = 0;

    function beginLoading(total) {
        loadedCount = 0;
        loadTotal = total;
        if (total === 0) return;
        circle.classList.add('loading');
        circle.style.setProperty('--loaded', '0');
    }

    function markLoaded(count) {
        loadedCount += count;
        if (loadTotal === 0) return;

        circle.style.setProperty('--loaded', (loadedCount / loadTotal).toFixed(3));

        if (loadedCount >= loadTotal) {
            circle.classList.remove('loading');
            circle.style.removeProperty('--loaded');
        }
    }

    function playBuffer(buffer, pan) {
        const source = audioContext.createBufferSource();
        source.buffer = buffer;

        if (pan) {
            const panNode = audioContext.createStereoPanner();
            panNode.pan.setValueAtTime(pan, audioContext.currentTime);
            source.connect(panNode);
            panNode.connect(gainNode);
            panNode.connect(delayNode);
        } else {
            source.connect(gainNode);
        }

        source.start(0);
        return source;
    }

    // repeating timer that skips ahead on its first run, so the piece does not
    // open with a long silence
    function repeat(callback, interval, warp) {
        let first = interval;

        if (warp) {
            first = interval - warp;
            if (first < 0) first = interval - Math.abs(interval - warp);
        }

        (function schedule(delay) {
            const timeout = setTimeout(function () {
                pendingTimeouts.delete(timeout);
                if (!isPlaying) return;
                callback();
                schedule(interval);
            }, Math.abs(delay));

            pendingTimeouts.add(timeout);
        })(first);
    }

    // ---- performing the score ----
    let fadedIn = false;

    function fadeIn() {
        if (fadedIn) return;
        fadedIn = true;

        // cancel first: pausing and starting again within two seconds would
        // otherwise leave the previous fade-out on the timeline and cut this
        // ramp short.
        gainNode.gain.cancelScheduledValues(audioContext.currentTime);
        gainNode.gain.setValueAtTime(0.01, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(1, audioContext.currentTime + 2);
    }

    function start() {
        buildGraph();

        const token = ++runToken;
        fadedIn = false;
        intervalRng = mulberry32(seed);
        history.replaceState(null, '', '?afternoon=' + seed.toString(36));

        // draw every interval up front, in score order, so the same seed always
        // produces the same afternoon no matter how fast the samples load
        lastPlans = score.layers.map(function (layer) {
            if (layer.mode !== 'random') return null;

            const taken = [];
            const warp = layer.warpFirst === true ? score.timewarp : layer.warpFirst;

            if (layer.pickOne) {
                return { intervals: [drawInterval(layer.interval[0], layer.interval[1], taken, layer.minSpacing, true)], warp: warp };
            }

            return {
                intervals: layer.samples.map(function () {
                    return drawInterval(layer.interval[0], layer.interval[1], taken, layer.minSpacing, true);
                }),
                warp: warp
            };
        });

        beginLoading(score.layers.reduce((n, l) => n + l.samples.length, 0));

        score.layers.forEach(function (layer, layerIndex) {
            loadLayer(layer, function () { if (token === runToken) markLoaded(1); }).then(function (buffers) {
                if (!isPlaying || token !== runToken) return;

                // fade the piece in as soon as the first layer is ready, whatever
                // kind it is. this used to sit inside the retrigger branch, which
                // tied it to the score having a retrigger layer: stop() leaves the
                // gain at 0.01, so editing score.json to drop that one layer would
                // have left the site silent for good after the first pause.
                fadeIn();

                if (layer.mode === 'retrigger') {
                    let offset = layer.every;

                    layer.samples.forEach(function (sample, i) {
                        repeat(function () {
                            playBuffer(buffers[i], 0);
                            showVisual(layer, sample);
                        }, offset, layer.warpFirst);
                        offset += layer.stagger;
                    });
                    return;
                }

                const plan = lastPlans[layerIndex];

                if (layer.pickOne) {
                    const rng = mulberry32(seed + layer.rngOffset);
                    repeat(function () {
                        const i = Math.floor(rng() * buffers.length);
                        playBuffer(buffers[i], 0);
                        showVisual(layer, layer.samples[i]);
                    }, plan.intervals[0], plan.warp);
                    return;
                }

                layer.samples.forEach(function (sample, i) {
                    const rng = mulberry32(seed + layer.rngOffset + i);
                    repeat(function () {
                        const pan = layer.pan ? randomPan(rng) : 0;
                        playBuffer(buffers[i], pan);
                        showVisual(layer, sample, (pan + 1) * 50);
                    }, plan.intervals[i], plan.warp);
                });
            });
        });

        isPlaying = true;
        startTime = new Date();
        // a timer chosen before pressing play counts from here, not from the click
        if (sleepChoices[sleepChoiceIndex] > 0) armSleepTimer();
        updateMediaSession(true);
        startEnergyAnimation();
        showPlayAlongHint();
        tickElapsed();
    }

    // the premise is invisible until someone opens 'about', which nobody does.
    // one line before you press play, one hint once playing is the thing to do.
    const invitation = $('.invitation');
    const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
    let hintTimeout;

    function showPlayAlongHint() {
        if (!invitation || invitation.dataset.hinted) return;
        invitation.dataset.hinted = 'yes';

        invitation.classList.add('fading');
        clearTimeout(hintTimeout);

        hintTimeout = setTimeout(function () {
            invitation.textContent = (coarsePointer ? 'Tap' : 'Click') + ' anywhere to drop a note.';
            invitation.classList.remove('fading');

            hintTimeout = setTimeout(function () {
                invitation.classList.add('fading');
                setTimeout(function () { invitation.hidden = true; }, 2000);
            }, 9000);
        }, 1200);
    }

    function stop() {
        isPlaying = false;
        // anything still loading belongs to a run that is over now
        runToken++;

        gainNode.gain.cancelScheduledValues(audioContext.currentTime);
        gainNode.gain.setValueAtTime(Math.max(0.01, gainNode.gain.value), audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 2);

        pendingTimeouts.forEach(clearTimeout);
        pendingTimeouts.clear();

        clearSleepTimer(true);
        stopEnergyAnimation();
        updateMediaSession(false);

        // pausing halfway through the first load leaves no half-filled circle
        circle.classList.remove('loading');
        circle.style.removeProperty('--loaded');
        loadTotal = 0;
    }

    // ---- visuals ----
    const canvas = $('.dropscanvas');

    // each visual removes its own element; removing by selector would also take
    // out newer notes of the same sample
    function addTemporary(html, lifetime, hue) {
        const element = document.createElement('div');
        element.className = html.className;
        if (html.style) element.setAttribute('style', html.style);
        if (html.sample) element.dataset.sample = html.sample;
        // the layer's hue drives every colour in the element's animation
        if (hue !== undefined) element.style.setProperty('--hue', hue);
        canvas.appendChild(element);
        setTimeout(function () { element.remove(); }, lifetime);
        return element;
    }

    function showVisual(layer, sample, xPercent, yOverride) {
        if (!layer.visual) return;

        const y = yOverride || sample.y || '50%';

        if (layer.visual === 'band') {
            addTemporary({ className: 'note', sample: sample.id, style: 'top: ' + y }, layer.visualDuration, layer.hue);
            return;
        }

        if (layer.visual === 'subpulse') {
            addTemporary({ className: 'subpulse' }, layer.visualDuration, layer.hue);
            return;
        }

        if (layer.visual === 'spark') {
            addTemporary({
                className: 'spark',
                sample: sample.id,
                style: 'top: ' + y + '; left: ' + xPercent + '%'
            }, layer.visualDuration, layer.hue);
            return;
        }

        if (layer.visual === 'drop') {
            const className = layer.dropClass ? 'drop ' + layer.dropClass : 'drop';
            addTemporary({
                className: className,
                sample: sample.id,
                style: 'top: ' + y + '; left: ' + xPercent + '%'
            }, layer.visualDuration, layer.hue);
        }
    }

    // ---- audio-reactive visuals ----
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finePointer = window.matchMedia('(pointer: fine)').matches;
    let energyFrame, smoothedEnergy = 0, lastWavesDraw = 0;
    const energyData = new Uint8Array(128);

    function startEnergyAnimation() {
        if (reducedMotion) return;

        cancelAnimationFrame(energyFrame);
        const noiseEl = $('.noise');
        const titleEl = $('#titlecontainer');
        const titleTextEl = titleEl.querySelector('h1');

        (function tick() {
            analyser.getByteFrequencyData(energyData);
            let sum = 0;
            for (let i = 0; i < energyData.length; i++) sum += energyData[i];

            const energy = sum / energyData.length / 255;
            smoothedEnergy += (energy - smoothedEnergy) * 0.05;

            noiseEl.style.opacity = Math.min(1, 0.45 + smoothedEnergy * 0.5);
            titleEl.style.opacity = Math.min(1, 0.7 + smoothedEnergy * 0.8);
            // shimmer: shift the title gradient with the swells of the music
            titleTextEl.style.backgroundPosition = '0 ' + (50 + smoothedEnergy * 150) + '%';
            // the circle breathes too. a custom property, not a transform, so
            // this never fights the sunset transition for the same property
            circle.style.setProperty('--glow', smoothedEnergy.toFixed(3));

            // the horizon records this moment and glides on. redrawn at about
            // 12fps rather than every frame — it is a landscape, not a meter
            const now = performance.now();
            pushHistory(now);

            if (now - lastWavesDraw > 80) {
                lastWavesDraw = now;
                drawWaves((now - lastHistoryPush) / HISTORY_STEP_MS);
            }

            energyFrame = requestAnimationFrame(tick);
        })();
    }

    function stopEnergyAnimation() {
        cancelAnimationFrame(energyFrame);
        $('.noise').style.opacity = '';
        $('#titlecontainer').style.opacity = '';
        $('#titlecontainer h1').style.backgroundPosition = '';
        circle.style.removeProperty('--glow');
    }

    // ---- transport ----
    const startButton = $('#start');

    startButton.addEventListener('click', function () {
        if (isPlaying) {
            stop();
            startButton.classList.remove('pause');
            startButton.setAttribute('aria-label', 'Play');
            return;
        }

        // the first click can land while score.json is still on its way, and
        // isPlaying is only true once it arrives. without this a plain
        // double-click starts the piece twice, note for note, for good.
        if (starting) return;
        starting = true;

        // build the context synchronously, inside the user gesture, or the
        // browser hands us a suspended one
        buildGraph();
        if (audioContext.state === 'suspended') audioContext.resume();

        scoreReady.then(function () {
            starting = false;
            if (!score) return;
            startButton.classList.add('pause');
            startButton.setAttribute('aria-label', 'Pause');
            start();
        });
    });

    $('#volumecontrol').addEventListener('input', function () {
        if (volumeNode) volumeNode.gain.value = parseInt(this.value, 10) / 100;
    });

    // ---- sleep timer ----
    const sleepChoices = [0, 30, 60, 90]; // minutes, 0 = off
    const sleepFadeSeconds = 30;
    const sleepButton = $('.sleeptimer');
    let sleepChoiceIndex = 0;
    let sleepTimeouts = [];

    on(sleepButton, 'click', function () {
        sleepChoiceIndex = (sleepChoiceIndex + 1) % sleepChoices.length;
        armSleepTimer();
    });

    function sleepLabel(text, armed, aria) {
        if (!sleepButton) return;
        sleepButton.textContent = text;
        sleepButton.classList.toggle('armed', armed);
        sleepButton.setAttribute('aria-label', aria);
    }

    function armSleepTimer() {
        clearSleepTimer(false);
        const minutes = sleepChoices[sleepChoiceIndex];

        if (minutes === 0) {
            sleepLabel('timer', false, 'Sleep timer off');
            return;
        }

        sleepLabel(minutes + 'm', true, 'Sleep timer, ' + minutes + ' minutes');

        // choosing a timer before pressing play only lights the button. the
        // countdown — and the sinking circle — belong to the music, so start()
        // arms this for real. otherwise the piece would end minutes after it
        // began, and the circle would set over an empty room.
        if (!isPlaying) return;

        startSunset(minutes);

        // fade out during the last sleepFadeSeconds, then pause
        sleepTimeouts.push(setTimeout(function () {
            if (!isPlaying || !sleepNode) return;
            sleepNode.gain.setValueAtTime(1, audioContext.currentTime);
            sleepNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + sleepFadeSeconds);
        }, minutes * 60000 - sleepFadeSeconds * 1000));

        sleepTimeouts.push(setTimeout(function () {
            if (isPlaying) startButton.click();
        }, minutes * 60000));
    }

    function clearSleepTimer(resetLabel) {
        sleepTimeouts.forEach(clearTimeout);
        sleepTimeouts = [];

        if (sleepNode && audioContext) {
            const wasFaded = sleepNode.gain.value < 0.9;
            sleepNode.gain.cancelScheduledValues(audioContext.currentTime);
            // if the fade already kicked in, restore the gain after the 2s stop fade
            sleepNode.gain.setValueAtTime(1, audioContext.currentTime + (wasFaded ? 2.5 : 0));
        }

        if (resetLabel) {
            sleepChoiceIndex = 0;
            sleepLabel('timer', false, 'Sleep timer off');
        }

        resetSunset();
    }

    // while the sleep timer runs, the circle sinks like a setting sun
    const circle = startButton.closest('.themiddle');

    function startSunset(minutes) {
        circle.style.transition = 'transform ' + (minutes * 60) + 's linear, opacity ' + (minutes * 60) + 's linear';
        circle.getBoundingClientRect(); // flush, so the transition starts from the current position
        circle.style.transform = 'translateZ(0) translateY(38vh)';
        circle.style.opacity = '0.3';
    }

    function resetSunset() {
        if (!circle.style.transform) return;
        circle.style.transition = 'transform 2s ease-in-out, opacity 2s ease-in-out';
        circle.style.transform = '';
        circle.style.opacity = '';
        setTimeout(function () { circle.style.transition = ''; }, 2100);
    }

    // ---- play along ----
    function playableLayers() {
        return score.layers.filter((l) => l.playable);
    }

    function layerFor(range) {
        return score.layers.find((l) => l.playable === range);
    }

    // click or tap anywhere to drop a note
    canvas.addEventListener('click', function (e) {
        if (!isPlaying) return;

        const layer = layerFor('high');
        if (!layer) return;

        // top-to-bottom bands, high notes at the top. the fractions are clamped
        // because a viewport reported as zero makes the index NaN and there is
        // no band at NaN.
        const byPitch = layer.samples.map((s, i) => ({ s: s, i: i })).sort((a, b) => b.s.midi - a.s.midi);
        const yFraction = Math.max(0, Math.min(0.999, e.clientY / (window.innerHeight || 1)));
        const xFraction = Math.max(0, Math.min(1, e.clientX / (window.innerWidth || 1)));
        const band = byPitch[Math.floor(yFraction * byPitch.length)];
        if (!band) return;

        let pan = Math.max(-0.99, Math.min(0.99, xFraction * 2 - 1));
        if (Math.abs(pan) < 0.02) pan = 0.02; // keep the panned (and delayed) signal path

        loadLayer(layer).then(function (buffers) {
            playBuffer(buffers[band.i], pan);
            showVisual(layer, band.s, xFraction * 100, (yFraction * 100) + '%');
        });
    });

    // computer keyboard
    document.addEventListener('keydown', function (e) {
        // escape closes the panel whether or not anything is playing
        if (e.key === 'Escape' && info && !info.classList.contains('hidden')) {
            setInfo(false);
            return;
        }

        if (!isPlaying || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;

        const key = e.key.toLowerCase();

        for (const layer of playableLayers()) {
            const index = layer.samples.findIndex((s) => s.key === key);
            if (index === -1) continue;

            loadLayer(layer).then(function (buffers) {
                let pan = (Math.random() * 1.6) - 0.8;
                if (Math.abs(pan) < 0.02) pan = 0.02;
                playBuffer(buffers[index], pan);
                showVisual(layer, layer.samples[index], (pan + 1) * 50);
            });
            return;
        }
    });

    // ---- web midi ----
    // every control below the circle is optional: leaving one out of the markup
    // must never take the rest of the page down with it
    const midiButton = $('.midilink');

    if (midiButton) {
        midiButton.addEventListener('click', connectMidi);

        // reconnect silently when access was granted in an earlier visit
        try {
            if (navigator.permissions && navigator.requestMIDIAccess) {
                navigator.permissions.query({ name: 'midi' })
                    .then(function (status) { if (status.state === 'granted') connectMidi(); })
                    .catch(function () { });
            }
        } catch (e) { /* permissions.query rejects on browsers without midi */ }
    }

    function midiLabel(text, connected) {
        if (!midiButton) return;
        midiButton.textContent = text;
        midiButton.classList.toggle('connected', !!connected);
    }

    function connectMidi() {
        if (!navigator.requestMIDIAccess) {
            midiLabel('no midi');
            return;
        }

        navigator.requestMIDIAccess().then(function (access) {
            function attachInputs() {
                let inputCount = 0;
                access.inputs.forEach(function (input) {
                    input.onmidimessage = onMidiMessage;
                    inputCount++;
                });
                midiLabel(inputCount > 0 ? 'midi ✓' : 'no midi', inputCount > 0);
            }

            access.onstatechange = attachInputs;
            attachInputs();
        }, function () {
            midiLabel('no midi');
        });
    }

    function onMidiMessage(message) {
        if ((message.data[0] & 0xf0) === 0x90 && message.data[2] > 0) {
            playMidiNote(message.data[1], message.data[2]);
        }
    }

    function playMidiNote(noteNumber, velocity) {
        if (!isPlaying) return;

        const layer = layerFor(noteNumber < 55 ? 'low' : 'high');
        if (!layer) return;

        // pitch the nearest sample to the requested note
        let nearest = 0;
        layer.samples.forEach(function (sample, i) {
            if (Math.abs(sample.midi - noteNumber) < Math.abs(layer.samples[nearest].midi - noteNumber)) nearest = i;
        });

        loadLayer(layer).then(function (buffers) {
            const source = audioContext.createBufferSource();
            source.buffer = buffers[nearest];
            source.playbackRate.value = Math.pow(2, (noteNumber - layer.samples[nearest].midi) / 12);

            const velocityGain = audioContext.createGain();
            velocityGain.gain.value = velocity / 127;

            const panNode = audioContext.createStereoPanner();
            const pan = (Math.random() * 1.2) - 0.6;
            panNode.pan.value = pan;

            source.connect(velocityGain);
            velocityGain.connect(panNode);
            panNode.connect(gainNode);
            panNode.connect(delayNode);
            source.start(0);

            // drop where the pitch sits: high notes near the top
            const y = Math.max(5, Math.min(95, 100 - ((noteNumber - 30) / 60) * 100));
            showVisual(layer, layer.samples[nearest], (pan + 1) * 50, y + '%');
        });
    }

    // ---- the horizon is the memory of the piece ----
    // Everything else on the page is the present tense. This is not: the land
    // at the bottom of the screen is a record of the energy of the last eight
    // minutes, newest at the right. Read top to bottom the screen is future,
    // now, and what has already gone.
    const wavesCanvas = $('.waves');
    // few enough samples that a single swell is a visible feature of the land
    // rather than a 4px ripple
    const HISTORY_LENGTH = 150;
    const HISTORY_STEP_MS = 3200;              // 150 * 3.2s = eight minutes
    // not 'history': that name shadows window.history, which start() needs to
    // write the seed into the url
    const energyHistory = new Array(HISTORY_LENGTH).fill(0);
    let wavesCtx, wavesWidth, wavesHeight, historyOffset = 0, lastHistoryPush = 0;

    // the same memory drawn at four depths, the way the old decorative waves
    // layered one path — except these are the real thing
    const horizons = [
        { lift: 0.30, amp: 0.46, alpha: 0.16, shift: 0 },
        { lift: 0.22, amp: 0.34, alpha: 0.11, shift: 19 },
        { lift: 0.15, amp: 0.24, alpha: 0.08, shift: 43 },
        { lift: 0.09, amp: 0.16, alpha: 0.12, shift: 67 }
    ];

    function sizeWaves() {
        if (!wavesCanvas) return;

        const rect = wavesCanvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;

        wavesWidth = Math.max(1, Math.round(rect.width));
        wavesHeight = Math.max(1, Math.round(rect.height));
        wavesCanvas.width = Math.round(wavesWidth * dpr);
        wavesCanvas.height = Math.round(wavesHeight * dpr);

        wavesCtx = wavesCanvas.getContext('2d');
        wavesCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        drawWaves();
    }

    // a standing shape so the land exists even in silence; the music embosses it
    // kept small on purpose: enough that silence is still a landscape, not so
    // much that it drowns out what was actually played
    function bedrock(i) {
        return Math.sin(i * 0.21) * 0.35 + Math.sin(i * 0.079 + 1.3) * 0.5;
    }

    function drawWaves(subStep) {
        if (!wavesCtx) return;

        wavesCtx.clearRect(0, 0, wavesWidth, wavesHeight);

        const slide = subStep || 0;   // 0..1 between two samples, keeps it gliding
        const stepX = wavesWidth / (HISTORY_LENGTH - 1);

        horizons.forEach(function (horizon) {
            wavesCtx.beginPath();
            wavesCtx.moveTo(-stepX, wavesHeight);

            let previousX = -stepX;
            let previousY = wavesHeight;

            for (let i = 0; i < HISTORY_LENGTH; i++) {
                const sample = energyHistory[(historyOffset + i + horizon.shift) % HISTORY_LENGTH];
                const x = (i - slide) * stepX;
                const height = horizon.lift + bedrock(i + horizon.shift) * 0.04 + sample * horizon.amp;
                const y = wavesHeight - height * wavesHeight;

                // smooth the profile so it reads as land, not as a graph
                wavesCtx.quadraticCurveTo(previousX, previousY, (previousX + x) / 2, (previousY + y) / 2);
                previousX = x;
                previousY = y;
            }

            wavesCtx.lineTo(wavesWidth + stepX, previousY);
            wavesCtx.lineTo(wavesWidth + stepX, wavesHeight);
            wavesCtx.closePath();

            wavesCtx.fillStyle = 'rgba(81, 104, 167, ' + horizon.alpha + ')';
            wavesCtx.fill();
        });
    }

    function pushHistory(now) {
        if (now - lastHistoryPush < HISTORY_STEP_MS) return false;

        lastHistoryPush = now;
        energyHistory[historyOffset] = isPlaying ? Math.min(1, smoothedEnergy * 2.2) : 0;
        historyOffset = (historyOffset + 1) % HISTORY_LENGTH;
        return true;
    }

    if (wavesCanvas) {
        sizeWaves();
        window.addEventListener('resize', sizeWaves);

        // when nothing is playing the energy loop is not running, so keep the
        // land alive on a slow timer of its own
        setInterval(function () {
            if (isPlaying) return;
            if (pushHistory(performance.now())) drawWaves();
        }, HISTORY_STEP_MS);
    }

    // ---- pointer glow, hints that clicking plays a note ----
    let cursorGlow;

    if (!reducedMotion && finePointer) {
        document.addEventListener('mousemove', function (e) {
            if (!cursorGlow) {
                cursorGlow = document.createElement('div');
                cursorGlow.className = 'cursorglow';
                cursorGlow.setAttribute('aria-hidden', 'true');
                document.body.appendChild(cursorGlow);
            }

            cursorGlow.style.transform = 'translate(' + (e.clientX - 22) + 'px, ' + (e.clientY - 22) + 'px)';
        });
    }

    // ---- about panel ----
    const infoButton = $('.openinfo');
    const infoContainer = $('.infocontainer');
    const info = $('.info');
    let infoHideTimeout;

    // on a phone the panel covers the button that opened it, so it needs a way
    // out of its own: a cross, and escape
    function setInfo(open) {
        if (!info) return;

        clearTimeout(infoHideTimeout);

        if (open) {
            infoContainer.hidden = false;
            info.classList.remove('hidden');
        } else {
            info.classList.add('hidden');
            infoHideTimeout = setTimeout(function () { infoContainer.hidden = true; }, 1000);
        }

        if (infoButton) infoButton.setAttribute('aria-expanded', String(open));
    }

    on(infoButton, 'click', function () { setInfo(info.classList.contains('hidden')); });
    on($('.closeinfo'), 'click', function () { setInfo(false); });

    // ---- sharing ----
    const shareButton = $('.share');

    on(shareButton, 'click', function () {
        const timetext = elapsedString();
        const shareUrl = 'https://infiniteafternoon.com/?afternoon=' + seed.toString(36);
        const copyText = timetext.length === 0
            ? 'I am almost listening to ' + shareUrl
            : 'I listened to ' + shareUrl + ' for ' + timetext + '. That exact afternoon is in the link.';

        shareButton.classList.add('copied');
        // writeText rejects when the document is not focused or permission is
        // refused; an unhandled rejection here helps nobody
        navigator.clipboard.writeText(copyText).catch(function () {
            shareButton.classList.remove('copied');
        });

        setTimeout(function () { shareButton.classList.remove('copied'); }, 5000);
    });

    // ---- elapsed time and dusk ----
    function elapsedString() {
        if (!startTime) return '';

        let elapsed = Math.floor((new Date() - startTime) / 1000 / 60);
        const minutes = Math.round(elapsed % 60);
        const hours = Math.round(Math.floor(elapsed / 60) % 24);

        let text = '';
        if (hours === 1) text += '1 hour';
        else if (hours > 1) text += hours + ' hours';

        if (hours > 0 && minutes > 0) text += ' and ';

        if (minutes === 0 && hours === 0) text += 'under a minute';
        else if (minutes === 1) text += '1 minute';
        else if (minutes > 1) text += minutes + ' minutes';

        return text;
    }

    // The sky follows the listener's actual clock, so the page arrives already
    // in the light of the moment and keeps turning while you listen: start at
    // six in the evening and stay four hours, and you watch it get dark for
    // real. Each stage is one overlay with a simple ramp, cross-fading.
    function ramp(value, from, to) {
        return Math.max(0, Math.min(1, (value - from) / (to - from)));
    }

    // a triangle: up from 'in', full at 'peak', down to 'out'
    function window_(hour, inAt, peak, outAt) {
        return Math.min(ramp(hour, inAt, peak), 1 - ramp(hour, peak, outAt));
    }

    function skyAt(hour) {
        // night is the one that wraps past midnight, so it is spelled out
        let night;
        if (hour >= 20.5) night = ramp(hour, 20.5, 22.5);
        else if (hour < 4.5) night = 1;
        else if (hour < 6.5) night = 1 - ramp(hour, 4.5, 6.5);
        else night = 0;

        return {
            dusk: window_(hour, 16.5, 19.5, 22.5) * 0.8,   // late afternoon into evening
            night: night * 0.85,                            // evening through to first light
            dawn: window_(hour, 5, 6.5, 8) * 0.3            // the cold hour before the day
        };
    }

    let skyPainted = false;

    function paintSky(hourOverride) {
        const dusk = $('.dusk');
        const night = $('.night');
        const dawn = $('.dawn');
        if (!dusk) return;

        const now = new Date();
        const hour = hourOverride === undefined ? now.getHours() + now.getMinutes() / 60 : hourOverride;
        const sky = skyAt(hour);

        // the first paint is the world as it already is, not a 60s fade into it
        if (!skyPainted) {
            skyPainted = true;
            [dusk, night, dawn].forEach(function (el) { el.style.transition = 'none'; });
            dusk.getBoundingClientRect();
            setTimeout(function () {
                [dusk, night, dawn].forEach(function (el) { el.style.transition = ''; });
            }, 50);
        }

        dusk.style.opacity = sky.dusk.toFixed(3);
        night.style.opacity = sky.night.toFixed(3);
        dawn.style.opacity = sky.dawn.toFixed(3);
    }

    paintSky();
    setInterval(function () { paintSky(); }, 60000);

    // one chain, however often you press play — start() used to leave the
    // previous one running and they piled up over a long evening
    let elapsedTimeout;

    function tickElapsed() {
        const timetext = elapsedString();
        const timeEl = $('.time');
        const text = timetext.length > 0 ? 'listened for ' + timetext : '';

        // this is an aria-live region and the text only changes once a minute.
        // writing it every five seconds regardless had screen readers announce
        // the same sentence twelve times a minute.
        if (timeEl && timeEl.textContent !== text) timeEl.textContent = text;

        clearTimeout(elapsedTimeout);
        elapsedTimeout = setTimeout(tickElapsed, 5000);
    }

    // ---- os media controls ----
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

            const toggle = function () { startButton.click(); };
            navigator.mediaSession.setActionHandler('play', function () { if (!isPlaying) toggle(); });
            navigator.mediaSession.setActionHandler('pause', function () { if (isPlaying) toggle(); });
            navigator.mediaSession.setActionHandler('stop', function () { if (isPlaying) toggle(); });
        }

        navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    }

    // ---- clearing the screen ----
    // this runs for hours on a second monitor; a bare screen is a reasonable
    // resting state. clicking still drops notes while the controls are gone.
    const uiToggle = $('.uitoggle');

    on(uiToggle, 'click', function () {
        const hidden = document.body.classList.toggle('ui-hidden');
        uiToggle.textContent = hidden ? 'show' : 'hide';
        uiToggle.setAttribute('aria-pressed', String(hidden));
        uiToggle.setAttribute('aria-label', hidden ? 'Show the controls' : 'Hide the controls');
    });

    if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js'); });
    }

    // small surface for debugging in the console
    window.afternoon = {
        get seed() { return seed; },
        get score() { return score; },
        get isPlaying() { return isPlaying; },
        get energy() { return smoothedEnergy; },
        get pending() { return pendingTimeouts.size; },
        get cached() { return bufferCache.size; },
        get loaded() { return loadTotal ? loadedCount + '/' + loadTotal : 'idle'; },
        paintSky: paintSky,
        // the recorded energy, writable — handy when tuning how the land reads
        get horizon() { return energyHistory; },
        redrawHorizon: drawWaves,
        get sky() { const n = new Date(); return skyAt(n.getHours() + n.getMinutes() / 60); },
        get state() { return audioContext ? audioContext.state : 'none'; },
        // the fade-in and fade-out live on this one, so it is worth being able
        // to read it: 1 while the piece is up, 0.01 once it has been paused
        get gain() { return gainNode ? +gainNode.gain.value.toFixed(4) : null; },
        get schedule() { return lastPlans; },
        // draw one of a layer's visuals without waiting for its interval
        preview: function (layerId, xPercent) {
            const layer = score.layers.find((l) => l.id === layerId);
            if (!layer) return 'no such layer';
            layer.samples.forEach(function (sample, i) {
                showVisual(layer, sample, xPercent === undefined ? 20 + i * 12 : xPercent);
            });
            return layer.samples.length + ' ' + layer.visual;
        },
        get time() { return audioContext ? +audioContext.currentTime.toFixed(2) : 0; },
        playMidiNote: playMidiNote
    };
})();
