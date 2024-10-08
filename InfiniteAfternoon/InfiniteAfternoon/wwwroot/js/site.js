﻿// Samples --> gainNode --> masterVolumeGainNode --> speakers
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
let masterDelayNode;
let samples;
let nowPlaying = [];
let nowPlayingIntervals = [];

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

        for (let i = 0; i < nowPlayingIntervals.length; i++) {
            clearInterval(nowPlayingIntervals[i]);
        }
        console.log('Intervals cleared');

        setTimeout(function () {
            for (let i = 0; i < nowPlaying.length; i++) {
                nowPlaying[i].stop()
            }

            // clear these
            nowPlaying = [];
            nowPlayingIntervals = [];
        }, 2000);
        $(this).removeClass('pause')
        console.log('samples stopped');
        isPlaying = false;
        return false;
    }

    audioContext = new AudioContext();
    masterVolumeGainNode = audioContext.createGain();
    masterVolumeGainNode.connect(audioContext.destination);

    gainNode = audioContext.createGain();
    gainNode.connect(masterVolumeGainNode);

    masterDelayFeedbackNode = audioContext.createGain();
    //masterDelayGainNode.connect(gainNode);
    masterDelayFeedbackNode.gain.value = 0.3;

    var biquadFilter = audioContext.createBiquadFilter();
    biquadFilter.type = biquadFilter.LOWPASS;
    biquadFilter.frequency.value = 600;
    //biquadFilter.Q.value = 20;

    masterDelayNode = audioContext.createDelay(3);
    masterDelayNode.delayTime.value = 1.4;
    masterDelayNode.connect(biquadFilter);
    biquadFilter.connect(masterDelayFeedbackNode);
    //masterDelayNode.connect(gainNode);
    masterDelayFeedbackNode.connect(masterDelayNode);
    masterDelayFeedbackNode.connect(gainNode);

    console.log('audiocontext started...');

    $(this).addClass('pause');

    // Loads and play loops
    setupSamples(samplePathLoops).then((response) => {
        samples = response;
        var interval = 14000;

        for (var i = 0; i < samples.length; i++) {
            (function (i, interval) {
                let sampleInterval = customInterval(function () {
                    playSample(response[i], 0, false);
                    showBaseNote(samplePathLoops[i]);
                }, interval, true, 13500);
                nowPlayingIntervals.push(sampleInterval);
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
        samples = response;

        for (var i = 0; i < response.length; i++) {
            let interval = randomIntFromInterval(minSineInterval, maxSineInterval, 'sine');

            (function (i, interval) {
                let sampleInterval = customInterval(function () {
                    var randomPan = (Math.ceil(Math.random() * 99) * (Math.round(Math.random()) ? 1 : -1)) / 100;

                    playSample(response[i], 0, false, randomPan);

                    randomPan += 1; //get off negative, range 0 - 2
                    randomPan *= 50; // range 0 - 100
                    showDrop(samplePathsSines[i], randomPan, 'sine');
                }, interval, true)

                nowPlayingIntervals.push(sampleInterval);
            })(i, interval);

            console.log('initing note ' + i + ' on interval ' + interval);
        }
    });

    // Piano
    setupSamples(samplePathsPiano).then((response) => {
        samples = response;

        for (var i = 0; i < response.length; i++) {
            let interval = randomIntFromInterval(minPianoInterval, maxPianoInterval, 'piano');

            (function (i, interval) {
                let sampleInterval = customInterval(function () {
                    var randomPan = (Math.ceil(Math.random() * 99) * (Math.round(Math.random()) ? 1 : -1)) / 100;

                    playSample(response[i], 0, false, randomPan);

                    randomPan += 1; //get off negative, range 0 - 2
                    randomPan *= 50; // range 0 - 100
                    showDrop(samplePathsPiano[i], randomPan, 'piano');
                }, interval, true)

                nowPlayingIntervals.push(sampleInterval);
            })(i, interval);

            console.log('initing note ' + i + ' on interval ' + interval);
        }
    });

    // subs. Don't want these possibly looping over another, so pick a random interval and at that interval play one of the subs.
    setupSamples(samplePathsSubs).then((response) => {
        samples = response;
        let interval = randomIntFromInterval(minSubInterval, maxSubInterval, 'sub');

        (function (interval) {
            let sampleInterval = customInterval(function () {
                //pick a random sub sample
                var randomSampleNumber = Math.floor(Math.random() * response.length);

                playSample(response[randomSampleNumber], 0, false);
            }, interval)

            nowPlayingIntervals.push(sampleInterval);
        })(interval);
    });

    // FX
    setupSamples(samplePathsFX).then((response) => {
        samples = response;

        for (var i = 0; i < response.length; i++) {
            let interval = randomIntFromInterval(minFXInterval, maxFXInterval, 'fx');

            (function(i, interval) {
                let sampleInterval = customInterval(function () {
                    var randomPan = (Math.ceil(Math.random() * 99) * (Math.round(Math.random()) ? 1 : -1)) / 100;
                    playSample(response[i], 0, false, randomPan);
                    console.log('now playing FX ' + interval);
                }, interval, true)

                nowPlayingIntervals.push(sampleInterval);
            })(i, interval);

            console.log('initing note ' + i + ' on interval ' + interval);
        }
    });

    // set start time
    isPlaying = true;
    startTime = new Date();
    displayTimeElapsed();
});

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
        if (isPlaying) {
            callback();
            customInterval(callback, interval, false);
        }
    }, Math.abs(tempInterval));
}

async function getFile(path) {
    const response = await fetch(path);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    console.log('loaded file: ' + path);
    return audioBuffer;
}

async function setupSamples(paths) {
    console.log('loading audio...')
    const audioBuffers = [];

    for (const path of paths) {
        const sample = await getFile(path);
        audioBuffers.push(sample);
    }

    console.log('loaded audio')
    return audioBuffers;
}

function randomIntFromInterval(min, max, type, isDeep) {
    var randomNumber = Math.floor(Math.random() * (max - min + 1) + min)

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

function showDrop(sampleName, xValue, type) {
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
    let copyText = '';
    if (timetext.length == 0) {
        copyText = 'I am almost listening to infiniteafternoon.com';
    } else {
        copyText = 'I listened to infiniteafternoon.com for ' + timetext + '.';
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