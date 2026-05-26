let serveStatic = require("serve-static");

let StaticInitFunc = function (RED) {
  function StaticNode(config) {
    RED.nodes.createNode(this, config);

    // Add project directory to the message if available
    var s = RED.settings;
    var p = s ? s.get('projects') : null;
    var projectdir = null;
    if (s && s.userDir && p && p.activeProject) {
      projectdir = s.userDir + "/projects/" + p.activeProject;
    }

    var node = this;
    var folder = projectdir ? projectdir + "/" + config.folder : config.folder;
    var serve = serveStatic(folder, {
      index: ["index.html", "index.htm"],
    });

    node.on("input", function (msg) {
      msg.req.pathname = msg.req.path = msg.req.url = `/${msg.req.path
        .replace(msg.req.baseUrl, "")
        .replace(msg.req.path.match(msg.req.route.path)[0], "")}`;
      serve(msg.req, msg.res._res, function () {
        node.send(msg);
      });
    });
  }
  RED.nodes.registerType("static", StaticNode);
};

module.exports = StaticInitFunc;
