(function() {
  const DEFAULT_VIDEO_URL = 'http://cdn.visiblemeasures.com/ad_assets/p/demo/ComputerFair1982.mp4';
  const DEFAULT_CLICK_THROUGH = 'http://www.yahoo.com/';
  const DEFAULT_CLIENT_URL = 'vpaid-client.js';

  window.getAdTag = ({ videoURL = DEFAULT_VIDEO_URL, clickThrough = DEFAULT_CLICK_THROUGH, clientURL = DEFAULT_CLIENT_URL }) => {
    return getAdTagXML(videoURL, clickThrough, clientURL);
  };

  function getAdTagXML(VIDEO_URL, CLICK_THROUGH, VPAID_CLIENT) {
    return (
      `
        <?xml version="1.0" encoding="UTF-8"?>
        <VAST version="2.0">
          <Ad id="601364">
            <InLine>
              <AdSystem>VPAID Example</AdSystem>
              <AdTitle>VAST 2.0 Instream Test 1</AdTitle>
              <Description>VAST 2.0 Instream Test 1</Description>
              <Creatives>
                <Creative AdID="601364">
                  <Linear>
                    <Duration>00:00:30</Duration>
                    <AdParameters>
                      <![CDATA[
                        {
                          "videoURL": "${VIDEO_URL}",
                          "clickThrough": "${CLICK_THROUGH}"
                        }
                      ]]>
                    </AdParameters>
                    <MediaFiles>
                      <MediaFile apiFramework="VPAID" width="640" height="360" type="application/javascript" delivery="progressive">
                        ${VPAID_CLIENT}
                      </MediaFile>
                    </MediaFiles>
                  </Linear>
                </Creative>
              </Creatives>
            </InLine>
          </Ad>
        </VAST>
      `
    )
  }
})();

