(function() {
  var adsManager,
      adsLoader,
      adDisplayContainer,
      intervalTimer,
      playButton,
      skipButton,
      videoContent,
      remainingTimeContainer,
      remainingTimeDisplay,
      adInit = false,
      adLoaded = false,
      adStarted = false;

  init();

  function init() {
    playButton             = document.getElementById('playButton');
    skipButton             = document.getElementById('skipButton');
    videoContent           = document.getElementById('contentElement');
    remainingTimeDisplay   = document.getElementById('remainingTimeDisplay');
    remainingTimeContainer = document.getElementById('remainingTimeContainer');
    
    playButton.addEventListener('click', playAds);
    skipButton.addEventListener('click', skipAds);
    fullscreenButton.addEventListener('click', fullscreenAds);
    setUpIMA();
  }

  function setUpIMA() {
    google.ima.settings.setVpaidMode(google.ima.ImaSdkSettings.VpaidMode.INSECURE);
    createAdDisplayContainer();
    adsLoader = new google.ima.AdsLoader(adDisplayContainer);
    adsLoader.addEventListener(google.ima.AdsManagerLoadedEvent.Type.ADS_MANAGER_LOADED, onAdsManagerLoaded, false);
    adsLoader.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, onAdError, false);

    var contentEndedListener = function() {adsLoader.contentComplete();};
    videoContent.onended = contentEndedListener;

    // Request video ads.
    var adsRequest = new google.ima.AdsRequest();
    adsRequest.adsResponse = getAdTag({ clientURL: getRelativePath('vpaid-client.js') }).trim();
    adsRequest.linearAdSlotWidth = 640;
    adsRequest.linearAdSlotHeight = 400;
    adsLoader.requestAds(adsRequest);
  }


  function createAdDisplayContainer() {
    adDisplayContainer = new google.ima.AdDisplayContainer(document.getElementById('adContainer'), videoContent);
  }

  function playAds() {
    videoContent.load();
    adDisplayContainer.initialize();

    if(!adInit && !adLoaded && !adStarted) {
      try {
        adsManager.init(640, 360, google.ima.ViewMode.NORMAL);
        adsManager.start();
        adInit = true;
      } catch (adError) {
        videoContent.play();
      }
    } else if(playButton.innerHTML == 'Play') {
      adsManager.resume();
    } else if(playButton.innerHTML == 'Pause') {
      adsManager.pause();
    }

    playButton.innerHTML = playButton.innerHTML == 'Play' ? 'Pause' : 'Play';
  }

  function skipAds() {
    if(adInit && adLoaded && adStarted) {
      adsManager.skip();
    }
  }

  function fullscreenAds() {
    var existingDimensions = contentElement.getBoundingClientRect();

    adsManager.resize(window.innerWidth, window.innerHeight, google.ima.ViewMode.FULLSCREEN);

    document.addEventListener('keydown', function escapeFullscreen(evt) {
      if(evt.key == 'Escape' || evt.key == 'Esc' || evt.keyCode == 27) {
        document.removeEventListener('keydown', escapeFullscreen);
        adsManager.resize(existingDimensions.width, existingDimensions.height, google.ima.ViewMode.NORMAL);
      }
    });
  }

  function onAdsManagerLoaded(adsManagerLoadedEvent) {
    // Get the ads manager.
    var adsRenderingSettings = new google.ima.AdsRenderingSettings();
    adsRenderingSettings.restoreCustomPlaybackStateOnAdBreakComplete = true;
    // videoContent should be set to the content video element.
    adsManager = adsManagerLoadedEvent.getAdsManager(videoContent, adsRenderingSettings);

    // Add listeners to the required events.
    adsManager.addEventListener(google.ima.AdErrorEvent.Type.AD_ERROR, onAdError);
    adsManager.addEventListener(google.ima.AdEvent.Type.CONTENT_PAUSE_REQUESTED, onContentPauseRequested);
    adsManager.addEventListener(google.ima.AdEvent.Type.CONTENT_RESUME_REQUESTED, onContentResumeRequested);
    adsManager.addEventListener(google.ima.AdEvent.Type.ALL_ADS_COMPLETED, onAdEvent);

    // Listen to any additional events, if necessary.
    adsManager.addEventListener(google.ima.AdEvent.Type.CLICK, onAdEvent);
    adsManager.addEventListener(google.ima.AdEvent.Type.LOADED, onAdEvent);
    adsManager.addEventListener(google.ima.AdEvent.Type.STARTED, onAdEvent);
    adsManager.addEventListener(google.ima.AdEvent.Type.SKIPPED, onAdEvent);
    adsManager.addEventListener(google.ima.AdEvent.Type.PROGRESS, onAdEvent);
    adsManager.addEventListener(google.ima.AdEvent.Type.COMPLETE, onAdEvent);
    adsManager.addEventListener(google.ima.AdEvent.Type.MIDPOINT, onAdEvent);
    adsManager.addEventListener(google.ima.AdEvent.Type.FIRST_QUARTILE, onAdEvent);
    adsManager.addEventListener(google.ima.AdEvent.Type.THIRD_QUARTILE, onAdEvent);
    adsManager.addEventListener(google.ima.AdEvent.Type.DURATION_CHANGE, onAdEvent);
  }

  function onAdEvent(adEvent) {
    console.log('onAdEvent', adEvent);
    var ad = adEvent.getAd();
    switch (adEvent.type) {
      case google.ima.AdEvent.Type.LOADED:
        adLoaded = true;
        
        if (!ad.isLinear()) {
          videoContent.play();
        }
        break;

      case google.ima.AdEvent.Type.STARTED:
        if (ad.isLinear()) {
          adStarted = true;
          intervalTimer = setInterval(
              function() {
                var remainingTime = adsManager.getRemainingTime();
                remainingTimeDisplay.innerHTML = remainingTime.toFixed(2);
              },
              300); // every 300ms
        }
        break;

      case google.ima.AdEvent.Type.SKIPPED:
        onAdEnded();
        break;

      case google.ima.AdEvent.Type.COMPLETE:
        if (ad.isLinear()) {
          onAdEnded();
        }
        break;
    }
  }

  function onAdError(adErrorEvent) {
    console.log(adErrorEvent.getError());
    if(adsManager) {
      adsManager.destroy();
    }
  }

  function onContentPauseRequested() {
    videoContent.pause();
  }

  function onContentResumeRequested() {
    videoContent.play();
  }

  function onAdEnded() {
    clearInterval(intervalTimer);
    remainingTimeContainer.style.display = 'none';
  }

  function getRelativePath(resourceName) {
    var path = location.href.split('/');

    if(path.length) {
      filename = path[path.length - 1];
      return location.href.replace(filename, resourceName);
    }

    return '';
  }
})();