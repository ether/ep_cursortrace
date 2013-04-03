/*
exports.eejsBlock_styles = function (hook_name, args, cb) {
  args.content = args.content + "<link href='../static/plugins/ep_cursortrace/static/css/cursortrace.css' rel='stylesheet'>";
  return cb();
}
*/
exports.aceEditorCSS = function(hook_name, cb){return ["/ep_cursortrace/static/css/cursortrace.css"];} // inner pad CSS

