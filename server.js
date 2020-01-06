#!/usr/bin/env node

var torrentStream = require("torrent-stream");
var express = require("express");
var request = require("request").defaults({ encoding: null });
var app = express();
var server = require("http").Server(app);
var io = require("socket.io")(server);
var os = require("os");
var del = require("del");
var mime = require("mime");
var archiver = require("archiver");
const axios = require("axios");

var client, url;

var DIR = os.tmpdir() + "/torrent-web-poc";
var PORT = parseArg("--port") || parseArg("-p") || process.env.PORT || 80;

server.listen(PORT);
app.use(express.static(__dirname + "/public"));
console.log("Torrent Web started on port " + PORT + " ...");

//===============================
// API
//===============================

io.on("connection", function(socket) {
  console.log("New socket connection.");
  if (client && client.files.length)
    socket.emit("torrent", torrentRepresentation());
  else socket.emit("no-torrent");
  socket.on("add-torrent", addTorrent);
  socket.on("remove-torrent", removeTorrent);
});

app.get("/torrent/:filename", function(req, res) {
  console.log("Torrent file request.");
  var file = findFile(req.params.filename);
  if (file) {
    var stream = file.createReadStream();
    res.set("Content-Type", mime.lookup(file.name));
    res.set("Content-Length", file.length);
    stream.pipe(res);
  } else res.status(404).end();
});

app.get("/torrent/", function(req, res) {
  var archive = archiver.create("zip", {});
  var filename = client.torrent.name + ".zip";
  res.set("Content-Type", "application/zip");
  res.set("Content-disposition", "attachment; filename=" + filename);
  archive.pipe(res);
  client.files.forEach(function(file) {
    archive.append(file.createReadStream(), { name: file.path });
  });
  archive.finalize();
});

app.get("/magnet/", function(req, res) {
  try {
    addTorrent(req.query.magnet_link);
    res.send("success!");
  } catch (err) {
    res.send("error!" + err);
  }
});

app.get("/piratebay/", async function(req, res) {
  try {
    let url = req.query.url;

    const response = await axios.get(url);
    const magnetUrl = response.data.match(
      /(?<=url\('\/static\/img\/icons\/icon-magnet\.gif'\);" href=)(["'])(?:(?=(\\?))\2.)*?\1/g
    );
    const formattedMargnetUrl = magnetUrl[0].substring(
      1,
      magnetUrl[0].length - 1
    );

    addTorrent(formattedMargnetUrl);
    res.send("success!");
  } catch (err) {
    res.send("response returned an error: ", err);
  }
});

//===============================
// Main functions
//===============================

function findFile(filename) {
  var f = null;
  client.files.forEach(function(file) {
    if (file.name === filename) f = file;
  });
  return f;
}

function addTorrent(incoming) {
  removeTorrent();
  url = incoming;
  if (url.indexOf("magnet:") === 0) createTorrentEngine(url);
  else {
    request.get(url, function(err, res, body) {
      createTorrentEngine(body);
    });
  }
}

function removeTorrent() {
  if (client) {
    console.log("Destroying client.");
    client.destroy();
    client = null;

    io.emit("torrent-removed");
  }
  deleteFiles();
}

//===============================
// Helper functions
//===============================

/**
 * Checks process.argv for one beginning with arg+'='
 * @param {string} arg
 */
function parseArg(arg) {
  for (var i = 0; i < process.argv.length; i++) {
    var val = process.argv[i];
    if (startsWith(val, arg + "=")) return val.substring(arg.length + 1);
  }
  function startsWith(string, beginsWith) {
    return string.indexOf(beginsWith) === 0;
  }
}

function deleteFiles() {
  setTimeout(function() {
    del.sync(DIR + "/**", { force: true });
  }, 1000);
}

function createTorrentEngine(torrent) {
  try {
    client = torrentStream(torrent, {
      uploads: 10,
      connections: 200,
      path: DIR
    });
    client.ready(torrentReady);
  } catch (e) {
    console.log("Error creating torrent", e);
    io.emit("bad-torrent");
  }
}

function torrentReady() {
  io.emit("torrent", torrentRepresentation());
  console.log("client:", client);
}

function simplifyFilesArray(files) {
  return files.map(function(file) {
    return {
      name: file.name,
      path: file.path,
      length: file.length
    };
  });
}

function torrentRepresentation() {
  return {
    url: url,
    name: client.torrent.name,
    comment: client.torrent.comment,
    infoHash: client.infoHash,
    files: simplifyFilesArray(client.files)
  };
}
