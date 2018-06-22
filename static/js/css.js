exports.aceEditorCSS = function(hook_name, cb){
  return ["/ep_cursortrace/static/css/cursortrace.css"]; // inner pad CSS
}

exports.aceInitInnerdocbodyHead = function(hook_name, args, cb) {
  args.iframeHTML.push('<link rel="stylesheet" type="text/css" href="../static/plugins/ep_cursortrace/static/css/ace_inner.css"/>');
  return cb();
};
