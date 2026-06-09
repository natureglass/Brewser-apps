System.register(["./application.js"], function (_export, _context) {
  "use strict";

  var Application, canvas, $p, bcr, application;
  function topLevelImport(url) {
    return System["import"](url);
  }
  return {
    setters: [function (_applicationJs) {
      Application = _applicationJs.Application;
    }],
    execute: function () {
      canvas = document.getElementById('GameCanvas');
      // 2026-06-08 ROUND 46: enter fullscreen automatically on game launch
      // so users don't need to double-tap the chrome strip first. Engine
      // implements canvas.requestFullscreen() via the swb shell. AWAIT the
      // mode flip BEFORE reading parent BCR so canvas.width/height get the
      // fullscreen pixel dims from the start (Cocos sizes its render target
      // to canvas.width × canvas.height at init).
      var fullscreenP = (typeof canvas.requestFullscreen === 'function')
        ? canvas.requestFullscreen()["catch"](function () {})
        : Promise.resolve();
      return fullscreenP.then(function () {
        $p = canvas.parentElement;
        bcr = $p.getBoundingClientRect();
        canvas.width = bcr.width;
        canvas.height = bcr.height;
        application = new Application();
        return topLevelImport('cc').then(function (engine) {
          return application.init(engine);
        }).then(function () {
          return application.start();
        });
      })["catch"](function (err) {
        console.error(err);
      });
    }
  };
});