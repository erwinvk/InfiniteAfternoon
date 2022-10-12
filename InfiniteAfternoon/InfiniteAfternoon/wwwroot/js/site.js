// Samples --> gainNode --> masterVolumeGainNode --> speakers
var startTime;
//const minSineInterval = 3000; // test
//const maxSineInterval = 20000; // test
const minSineInterval = 12500;
const maxSineInterval = 44000;

//const minSubInterval = 1000; // test
//const maxSubInterval = 6000; // test
const minSubInterval = 60000; // 1 minute
const maxSubInterval = 300000; // 5 minutes

//const minFXInterval = 2000;
//const maxFXInterval = 20000; 
const minFXInterval = 45000; 
const maxFXInterval = 900000; // 15 minutes

let randomSineIntervals = [];
let randomFxIntervals = [];

let audioContext;
let analyser;
let gainNode;
let masterVolumeGainNode;
let samples;
let nowPlaying = [];
let nowPlayingIntervals = [];

const samplePathLoops = ['/audio/loop-drone.mp3'];
const samplePathsSines = ['/audio/sine-b4.mp3', '/audio/sine-d4.mp3', '/audio/sine-e4.mp3', '/audio/sine-f4.mp3', '/audio/sine-gsharp4.mp3', '/audio/sine-d5.mp3'];
const samplePathsSubs = ['/audio/sub-e0.mp3', '/audio/sub-e0-2.mp3'];
const samplePathsFX = ['/audio/fx-birdlike.mp3', '/audio/fx-triangle.mp3', '/audio/fx-pizzi1.mp3', '/audio/fx-pizzi2.mp3', '/audio/fx-pizzi3.mp3', '/audio/fx-pizzi4.mp3', '/audio/fx-pizzi5.mp3'];

let sineDropYPositions = [];
sineDropYPositions.push({ name:'d5', yval: '10%' });
sineDropYPositions.push({ name: 'b4', yval: '25%' });
sineDropYPositions.push({ name: 'f4', yval: '35%' });
sineDropYPositions.push({ name: 'e4', yval: '55%' });
sineDropYPositions.push({ name: 'd4', yval: '65%' });
sineDropYPositions.push({ name: 'gsharp4', yval:'80%' });

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
        return false;
    }

    audioContext = new AudioContext();
    masterVolumeGainNode = audioContext.createGain();
    masterVolumeGainNode.connect(audioContext.destination);

    gainNode = audioContext.createGain();
    gainNode.connect(masterVolumeGainNode);
    console.log('audiocontext started...');

    $(this).addClass('pause');

    // Loads and play loops
    setupSamples(samplePathLoops).then((response) => {
        samples = response;

        for (var i = 0; i < samples.length; i++) {
            console.log('initing loop ' + i);
            playSample(samples[i], 0, true);
        }

        //fade them in
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(1, audioContext.currentTime + 2);
    });

    setupSamples(samplePathsSines).then((response) => {
        samples = response;

        // play a random single one before the first loop starts
        //setTimeout(function () {
        //    var randomPan = (Math.ceil(Math.random() * 99) * (Math.round(Math.random()) ? 1 : -1)) / 100;
        //    var randomSampleNumber = Math.floor(Math.random() * response.length);

        //    playSample(response[randomSampleNumber], 0, false, randomPan);

        //    randomPan += 1; //get off negative, range 0 - 2
        //    randomPan *= 50; // range 0 - 100
        //    showDrop(samplePathsSines[randomSampleNumber], randomPan);
        //}, randomIntFromInterval(6000, 10000, 'firstrandomnote'));
        // end first single one

        for (var i = 0; i < response.length; i++) {
            let interval = randomIntFromInterval(minSineInterval, maxSineInterval, 'sine');

            (function (i, interval) {
                let sampleInterval = setInterval(function () {
                    var randomPan = (Math.ceil(Math.random() * 99) * (Math.round(Math.random()) ? 1 : -1)) / 100;

                    playSample(response[i], 0, false, randomPan);

                    randomPan += 1; //get off negative, range 0 - 2
                    randomPan *= 50; // range 0 - 100
                    showDrop(samplePathsSines[i], randomPan);
                }, interval)

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
            let sampleInterval = setInterval(function () {
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
                let sampleInterval = setInterval(function () {
                    var randomPan = (Math.ceil(Math.random() * 99) * (Math.round(Math.random()) ? 1 : -1)) / 100;
                    playSample(response[i], 0, false, randomPan);
                    console.log('now playing FX ' + interval);
                }, interval)

                nowPlayingIntervals.push(sampleInterval);
            })(i, interval);

            console.log('initing note ' + i + ' on interval ' + interval);
        }
    });

    // set start time
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
            if (Math.abs(randomSineIntervals[i] - randomNumber) < 2000) {
                console.log('rechoosing random... diff was ' + Math.abs(randomSineIntervals[i] - randomNumber));
                randomNumber = randomIntFromInterval(min, max, type, true);
            }
        }

        if (!isDeep)
            randomSineIntervals.push(randomNumber);
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
    } else {
        sampleSource.connect(gainNode);
    }

    sampleSource.start(time);

    //console.log('sample started and connected to gain node');
    if (loop)
        nowPlaying.push(sampleSource);

    return sampleSource;
}

function showDrop(sampleName, xValue) {
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
    }, 5500);
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

    var timetext = 'listened for ';
    if (hours == 1) {
        timetext += '1 hour';
    } else if (hours > 1) {
        timetext += (hours + ' hours');
    }

    if (hours > 0 && minutes > 0) {
        timetext += ', ';
    }

    if (minutes == 1) {
        timetext += '1 minute';
    } else if (minutes > 1) {
        timetext += (minutes + ' minutes');
    }

    if (hours > 0 || minutes > 0) {
        $('.time').text(timetext);
    };
    setTimeout(displayTimeElapsed, 5000);

}