'use strict';
var promise = require('bluebird');
var request = require('request');
var syncRequest = require('sync-request');
var net = require('net');

module.exports = function (RED) {

    //=============== Core =================//
    // Core
    function core(config) {
        RED.nodes.createNode(this, config);
        var context = this.context();
        var node = this;
        this.on('input', function (msg) {

            var sleepModeAktiv = context.get("sleepModeAktiv") || false;
            var sendOverHTTPAktiv = true;
            var mqttMasterTopic = getValue(config.masterTopic, msg) || '';

            // Clean Master Topic
            if (mqttMasterTopic.substr(mqttMasterTopic.length - 1) === "/") {
                mqttMasterTopic = mqttMasterTopic.slice(0, -1);
            }

            // Check is IP Config?!
            if (config.ip === undefined || config.ip === '') {
                sendOverHTTPAktiv = false;
            }

            // This topic sent by all providers to update the data in the context
            if (msg.topic === "screen_data_update") {
                if (msg.screenName !== undefined && msg.duration !== undefined) {
                    context.set(msg.screenName, msg);
                    node.status({
                        fill: "blue",
                        shape: "ring",
                        text: "Screen [" + msg.screenName + "] stored"
                    });
                } else {
                    node.status({
                        fill: "red",
                        shape: "dot",
                        text: "Screen data cannot store!"
                    });
                }
            }

            // Check is SleepMode Aktiv?! (Ab hier ist dann schluß! :-) )
            if (sleepModeAktiv == true && msg.sleepMode == null) {
                node.status({
                    fill: "yellow",
                    shape: "ring",
                    text: "Sleep Mode Aktiv!"
                });
                return;
            }

            // This topic sent by all providers to update the data in the context
            if (msg.topic === "matrix_control") {
                node.status({
                    fill: "grey",
                    shape: "ring",
                    text: "Matrix Control send"
                });

                // SleepMode Steuerung 
                if (msg.sleepMode !== undefined && msg.sleepMode == true) {
                    clearTimeout(context.get("timeout"));
                    sleepModeAktiv = true;
                    context.set("sleepModeAktiv", sleepModeAktiv);
                    SendToPixelItScreen(CreateScreenJson(msg));
                } else if (msg.sleepMode !== undefined && msg.sleepMode == false) {
                    sleepModeAktiv = false;
                    context.set("sleepModeAktiv", sleepModeAktiv);
                    SendToPixelItScreen(CreateScreenJson(msg));
                    GetNextScreen();
                } else if (sleepModeAktiv == false) {
                    SendToPixelItScreen(CreateScreenJson(msg));
                }
            }

            // This topic sent by all providers to update the data in the context
            if (msg.topic === "matrix_config") {
                node.status({
                    fill: "grey",
                    shape: "ring",
                    text: "Matrix Config send"
                });
                SendToPixelItConfig(CreateConfigJson(msg));
            }

            // This topic is sent when the play is updated
            if (msg.topic === "playlist_update") {
                if ("undefined" !== typeof (msg.payload[0]["screenName"])) {
                    context.set("playlist", msg.payload);
                    node.status({
                        fill: "green",
                        shape: "ring",
                        text: "New Playlist stored"
                    });

                    context.set("nowPlay", 0);
                    GetNextScreen();
                } else {
                    node.status({
                        fill: "red",
                        shape: "dot",
                        text: "New Playlist cannot store!"
                    });
                }
            }

            if (msg.topic === "alert_screen") {
                if (context.get("timeout")) {
                    clearTimeout(context.get("timeout"));
                }

                var status = "Displaying alert [No Named] now!";

                if (msg.screenName != null) {
                    status = "Displaying alert [" + msg.screenName + "] now!"
                }

                context.set("timeout", setTimeout(GetNextScreen, (msg.duration * 1000)));
                node.status({
                    fill: "yellow",
                    shape: "ring",
                    text: status
                });
                SendToPixelItScreen(CreateScreenJson(msg));
            }

            function GetNextScreen() {
                var playlist = context.get("playlist");
                if (playlist) {
                    var playlistCount = playlist.length;
                    var nowPlay = context.get("nowPlay") || 0;

                    if (playlistCount > 0) {
                        if (nowPlay >= playlistCount) {
                            nowPlay = 0;
                        }

                        var play = playlist[nowPlay];

                        var screen = context.get(play.screenName);

                        // Wenn ein Screen nicht gefunden oder nicht gezeigt werden soll
                        while (typeof screen === 'undefined' || (typeof screen !== 'undefined' && typeof screen.show !== 'undefined' && screen.show === false)) {
                            nowPlay++;

                            if (nowPlay >= playlistCount) {
                                nowPlay = 0;
                                sleep(200);
                            }

                            play = playlist[nowPlay];

                            screen = context.get(play.screenName);
                        }

                        nowPlay++;
                        context.set("nowPlay", nowPlay);

                        msg = screen;


                        node.status({
                            fill: "green",
                            shape: "ring",
                            text: "Displaying [" + play.screenName + "] now"
                        });

                        if (context.get("timeout")) {
                            clearTimeout(context.get("timeout"));
                        }

                        context.set("timeout", setTimeout(GetNextScreen, (msg.duration * 1000)));
                        SendToPixelItScreen(CreateScreenJson(msg));
                    }
                }
            }

            function CreateScreenJson(msg) {
                var json = '{';

                if (msg.sleepMode !== undefined) {
                    json += '"sleepMode":' + msg.sleepMode + ','
                }
                if (msg.brightness) {
                    json += '"brightness":' + msg.brightness + ','
                }
                if (msg.switchAnimation) {
                    json += '"switchAnimation":{"aktiv":' + msg.switchAnimation.aktiv + ',"animation":"' + msg.switchAnimation.animation + '"},';
                }
                if (msg.clock) {
                    json += '"clock":{"show":' + msg.clock.show + ',"switchAktiv":' + msg.clock.switchAktiv + ', "withSeconds":' + msg.clock.withSeconds + ',"switchSec":' + msg.clock.switchSec + ',"color":{"r":' + msg.clock.color.r + ',"g":' + msg.clock.color.g + ',"b":' + msg.clock.color.b + '}}';
                }
                if (msg.sound) {
                    json += '"sound":{';

                    if (msg.sound.volume) {
                        json += '"volume":' + parseInt(msg.sound.volume);
                    }

                    if (msg.sound.control) {
                        json += ','

                        if (msg.sound.control == "play") {
                            json += '"control":"' + msg.sound.control + '",';

                            if (msg.sound.folder) {
                                json += '"folder":' + parseInt(msg.sound.folder) + ',';
                            }

                            if (msg.sound.file) {
                                json += '"file":' + parseInt(msg.sound.file) + '},';
                            }
                        } else {
                            json += '"control":"' + msg.sound.control + '"},';
                        }
                    }
                }
                if (msg.bitmap) {
                    json += '"bitmap":{"data":' + GetBitMap(msg.bitmap.data) + ',"position":{"x":' + msg.bitmap.position.x + ',"y":' + msg.bitmap.position.y + '},"size":{"width":' + msg.bitmap.size.width + ',"height":' + msg.bitmap.size.height + '}},';
                }
                if (msg.bitmapAnimation) {
                    if (msg.bitmapAnimation.limitLoops === undefined) {
                        msg.bitmapAnimation.limitLoops = 0;
                    }

                    json += '"bitmapAnimation":{"data":[' + GetBitMap(msg.bitmapAnimation.data) + '],"animationDelay":' + msg.bitmapAnimation.animationDelay + ', "rubberbanding":' + msg.bitmapAnimation.rubberbanding + ', "limitLoops":' + Number(msg.bitmapAnimation.limitLoops) + '},';
                }
                if (msg.bar) {
                    json += '"bar":{"position":{"x":' + msg.bar.position.x + ',"y":' + msg.bar.position.y + ',"x2":' + msg.bar.position.x2 + ',"y2":' + msg.bar.position.y2 + '},"color":{"r":' + msg.bar.color.r + ',"g":' + msg.bar.color.g + ',"b":' + msg.bar.color.b + '}},';
                }
                if (msg.bars) {
                    json += '"bars":' + msg.bars + ',';
                }
                if (msg.text) {
                    json += '"text":{"textString":"' + msg.text.textString + '","bigFont":' + msg.text.bigFont + ',';
                    if (msg.text.scrollText) {
                        if ((msg.text.scrollText == "true") || (msg.text.scrollText == "false")) {
                            json += '"scrollText":' + (msg.text.scrollText == "true") + ',';
                        } else {
                            json += '"scrollText":"' + msg.text.scrollText + '",';
                        }

                        if (msg.text.scrollTextDelay) {
                            json += '"scrollTextDelay":' + msg.text.scrollTextDelay + ',';
                        }
                    }
                    if (msg.text.centerText) {
                        json += '"centerText":' + msg.text.centerText + ',';
                    }
                    if (msg.text.position) {
                        json += '"position":{"x":' + msg.text.position.x + ',"y":' + msg.text.position.y + '},';
                    }
                    json += '"color":{"r":' + msg.text.color.r + ',"g":' + msg.text.color.g + ',"b":' + msg.text.color.b + '}}';
                }

                if (json.endsWith(',')) {
                    json = json.substr(0, json.length - 1);
                }
                json += '}'
                return json;
            }

            function CreateConfigJson(msg) {
                var json = '{"matrixtBrightness":' + parseInt(msg.matrixtBrightness) +
                    ',"matrixType":' + parseInt(msg.matrixType) +
                    ',"matrixTempCorrection":"' + msg.matrixTempCorrection +
                    '","ntpServer":"' + msg.ntpServer +
                    '","clockTimeZone":' + msg.clockTimeZone +
                    ',"scrollTextDefaultDelay":' + msg.scrollTextDefaultDelay +
                    ',"bootScreenAktiv":' + (msg.bootScreenAktiv == "true") +
                    ',"mqttAktiv":' + (msg.mqttAktiv == "true") +
                    ',"mqttServer":"' + msg.mqttServer +
                    '","mqttMasterTopic":"' + msg.mqttMasterTopic +
                    '","mqttPort":' + msg.mqttPort +
                    ',"mqttUser":"' + msg.mqttUser +
                    '","mqttPassword":"' + msg.mqttPassword + '"}';
                return json;
            }

            function SendToPixelItConfig(myjson) {
                var result = {
                    topic: mqttMasterTopic + '/setConfig',
                    payload: myjson
                };
                node.send(result);

                if (sendOverHTTPAktiv) {
                    checkConnection(config.ip).then(function () {
                        request({
                            uri: 'http://' + config.ip + '/api/config',
                            method: 'POST',
                            json: false,
                            body: myjson
                        }, function (error, response, body) {});
                    }, function (err) {
                        node.status({
                            fill: "yellow",
                            shape: "dot",
                            text: "Cannot send.."
                        });
                    });
                }
            }

            function SendToPixelItScreen(myjson) {
                var result = {
                    topic: mqttMasterTopic + '/setScreen',
                    payload: myjson
                };
                node.send(result);

                if (sendOverHTTPAktiv) {
                    checkConnection(config.ip).then(function () {
                        request({
                            uri: 'http://' + config.ip + '/api/screen',
                            method: 'POST',
                            json: false,
                            body: myjson
                        }, function (error, response, body) {});

                    }, function (err) {
                        node.status({
                            fill: "yellow",
                            shape: "dot",
                            text: "Cannot send.."
                        });
                    });
                }
            }

            function sleep(millis) {
                return new promise(function (resolve, reject) {
                    setTimeout(function () {
                        resolve();
                    }, millis);
                });
            }

            function checkConnection(ip) {
                return new promise(function (resolve, reject) {
                    var timeout = 1000;
                    var timer = setTimeout(function () {
                        reject("timeout");
                        socket.end();
                    }, timeout);
                    var socket = net.createConnection(80, ip, function () {
                        clearTimeout(timer);
                        resolve();
                        socket.end();
                    });
                    socket.on('error', function (err) {
                        clearTimeout(timer);
                        reject(err);
                    });
                });
            }

            function GetBitMap(input) {
                var webBmp = "[64512,0,0,0,0,0,0,64512,0,64512,0,0,0,0,64512,0,0,0,64512,0,0,64512,0,0,0,0,0,64512,64512,0,0,0,0,0,0,64512,64512,0,0,0,0,0,64512,0,0,64512,0,0,0,64512,0,0,0,0,64512,0,64512,0,0,0,0,0,0,64512]";
                if (input != null) {
                    if (input.includes(",")) {
                        return input;
                    } else {
                        input = input.trim();
                        var bmp = context.get("bmpCache_" + input);

                        if (bmp != null) {
                            return bmp;
                        } else {
                            try {
                                var res = syncRequest('GET', 'https://api.bastelbunker.de/PixelItService/GetBMPByID/' + input, {
                                    headers: {
                                        'User-Agent': 'Node_Red_Core'
                                    },
                                    timeout: 1000
                                });
                                var body = JSON.parse(res.getBody('utf8'));
                            } catch (error) {
                                body = null;
                            }

                            if (body != null && body.id != null && body.id != 0) {
                                webBmp = body.rgB565Array;
                                context.set("bmpCache_" + input, webBmp);
                            }
                        }
                    }
                }
                return webBmp;
            }
        });
    }

    // Alert Screen
    function alertScreen(config) {
        RED.nodes.createNode(this, config);
        var context = this.context();
        var node = this;
        this.on('input', function (msg) {
            msg.topic = "alert_screen";
            node.send(msg);
        });
    }

    // Screen Data Update
    function screenDatatUpdate(config) {
        RED.nodes.createNode(this, config);
        var context = this.context();
        var node = this;
        this.on('input', function (msg) {
            msg.topic = "screen_data_update";
            node.send(msg);
        });
    }

    // Matrix Control
    function matrixControl(config) {
        RED.nodes.createNode(this, config);
        var context = this.context();
        var node = this;
        this.on('input', function (msg) {
            msg.topic = "matrix_control";
            node.send(msg);
        });
    }

    // Playlist Update
    function playlistUpdate(config) {
        RED.nodes.createNode(this, config);
        var context = this.context();
        var node = this;
        this.on('input', function (msg) {
            msg.topic = "playlist_update";
            node.send(msg);
        });
    }

    // Set Config
    function matrixConfig(config) {
        RED.nodes.createNode(this, config);
        var context = this.context();
        var node = this;
        this.on('input', function (msg) {
            msg = config;
            msg.topic = "matrix_config"
            node.send(msg)
        });
    }

    //=============== Options =================//
    // Switch Animation
    function switchAnimation(config) {
        RED.nodes.createNode(this, config);
        var context = this.context();
        var node = this;
        this.on('input', function (msg) {
            msg.switchAnimation = config;

            node.send(msg)
        });
    }

    // Screen Init
    function screenInit(config) {
        RED.nodes.createNode(this, config);
        var context = this.context();
        var node = this;
        this.on('input', function (msg) {
            msg.screenName = config.inscreenName;
            msg.duration = getValue(config.induration, msg);
            node.send(msg)
        });
    }

    // Text
    function text(config) {
        RED.nodes.createNode(this, config);
        var context = this.context();
        var node = this;
        this.on('input', function (msg) {
            msg.text = {};
            msg.text.textString = getValue(config.intextString, msg);
            msg.text.bigFont = config.inbigFont;
            msg.text.scrollText = config.inscrollText;
            msg.text.scrollTextDelay = getValue(config.inscrollTextDelay, msg);
            msg.text.centerText = config.incenterText;
            msg.text.position = {};
            msg.text.position.x = getValue(config.inposX, msg);
            msg.text.position.y = getValue(config.inposY, msg);
            msg.text.color = {};
            msg.text.color.r = getValue(config.incolorR, msg);
            msg.text.color.g = getValue(config.incolorG, msg);
            msg.text.color.b = getValue(config.incolorB, msg);
            node.send(msg)
        });
    }

    // Bitmap
    function bitmap(config) {
        RED.nodes.createNode(this, config);
        var context = this.context();
        var node = this;
        this.on('input', function (msg) {
            msg.bitmap = {};
            msg.bitmap.data = getValue(config.indata, msg);
            msg.bitmap.position = {};
            msg.bitmap.position.x = getValue(config.inposX, msg);
            msg.bitmap.position.y = getValue(config.inposY, msg);
            msg.bitmap.size = {};
            msg.bitmap.size.width = getValue(config.inwidth, msg);
            msg.bitmap.size.height = getValue(config.inheight, msg);
            node.send(msg)
        });
    }

    // Bitmap Animation
    function bitmapAnimation(config) {
        RED.nodes.createNode(this, config);
        var context = this.context();
        var node = this;
        this.on('input', function (msg) {
            msg.bitmapAnimation = {};
            msg.bitmapAnimation.data = getValue(config.indata, msg);
            msg.bitmapAnimation.animationDelay = getValue(config.inanimationDelay, msg);
            msg.bitmapAnimation.rubberbanding = config.inrubberbanding;
            msg.bitmapAnimation.limitLoops = getValue(config.inlimitLoops, msg);
            node.send(msg)
        });
    }

    // Clock
    function clock(config) {
        RED.nodes.createNode(this, config);
        var context = this.context();
        var node = this;
        this.on('input', function (msg) {
            msg.clock = {};
            msg.clock.show = true;
            msg.clock.switchAktiv = config.inswitchAktiv;
            msg.clock.switchSec = getValue(config.inswitchSec);
            msg.clock.withSeconds = config.inwithSeconds;
            msg.clock.color = {};
            msg.clock.color.r = getValue(config.incolorR, msg);
            msg.clock.color.g = getValue(config.incolorG, msg);
            msg.clock.color.b = getValue(config.incolorB, msg);
            node.send(msg)
        });
    }

    // Sound
    function sound(config) {
        RED.nodes.createNode(this, config);
        var context = this.context();
        var node = this;
        this.on('input', function (msg) {
            msg.sound = {};
            msg.sound.volume = getValue(config.inVolume);
            msg.sound.control = getValue(config.inControl);
            msg.sound.folder = getValue(config.inFolder);
            msg.sound.file = getValue(config.inFile);
            node.send(msg)
        });
    }


    function getValue(input, msg) {
        var output;
        if (input) {
            if (isMsgVal(input)) {
                output = RED.util.getMessageProperty(msg, cleanMsgVal(input));
            } else {
                output = input;
            }
        }
        return output;
    }

    function isMsgVal(input) {
        input = input.toString().trim();
        return (input.startsWith("{{") && input.endsWith("}}"));
    }

    function cleanMsgVal(input) {
        return input.trim().replace("{{", "").replace("}}", "").replace("msg.", "");
    }

    function cleanScreenName(input) {
        return input.trim().replace(" ", "_");
    }

    //=============== Core =================//
    RED.nodes.registerType("Core", core);
    RED.nodes.registerType("Alert Screen", alertScreen);
    RED.nodes.registerType("Screen Data Update", screenDatatUpdate);
    RED.nodes.registerType("Matrix Control", matrixControl);
    RED.nodes.registerType("Playlist Update", playlistUpdate);
    RED.nodes.registerType("Matrix Config", matrixConfig);

    //=============== Options =================//
    RED.nodes.registerType("Switch Animation", switchAnimation);
    RED.nodes.registerType("Screen Init", screenInit);
    RED.nodes.registerType("Text", text);
    RED.nodes.registerType("Bitmap", bitmap);
    RED.nodes.registerType("Bitmap Animation", bitmapAnimation);
    RED.nodes.registerType("Clock", clock);
    RED.nodes.registerType("Sound", sound);
};