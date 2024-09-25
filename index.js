function SekiroClient(wsURL) {
  this.wsURL = wsURL;
  this.handlers = {};
  this.socket = {};
  // check
  if (!wsURL) {
    throw new Error('wsURL can not be empty!!')
  }
  this.webSocketFactory = this.resolveWebSocketFactory();
  this.connect()
}

SekiroClient.prototype.resolveWebSocketFactory = function () {
  if (typeof window === 'object') {
    var theWebSocket = window.WebSocket ? window.WebSocket : window.MozWebSocket;
    return function (wsURL) {

      function WindowWebSocketWrapper(wsURL) {
        this.mSocket = new theWebSocket(wsURL);
      }

      WindowWebSocketWrapper.prototype.close = function () {
        this.mSocket.close();
      };

      WindowWebSocketWrapper.prototype.onmessage = function (onMessageFunction) {
        this.mSocket.onmessage = onMessageFunction;
      };

      WindowWebSocketWrapper.prototype.onopen = function (onOpenFunction) {
        this.mSocket.onopen = onOpenFunction;
      };
      WindowWebSocketWrapper.prototype.onclose = function (onCloseFunction) {
        this.mSocket.onclose = onCloseFunction;
      };

      WindowWebSocketWrapper.prototype.send = function (message) {
        this.mSocket.send(message);
      };

      return new WindowWebSocketWrapper(wsURL);
    }
  }
  if (typeof weex === 'object') {
    // this is weex env : https://weex.apache.org/zh/docs/modules/websockets.html
    try {
      console.log("test webSocket for weex");
      var ws = weex.requireModule('webSocket');
      console.log("find webSocket for weex:" + ws);
      return function (wsURL) {
        try {
          ws.close();
        } catch (e) {
        }
        ws.WebSocket(wsURL, '');
        return ws;
      }
    } catch (e) {
      console.log(e);
      //ignore
    }
  }
  //TODO support ReactNative
  if (typeof WebSocket === 'object') {
    return function (wsURL) {
      return new theWebSocket(wsURL);
    }
  }
  // weex 和 PC环境的websocket API不完全一致，所以做了抽象兼容
  throw new Error("the environment do not support websocket");
};

SekiroClient.prototype.connect = function () {
  console.log('sekiro: begin of connect to wsURL: ' + this.wsURL);
  var _this = this;
  try {
    this.socket = this.webSocketFactory(this.wsURL);
  } catch (e) {
    console.log("sekiro: create connection failed,reconnect after 2s:" + e);
    setTimeout(function () {
      _this.connect()
    }, 2000)
    return;
  }

  this.socket.onmessage(function (event) {
    _this.handleSekiroRequest(event.data)
  });

  this.socket.onopen(function (event) {
    console.log('sekiro: open a sekiro client connection')
  });

  this.socket.onclose(function (event) {
    console.log('sekiro: disconnected ,reconnection after 2s');
    setTimeout(function () {
      _this.connect()
    }, 2000)
  });
};

SekiroClient.prototype.handleSekiroRequest = function (requestJson) {
  console.log("receive sekiro request: " + requestJson);
  var request = JSON.parse(requestJson);
  var seq = request['__sekiro_seq__'];

  if (!request['action']) {
    this.sendFailed(seq, 'need request param {action}');
    return
  }
  var action = request['action'];
  if (!this.handlers[action]) {
    this.sendFailed(seq, 'no action handler: ' + action + ' defined');
    return
  }

  var theHandler = this.handlers[action];
  var _this = this;
  try {
    theHandler(request, function (response) {
      try {
        _this.sendSuccess(seq, response)
      } catch (e) {
        _this.sendFailed(seq, "e:" + e);
      }
    }, function (errorMessage) {
      _this.sendFailed(seq, errorMessage)
    })
  } catch (e) {
    console.log("error: " + e);
    _this.sendFailed(seq, ":" + e);
  }
};

SekiroClient.prototype.sendSuccess = function (seq, response) {
  var responseJson;
  if (typeof response == 'string') {
    try {
      responseJson = JSON.parse(response);
    } catch (e) {
      responseJson = {};
      responseJson['data'] = response;
    }
  } else if (typeof response == 'object') {
    responseJson = response;
  } else {
    responseJson = {};
    responseJson['data'] = response;
  }

  if (Array.isArray(responseJson) || typeof responseJson == 'string') {
    responseJson = {
      data: responseJson,
      code: 0
    }
  }

  if (responseJson['code']) {
    responseJson['code'] = 0;
  } else if (responseJson['status']) {
    responseJson['status'] = 0;
  } else {
    responseJson['status'] = 0;
  }
  responseJson['__sekiro_seq__'] = seq;
  var responseText = JSON.stringify(responseJson);
  console.log("response :" + responseText);
  this.socket.send(responseText);
};

SekiroClient.prototype.sendFailed = function (seq, errorMessage) {
  if (typeof errorMessage != 'string') {
    errorMessage = JSON.stringify(errorMessage);
  }
  var responseJson = {};
  responseJson['message'] = errorMessage;
  responseJson['status'] = -1;
  responseJson['__sekiro_seq__'] = seq;
  var responseText = JSON.stringify(responseJson);
  console.log("sekiro: response :" + responseText);
  this.socket.send(responseText)
};

SekiroClient.prototype.registerAction = function (action, handler) {
  if (typeof action !== 'string') {
    throw new Error("an action must be string");
  }
  if (typeof handler !== 'function') {
    throw new Error("a handler must be function");
  }
  console.log("sekiro: register action: " + action);
  this.handlers[action] = handler;
  return this;
};

const GROUP_NAME = 'wpsxhs'
const MY_MODULE_NAME = 'wpsmodule'

// const client = new SekiroClient(`wss://sekiro.iinti.cn:5612/business/register?group=${GROUP_NAME}&clientId=${Math.random()}`);
const client = new SekiroClient("ws://127.0.0.1:5612/business/register?group=wpsxhs&clientId=" + Math.random());

async function hookjs() {
  return new Promise((resolve, reject) => {

    let runtimeMainScript = null
    Array.from(document.head.getElementsByTagName('script')).forEach((script) => {
      if (script.src && script.src.includes('runtime-main')) {
        console.log('Found script with runtime-main:', script.src)

        runtimeMainScript = script
      }
    })
    
    if (!runtimeMainScript) {
      return reject('Failed to find runtime-main script')
    }

    const runtimeMainUrl = runtimeMainScript.src
    fetch(runtimeMainUrl).then(response => response.text()).then(scriptContent => {
      const regex = /function\s+(\w+)\s*\(/g
      // 匹配函数名
      const matches = regex.exec(scriptContent)
      let funcName = 'u'
      
      if (matches && matches.length > 1) {
        funcName = matches[1]
        console.log('matched function name: ', funcName)
      }
      
      const newsriptContent = scriptContent.replace('"use strict";', `"use strict";window.myxhs = ${funcName};`)

      const newScript = document.createElement('script')
      newScript.textContent = newsriptContent

      document.head.appendChild(newScript)

      resolve()
    }).catch(err => {
      reject('runtime-main fetch error')
    })
  })
}

function findApiKey() {
  for (let obj of webpackChunkxhs_pc_web) {
    if(obj[1]) {
      for (let key in obj[1]) {
        const funcStr = obj[1][key].toString()
  
        if (funcStr.indexOf('【web】- homefeed') > -1) {
          console.log('key', key)
          
          return key
        }
      }
    }
  }
}

function getUrlMap(apiObj) {
  const urlMap = {}
  const urls = [
    '"/api/sns/web/v1/homefeed"',
    '"/api/sns/web/v1/feed"',
    '"/api/sns/web/v2/comment/page"',
    '"/api/sns/web/v1/search/notes"',
    '"/api/sns/web/v1/search/onebox"'
  ]

  urls.forEach(url => {
    const urlName = url.replace(/"/g, '').replace('/api/sns/web/v1/', '').replace('/api/sns/web/v2/', '')

    for (let key in apiObj) {
      const funcStr = apiObj[key].toString()
      if (funcStr.indexOf(url) > -1) {
        urlMap[urlName] = key
      }
    }
  })

  return urlMap
}

function injectMyModule() {
  myxhs.m[MY_MODULE_NAME] = (module, exports, require) => {
    const apiKey = findApiKey() || 27171
    const api = require(apiKey);
    console.log(apiKey)
    
    const urlMap = getUrlMap(api)
    console.log(urlMap)
  
    exports.getNextPageData = (noteIndex = 35) => {
      const cursor_score = localStorage.getItem('HOME_FEED_CURSOR_SCORE') || '';
      const param = { "cursor_score": cursor_score, "num": 20, "refresh_type": 3, "note_index": noteIndex, "unread_begin_note_id": "", "unread_end_note_id": "", "unread_note_count": 0, "category": "homefeed_recommend", "search_key": "", "need_num": 10, "image_formats": ["jpg", "webp", "avif"], "need_filter_image": false }
  
      return api[urlMap['homefeed']](param)
    }
  
    exports.getNoteDetail = (noteId) => {
      const param = { "source_note_id": noteId, "image_formats": ["jpg", "webp", "avif"], "extra": { "need_body_topic": "1" } }
  
      return api[urlMap['feed']](param)
    }
  
    exports.getComment = (noteId) => {
      const params = {
        "noteId": noteId,
        "cursor": "",
        "topCommentId": "",
        "imageFormats": "jpg,webp,avif"
      }
  
      return api[urlMap['comment/page']]({ params })
    }

    exports.search = (keyword) => {
      const param = {"keyword": keyword,"search_id":"2dh0sp2hw93sh2rkkrear","biz_type":"web_search_user","request_id":"2075357442-1720504968723"}
      api[urlMap['search/onebox']](param)
      
      const params = {"keyword": keyword,"page":1,"page_size":20,"search_id":"2dh0sp2hw93sh2rkkrear","sort":"general","note_type":0,"ext_flags":[],"image_formats":["jpg","webp","avif"]}
  
      return api[urlMap['search/notes']](params)
    }
  }
}

function registerAction() {
  const myModule = myxhs(MY_MODULE_NAME)

  client.registerAction('nextPage', (request, resolve, reject) => {
    const noteIndex = request.index
  
    myModule.getNextPageData(Number(noteIndex)).then(resolve)
  })
  
  client.registerAction('noteDetail', (request, resolve, reject) => {
    const noteId = request.id
  
    myModule.getNoteDetail(noteId).then(resolve)
  })
  
  client.registerAction('comment', (request, resolve, reject) => {
    const noteId = request.id
  
    myModule.getComment(noteId).then(resolve)
  })

  client.registerAction('search', (request, resolve, reject) => {
    const keyword = request.keyword
  
    myModule.search(keyword).then(resolve).catch(resolve)
  })
}

function checkIsReady() {
  const myModule = myxhs(MY_MODULE_NAME)

  if (myModule.getNextPageData && myModule.getNoteDetail && myModule.getComment) {
    return true
  }

  return false
}

async function init() {
  try {
    await hookjs()
  
    injectMyModule()
  
    registerAction()
  
    if(checkIsReady()) {
      alert('小红书网页端已准备就绪')
    }else {
      alert('未知错误，请稍后再试')
    }
  } catch (error) {
    alert(error)
  }
}

init()
