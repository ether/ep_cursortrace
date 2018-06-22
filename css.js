exports.eejsBlock_styles = function (hook_name, args, cb) {
  args.content = args.content + "<link href='../static/plugins/ep_cursortrace/static/css/follow_user.css' rel='stylesheet'>";
  return cb();
}
