  let params     = new URLSearchParams(document.location.search.substring(1));
  let accountId  = params.get('accountId');
  let streamName = params.get('streamName');
  let screenShare = streamName + "SS";
  let subToken = params.get('token');// SubscribingToken - placed here for ease of testing, should come from secure location. (php/nodejs)
  let lang = document.getElementById('subtitles');
  console.log('Millicast Viewer Stream: ', streamName);
  let player1 = "https://robertdev.influxis.com/millicast/2020b/player/main.html?accountId=" + accountId + "&streamName=" + streamName ;   
  let player2 = "https://robertdev.influxis.com/millicast/2020b/player/screenshare.html?accountId=" + accountId + "&streamName=" + screenShare;
  //let vidFrm = document.getElementByTagName('iframe').src = player2;
 
  //Millicast required info.
  let url;// path to Millicast Server - Returned from API
  let jwt;//authorization token - Returned from API

  let pc;//peer connection
  let ws;//live websocket
  let reconn = false;// flag for reconnection

  //let ws_viewers; // viewer count
  //const streamEventsUrl = 'wss://streamevents.millicast.com/ws';
  const apiPath  = 'https://director.millicast.com/api/director/subscribe';
  const turnUrl  = 'https://turn.millicast.com/webrtc/_turn';

  //Ice Servers:<video id="player" autoplay muted playsinline src="' + player1 + '"></video>
  let iceServers = [];
  //document.getElementsByTagName('iframe').src = player2;
  //document.write('<div class="wrapper"><video id="player"  autoplay muted playsinline src="' + player1 + '"></video>');
  document.write('<iframe id="screenshare" frameborder="0" scrolling="no" allowfullscreen autoplay muted playsinline src="' + player2 + '"></iframe>');
  function bindEvent(element, eventName, eventHandler) {
            if (element.addEventListener){
                element.addEventListener(eventName, eventHandler, false);
            } else if (element.attachEvent) {
                element.attachEvent('on' + eventName, eventHandler);
            }
        }



  //let iframe =document.createElement('iframe');
  //iframe.setAttribute('src', player2);
  //iframe.setAttribute('id', 'player2');
  //document.body.appendChild(iframe);

function connect() {
    reconn = false;
    if (!url) {
      showMsg('Authenticating...');
      console.log('connect need path to server - url:', url);
      updateMillicastAuth()
        .then(d => {
          connect();
        })
        .catch(e => {
          console.log('api error: ', e);
          showMsg(e.status+': '+e.data.message);
          alert("Error: The API encountered an error ", d);
        });
      return;
    }
    showMsg('Connecting...');

    console.log('connecting to: ', url);
    //create Peer connection object
    let conf = {
      iceServers:    iceServers,
      // sdpSemantics : "unified-plan",
      rtcpMuxPolicy: "require",
      bundlePolicy:  "max-bundle"
    };
    console.log('config: ', conf);
    pc     = new RTCPeerConnection(conf);
    //Listen for track once it starts playing.
    pc.ontrack = function (event) {
      console.debug("pc::onAddStream", event);
      //Play it
      let vidWin = document.getElementsByTagName('video')[0];
      let vidFrm = document.getElementsByTagName('iframe')[0];
      if (vidWin) {
        vidWin.srcObject = event.streams[0];
        vidWin.controls  = true;
      }
       if (vidFrm) {
        vidFrm.srcObject = event.streams[0];
        vidFrm.controls  = true;
      }
    };
    pc.onconnectionstatechange = function(e) {
      console.log('PC state:',pc.connectionState);
      switch(pc.connectionState) {
        case "connected":
          break;
        case "disconnected":
        case "failed":
          break;
        case "closed":
          console.log('WS onclose ',reconn);
          // Connection closed, if reconnecting? reset and call again.
          if(reconn){
            pc = null;
            if(!ws){
              connect();
            }
          }
          break;
      }
    }

    console.log('connecting to: ', url + '?token=' + jwt);//token
    //connect with Websockets for handshake to media server.
    ws    = new WebSocket(url + '?token=' + jwt);
    ws.onopen = function () {
      //Connect to our media server via WebRTC
      console.log('ws::onopen');

      //create a WebRTC offer to send to the media server
      let offer = pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true })
        .then(desc => {
          console.log('createOffer Success!');
          //support for stereo
          desc.sdp = desc.sdp.replace("useinbandfec=1", "useinbandfec=1; stereo=1");
          //try for multiopus (surround sound) support
          try {
            desc.sdp = setMultiopus(desc);
          } catch(e){
            console.log('create offer stereo',offer);
          }
          
          //set local description and send offer to media server via ws.
          pc.setLocalDescription(desc)
            .then(() => {
              console.log('setLocalDescription Success!');
              //set required information for media server.
              let data    = {
                streamId: accountId,//Millicast accountId
                sdp:      desc.sdp
              }
              //create payload
              let payload = {
                type:    "cmd",
                transId: 0,
                name:    'view',
                data:    data
              }
              console.log('send ', payload);
              ws.send(JSON.stringify(payload));
            })
            .catch(e => {
              console.log('setLocalDescription failed: ', e);
              showMsg(e.status+': '+e.data.message);
            })
        }).catch(e => {
          console.log('createOffer Failed: ', e)
          showMsg(e.status+': '+e.data.message);
        });
    }
    ws.onclose = function () {
      console.log('WS onclose ',reconn);
      if(reconn){
        ws = null;
        if(!pc){
          setTimeout(connect(),700);
        } else {
          console.log('close PC ',pc);
          pc.close();
          pc = null;
          setTimeout(connect(),700);
        }
      }
    }
    ws.addEventListener('message', evt => {
      console.log('ws::message', evt);
      let msg = JSON.parse(evt.data);
      switch (msg.type) {
        //Handle counter response coming from the Media Server.
        case "response":
          let data   = msg.data;
          let remotesdp = data.sdp ;

          /* handle older versions of Safari */
          if (remotesdp && remotesdp.indexOf('\na=extmap-allow-mixed') !== -1) {
            remotesdp = remotesdp.split('\n').filter(function (line) {
              return line.trim() !== 'a=extmap-allow-mixed';
            }).join('\n');
            console.log('trimed a=extmap-allow-mixed - sdp \n',remotesdp);
          }
          let answer = new RTCSessionDescription({
                                                   type: 'answer',
                                                   sdp:  remotesdp
                                                 });

         // +  "a=MID:video\r\nb=AS:" + 2000 +"\r\n",

          pc.setRemoteDescription(answer)
            .then(d => {
              console.log('setRemoteDescription  Success! ');
              showMsg('');
            })
            .catch(e => {
              console.log('setRemoteDescription failed: ', e);
              showMsg(e.status+': '+e.data.message);
            });
          break;
        case "event":
          if(msg.name === 'inactive'){
            console.log('Video Inactive');
            showMsg('Stream inactive, please stand by...');
          } else if(msg.name === 'active'){
            console.log('Video Active');
            showMsg('');//clear message
          } else if( msg.name === 'stopped'){
            console.log('Video Stopped');
            showMsg('Stream is not available.');
            //todo - reset video object, re-instate handshake. 
            let vidWin = document.getElementsByTagName('video')[0];
            let vidFrm = document.getElementsById('iframe')[0];
            if (vidWin) {
              vidWin.pause();
              vidWin.removeAttribute('src'); // empty source
              vidWin.src = '';
              streaName = streamShare;
              vidWin.load();
              // connect();
              //streaName = streamShare;
              doReconnect();
            }
              if (vidFrm) {
              vidFrm.pause();
              // vidWin.removeAttribute('src'); // empty source
              vidFrm.src = '';
              vidFrm.load();
              // connect()
              streaName = streamShare;
              doReconnect();
            }
          }
          break;
      }
    })
  
  }

  function doReconnect(){
    reconn = true;
    url = null;
    ws.close();
    //pc.close();
    // setTimeout(connect(),700);
  }

  // Gets ice servers.
  function getICEServers() {
    return new Promise((resolve, reject) => {
      let xhr                = new XMLHttpRequest();
      xhr.onreadystatechange = function (evt) {
        if (xhr.readyState == 4) {
          let res = JSON.parse(xhr.responseText), a;
          console.log('getICEServers::status:', xhr.status, ' response: ', xhr.responseText);
          switch (xhr.status) {
            case 200:
              //returns array.
              if (res.s !== 'ok') {
                a = [];
                //failed to get ice servers, resolve anyway to connect w/ out.
                resolve(a);
                return
              }
              let list = res.v.iceServers;
              a        = [];
              //call returns old format, this updates URL to URLS in credentials path.
              list.forEach(cred => {
                let v = cred.url;
                if (!!v) {
                  cred.urls = v;
                  delete cred.url;
                }
                a.push(cred);
                //console.log('cred:',cred);
              });
              console.log('ice: ', a);
              resolve(a);
              break;
            default:
              a = [];
              //reject(xhr.responseText);
              //failed to get ice servers, resolve anyway to connect w/ out.
              resolve(a);
              break;
          }
        }
      }
      xhr.open("PUT", turnUrl, true);
      xhr.send();
    })
  }

  // gets server path and auth token.
  function updateMillicastAuth() {
    console.log('updateMillicastAuth at: ' + apiPath + ' for:', streamName, ' accountId:', accountId);
    return new Promise((resolve, reject) => {
      let xhr                = new XMLHttpRequest();
      xhr.onreadystatechange = function (evt) {
        if (xhr.readyState == 4) {
          let res = JSON.parse(xhr.responseText);
          console.log('res: ', res);
          console.log('status:', xhr.status, ' response: ', xhr.responseText);
          switch (xhr.status) {
            case 200:
              if( res.status !== 'fail' ){
                let d = res.data;
                jwt   = d.jwt;
                url   = d.urls[0];
                resolve(d);
              }
              break;
            default:
              reject(res);
          }
        }
      }
      xhr.open("POST", apiPath, true);
      //apply subscribe token if available.
      if (subToken) {
        xhr.setRequestHeader('Authorization', `Bearer ${subToken}`);
        console.log('sub token applied');
      }
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.send(JSON.stringify({streamAccountId: accountId, streamName: streamName, unauthorizedSubscribe: true}));
    });
  }
  //update screen
  
   function updateMillicastAuthScreen() {
    console.log('updateMillicastAuth at: ' + apiPath + ' for:', screenShare, ' accountId:', accountId);
    return new Promise((resolve, reject) => {
      let xhr                = new XMLHttpRequest();
      xhr.onreadystatechange = function (evt) {
        if (xhr.readyState == 4) {
          let res = JSON.parse(xhr.responseText);
          console.log('res: ', res);
          console.log('status:', xhr.status, ' response: ', xhr.responseText);
          switch (xhr.status) {
            case 200:
              if( res.status !== 'fail' ){
                let z = res.data;
                jwt   = z.jwt;
                url   = z.urls[0];
                resolve(d);
              }
              break;
            default:
              reject(res);
          }
        }
      }
      xhr.open("POST", apiPath, true);
      //apply subscribe token if available.
      if (subToken) {
        xhr.setRequestHeader('Authorization', `Bearer ${subToken}`);
        console.log('sub token applied');
      }
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.send(JSON.stringify({streamAccountId: accountId, screenShare: screenShare, unauthorizedSubscribe: true}));
    });

  }

  function startUserCount(){
    //
    console.log('User Count* ');
    ws_viewers = new WebSocket(streamEventsUrl);
    ws_viewers.onopen = function (evt) {
      console.log('ws_viewers.onopen',evt);
      ws_viewers.send(JSON.stringify( {"arguments":[[acountId/streamName]],"invocationId":"0","streamIds":[],"target":"SubscribeViewerCount","type":1} ));
    }
    ws_viewers.onclose = function (evt) {
      console.log('ws_viewers.onclose',evt);
    }
    ws_viewers.addEventListener('message', evt => {
      console.log('ws_viewers.message', evt);
    })
    ws_viewers.addEventListener('SubscribeViewerCountResponse', evt => {
      console.log('SubscribeViewerCountResponse', evt);
    })
  } 

  //support for multiopus
  function setMultiopus(offer){
    ///// currently chrome only
    let isChromium = window.chrome;
    let winNav = window.navigator;
    let vendorName = winNav.vendor;
    let agent = winNav.userAgent.toLowerCase();
    let isOpera = typeof window.opr !== "undefined";
    let isIEedge = agent.indexOf("edge") > -1;
    let isEdgium = agent.indexOf("edg") > -1;
    let isIOSChrome = agent.match("crios");
    
    let isChrome = false;
    if (isIOSChrome) {
    } else if( isChromium !== null && typeof isChromium !== "undefined" && 
                vendorName === "Google Inc." && isOpera === false && 
                isIEedge === false && isEdgium === false) {
      // is Google Chrome
      isChrome = true;
    }

    console.log('isChrome: ',isChrome);
    if(isChrome){ 
      // console.log('agent: ',navigator.userAgent);
      //Find the audio m-line
      const res = /m=audio 9 UDP\/TLS\/RTP\/SAVPF (.*)\r\n/.exec(offer.sdp);
      //Get audio line
      const audio = res[0];
      //Get free payload number for multiopus
      const pt  = Math.max(...res[1].split(" ").map( Number )) + 1;
      //Add multiopus 
      const multiopus = audio.replace("\r\n"," ") + pt + "\r\n" + 
        "a=rtpmap:" + pt + " multiopus/48000/6\r\n" +
        "a=fmtp:" + pt + " channel_mapping=0,4,1,2,3,5;coupled_streams=2;minptime=10;num_streams=4;useinbandfec=1\r\n";
      //Change sdp
      offer.sdp = offer.sdp.replace(audio,multiopus);
      console.log('create multi-opus offer',offer);
    } else {
      console.log('no multi-opus support');
    }
    return offer.sdp;
  }

  function showMsg(s){
    vidMsg.innerText = s;
    //alert(s);
    //if (s=="Authenticating")
    // iframe.style.display = 'none'; 
  }

  function ready() {
    vidMsg = document.getElementById('msgOverlay');
    let v = document.getElementsByTagName('video')[0];
    let f = document.getElementsByTagName('iframe')[0];

    if (v) {
    v.addEventListener("click", evt => {
    v.play();
    });
    if (f) {
    f.addEventListener("click", evt => {
    f.play();
    });
    }

  }
  function hideiFrame(){

   iframe.style.display = 'none';
  }

    //connect();
    // get a list of Xirsys ice servers.
    getICEServers()
      .then(list => {
        iceServers = list;
        //ready to connect.
        connect();
      });
  }
  if(window.frames[0].document.innerHTML ="Authenticating..." ){
  	//alert('iframe state');
  	document.getElementById("screenshare").style.visibility = "hidden";
  	}else{
  	document.getElementById("screenshare").style.visibility = "visible";
  	}
   if(window.frames[0].document.innerHTML="Connecting" ){	

 	
  }


  if (document.attachEvent ? document.readyState === "complete" : document.readyState !== "loading") {
    ready();
  } else {
    document.addEventListener('DOMContentLoaded', ready);
  }
  //Does the ScreenShare exist

 


  //Manually swith the frames
  function startScreen() {
  //const iframeWindow = ssIframe.contentWindow;
  document.write('<link id="stylesheet" href="../css/viewerSS.css" rel="stylesheet">');
  document.write('<div class="wrapper"><iframe id="player" frameborder="0" scrolling="no"  width="300px" autoplay muted playsinline src="' + player1 + '"></iframe>');
  document.write('<iframe id="screenshare" frameborder="0" overflow-x: hidden; overflow-y: scroll allowfullscreen autoplay muted playsinline src="' + player2 + '"></iframe>');
  document.write('<button type="button" class="screen" onclick="stopScreen()">Stop Screen</button>');
 

   }
  function stopScreen() {
   location.reload();
 }
 
 if (msgOverlay == 'Authenticating...') {
 iframe.style.display = 'none';
    
}