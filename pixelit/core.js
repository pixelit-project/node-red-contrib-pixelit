//@ts-check
"use strict";
const tools = require("./lib/tools");
const errorImage = '[64512,0,0,0,0,0,0,64512,0,64512,0,0,0,0,64512,0,0,0,64512,0,0,64512,0,0,0,0,0,64512,64512,0,0,0,0,0,0,64512,64512,0,0,0,0,0,64512,0,0,64512,0,0,0,64512,0,0,0,0,64512,0,64512,0,0,0,0,0,0,64512]';

module.exports = (red) => {
    // Core
    function core(config) {
        red.nodes.createNode(this, config);
        const context = this.context();
        const node = this;

        const shutdown = new AbortController();
        const bitmapCache = new Map();
        // Drop the unbounded cache left in context by earlier versions.
        for (const key of context.keys?.() || []) {
            if (key.startsWith("bmpCache_")) context.set(key, undefined);
        }
        let cacheBytes = 0;
        let activeScreen;
        function beginScreen() {
            activeScreen?.abort();
            activeScreen = new AbortController();
            return activeScreen;
        }
        function current(operation) {
            return !closed && operation === activeScreen && !operation.signal.aborted;
        }
        function cacheBitmap(key, value) {
            const bytes = Buffer.byteLength(value, "utf8");
            if (bytes > 1024 * 1024) return;
            if (bitmapCache.has(key)) {
                cacheBytes -= bitmapCache.get(key).bytes;
                bitmapCache.delete(key);
            }
            while (bitmapCache.size >= 100 || cacheBytes + bytes > 1024 * 1024) {
                const oldest = bitmapCache.keys().next().value;
                cacheBytes -= bitmapCache.get(oldest).bytes;
                bitmapCache.delete(oldest);
            }
            bitmapCache.set(key, { value, bytes });
            cacheBytes += bytes;
        }
        function reportFailure(target, error, fill) {
            let reason = "Connection failed";
            if (error.status) reason = `HTTP ${error.status}`;
            else if (error.name === "TimeoutError") reason = "Timeout after 1000 ms";
            else if (error.name === "SyntaxError" || error.code === "INVALID_BITMAP") reason = "Invalid bitmap response";
            // Do not log request URLs, bodies or raw errors, which may contain credentials.
            const text = `${target}: ${reason}`;
            node.status({ fill, shape: "dot", text });
            node.warn(text);
        }
        async function request(url, body, operation) {
            const response = await fetch(url, {
                method: body === undefined ? "GET" : "POST",
                headers: {
                    "User-Agent": "Node_Red_Core",
                    "Content-type": "application/json; charset=utf-8",
                },
                body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
                signal: AbortSignal.any([shutdown.signal, AbortSignal.timeout(1000), ...(operation ? [operation.signal] : [])]),
            });
            if (!response.ok) {
                await response.body?.cancel();
                const error = new Error(`HTTP ${response.status}`);
                error.status = response.status;
                throw error;
            }
            // Read the body before finishing so the timeout also covers slow responses.
            if (body === undefined) return response.json();
            await response.text();
        }

        let closed = false;
        let timeout;
        function stopTimer() {
            clearTimeout(timeout);
            timeout = undefined;
        }
        function schedule(callback, delay) {
            stopTimer();
            if (!closed) timeout = setTimeout(callback, delay);
        }
        function validDuration(value) {
            return Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 2147483;
        }
        this.on("close", () => {
            closed = true;
            shutdown.abort();
            activeScreen?.abort();
            bitmapCache.clear();
            cacheBytes = 0;
            stopTimer();
        });

        this.on("input", async (msg, send, done) => {
            if (closed) return;
            try {
                let sleepModeActive = context.get("sleepModeActive") || false;
                let sendOverHTTPActive = true;
                let mqttMasterTopic = tools.getValue(red, config.masterTopic, msg) || "";
                const uuid = config.uuid;

                // Clean Master Topic
                if (mqttMasterTopic.substr(mqttMasterTopic.length - 1) === "/") {
                    mqttMasterTopic = mqttMasterTopic.slice(0, -1);
                }

                // Check is IP Config?!
                if (!config.ip || config.ip === "") {
                    sendOverHTTPActive = false;
                }

                // This topic sent by all providers to update the data in the context
                if (msg.topic === "screen_data_update") {
                    if (typeof msg.screenName === "string" && msg.screenName.trim() && validDuration(msg.duration)) {
                        tools.cleanDisplayMSG(msg);
                        context.set(msg.screenName, msg);
                        node.status({
                            fill: "blue",
                            shape: "ring",
                            text: `Screen [${msg.screenName}] stored`,
                        });
                    } else {
                        node.status({
                            fill: "red",
                            shape: "dot",
                            text: "Screen data cannot store!",
                        });
                    }
                }

                // Check is SleepMode Aktiv?! (Ab hier ist dann schluß! :-) )
                if (sleepModeActive == true && msg.sleepMode == undefined) {
                    node.status({
                        fill: "yellow",
                        shape: "ring",
                        text: "Sleep Mode Active!",
                    });
                    if (done) done();
                    return;
                }

                // This topic sent by all providers to update the data in the context
                if (msg.topic === "matrix_control") {
                    const operation = beginScreen();
                    node.status({
                        fill: "grey",
                        shape: "ring",
                        text: "Matrix Control send",
                    });

                    // SleepMode Steuerung
                    if (msg.sleepMode != undefined && tools.booleanConvert(msg.sleepMode) == true) {
                        stopTimer();
                        sleepModeActive = true;
                        context.set("sleepModeActive", sleepModeActive);
                        node.status({
                            fill: "yellow",
                            shape: "ring",
                            text: "Sleep Mode Active!",
                        });
                        await sendToPixelItScreen(await createScreenJson(msg, operation), operation);
                    } else if (msg.sleepMode != undefined && tools.booleanConvert(msg.sleepMode) == false) {
                        sleepModeActive = false;
                        context.set("sleepModeActive", sleepModeActive);
                        await sendToPixelItScreen(await createScreenJson(msg, operation), operation);
                        if (current(operation)) await getNextScreen();
                    } else if (sleepModeActive == false) {
                        await sendToPixelItScreen(await createScreenJson(msg, operation), operation);
                    }
                }

                // This topic sent by all providers to update the data in the context
                if (msg.topic === "matrix_config") {
                    // Key whitelist
                    const keyWhiteList = ["matrixtBrightness", "matrixType", "matrixTempCorrection", "ntpServer", "clockTimeZone", "scrollTextDefaultDelay", "bootScreenAktiv", "mqttAktiv", "mqttServer", "mqttMasterTopic", "mqttPort", "mqttUser", "mqttPassword"];
                    // Clean Obj
                    for (const key in msg) {
                        if (!keyWhiteList.includes(key)) {
                            delete msg[key];
                        }
                    }
                    node.status({
                        fill: "grey",
                        shape: "ring",
                        text: "Matrix Config send",
                    });
                    await sendToPixelItConfig(createConfigJson(msg));
                }

                // This topic is sent when the play is updated
                if (msg.topic === "playlist_update") {
                    if (Array.isArray(msg.payload) && msg.payload.every(item =>
                        item && typeof item.screenName === "string" && item.screenName.trim())) {
                        beginScreen();
                        stopTimer();
                        context.set("screenPlayList", msg.payload);
                        node.status({
                            fill: "green",
                            shape: "ring",
                            text: "New Playlist stored",
                        });

                        context.set("nextScreenNumber", 0);
                        await getNextScreen();
                    } else {
                        node.status({
                            fill: "red",
                            shape: "dot",
                            text: "New Playlist cannot store!",
                        });
                    }
                }

                if (msg.topic === "alert_screen") {
                    if (!validDuration(msg.duration)) {
                        throw new Error("Alert duration must be a positive number of seconds (maximum 2147483)");
                    }
                    const operation = beginScreen();
                    if (timeout) {
                        stopTimer();
                    }

                    let status = "Displaying alert [No Named] now!";

                    if (msg.screenName != null) {
                        status = `Displaying alert [${msg.screenName}] now!`;
                    }

                    tools.cleanDisplayMSG(msg);

                    schedule(getNextScreen, Number(msg.duration) * 1000);
                    node.status({
                        fill: "yellow",
                        shape: "ring",
                        text: status,
                    });

                    await sendToPixelItScreen(await createScreenJson(msg, operation), operation);
                }

                async function getNextScreen() {
                    if (closed || context.get("sleepModeActive")) return;
                    const screenPlayList = context.get("screenPlayList");
                    // Wurde keine ScreenPlaylist gespeichert?
                    if (!screenPlayList) {
                        return;
                    }

                    const screenPlayListCount = screenPlayList.length;
                    // Sind keine Screens in der ScreenPlaylist?
                    if (screenPlayListCount === 0) {
                        return;
                    }

                    // currentScreenNumber laden (ist die Number die angeziegt werden soll!)
                    let nextScreenNumber = context.get("nextScreenNumber") || 0;
                    // Prüfen ob wir 'out of index' laufen
                    if (nextScreenNumber >= screenPlayListCount) {
                        nextScreenNumber = 0;
                    }

                    const operation = beginScreen();
                    const nextScreenPlayListItem = screenPlayList[nextScreenNumber];
                    const nextScreen = context.get(nextScreenPlayListItem.screenName);

                    // Wenn ein Screen nicht gefunden oder nicht gezeigt werden soll
                    if (!nextScreen || !validDuration(nextScreen.duration) || (nextScreen && nextScreen.show != undefined && tools.booleanConvert(nextScreen.show) == false)) {
                        // nextScreenNumber hochzählen für die next Round
                        nextScreenNumber++;
                        context.set("nextScreenNumber", nextScreenNumber);
                        // Short Timeout für den nächsten Screen. Ohne Timeout geht nicht,
                        // Könnte sehr hohe CPU usage veruhrsachen wenn kein screen gefunden würde!
                        if (timeout) {
                            stopTimer();
                        }
                        schedule(getNextScreen, 200);
                        return;
                    }

                    // nextScreenNumber hochzählen für die next Round
                    nextScreenNumber++;
                    context.set("nextScreenNumber", nextScreenNumber);

                    node.status({
                        fill: "green",
                        shape: "ring",
                        text: `Displaying [${nextScreenPlayListItem.screenName}] now`,
                    });

                    if (timeout) {
                        stopTimer();
                    }

                    schedule(getNextScreen, Number(nextScreen.duration) * 1000);
                    try {
                        const nextScreenJson = await createScreenJson(nextScreen, operation);
                        await sendToPixelItScreen(nextScreenJson, operation);
                    } catch (error) {
                        if (!current(operation)) return;
                        node.error(error);
                        node.status({
                            fill: "red",
                            shape: "dot",
                            text: `Screen ${nextScreen.screenName} cannot send to Pixel It!`,
                        });
                    }
                }

                async function createScreenJson(msg, operation) {
                    // Remove Object Ref.
                    const jsonObj = JSON.parse(JSON.stringify(msg));
                    // SleepMode Overrides
                    if (jsonObj.sleepMode != undefined) {
                        jsonObj.sleepMode = tools.booleanConvert(jsonObj.sleepMode);
                    }
                    // Show Overrides
                    if (jsonObj.show != undefined) {
                        jsonObj.show = tools.booleanConvert(jsonObj.show);
                    }
                    // Brightness Overrides
                    if (jsonObj.brightness) {
                        jsonObj.brightness = Number(jsonObj.brightness);
                    }
                    // SwitchAnimation Overrides
                    if (jsonObj.switchAnimation != undefined) {
                        jsonObj.switchAnimation.aktiv = tools.booleanConvert(jsonObj.switchAnimation.aktiv);
                        if (jsonObj.switchAnimation.data) {
                            jsonObj.switchAnimation.data = JSON.parse(await getBitMap(jsonObj.switchAnimation.data, operation));
                            jsonObj.switchAnimation.width = Number(jsonObj.switchAnimation.width);
                        }
                        if (jsonObj.switchAnimation.color) {
                            jsonObj.switchAnimation.color.r = Number(jsonObj.switchAnimation.color.r);
                            jsonObj.switchAnimation.color.g = Number(jsonObj.switchAnimation.color.g);
                            jsonObj.switchAnimation.color.b = Number(jsonObj.switchAnimation.color.b);
                        }
                    }
                    // Bitmap Overrides
                    if (jsonObj.bitmap) {
                        try {
                            jsonObj.bitmap.data = JSON.parse(await getBitMap(jsonObj.bitmap.data, operation));
                        } catch (error) {
                            jsonObj.bitmap.data = JSON.parse(errorImage);
                        }
                        if (jsonObj.bitmap.position) {
                            jsonObj.bitmap.position.x = Number(jsonObj.bitmap.position.x);
                            jsonObj.bitmap.position.y = Number(jsonObj.bitmap.position.y);
                        }
                        if (jsonObj.bitmap.size) {
                            jsonObj.bitmap.size.width = Number(jsonObj.bitmap.size.width);
                            jsonObj.bitmap.size.height = Number(jsonObj.bitmap.size.height);
                        }
                    }
                    // BitmapAnimation Overrides
                    if (jsonObj.bitmapAnimation) {
                        if (!jsonObj.bitmapAnimation.limitLoops) {
                            jsonObj.bitmapAnimation.limitLoops = 0;
                        }
                        jsonObj.bitmapAnimation.limitLoops = Number(jsonObj.bitmapAnimation.limitLoops);
                        try {
                            jsonObj.bitmapAnimation.data = JSON.parse(`[${await getBitMap(jsonObj.bitmapAnimation.data, operation)}]`);
                        } catch (error) {
                            jsonObj.bitmapAnimation.data = JSON.parse(`[${errorImage}]`);
                        }

                        jsonObj.bitmapAnimation.animationDelay = Number(jsonObj.bitmapAnimation.animationDelay);
                    }
                    // Sound Overrides
                    if (jsonObj.sound) {
                        if (jsonObj.sound.volume) {
                            jsonObj.sound.volume = Number(jsonObj.sound.volume);
                        }
                        if (jsonObj.sound.control) {
                            if (jsonObj.sound.control == "play") {
                                if (jsonObj.sound.folder) {
                                    jsonObj.sound.folder = Number(jsonObj.sound.folder);
                                }
                                if (jsonObj.sound.file) {
                                    jsonObj.sound.file = Number(jsonObj.sound.file);
                                }
                            }
                        }
                    }
                    // Text Overrides
                    if (jsonObj.text) {
                        if (jsonObj.text.scrollText != undefined) {
                            if (jsonObj.text.scrollText != "auto") {
                                jsonObj.text.scrollText = tools.booleanConvert(jsonObj.text.scrollText);
                            } else {
                                jsonObj.text.scrollText = jsonObj.text.scrollText;
                            }
                        }
                        if (jsonObj.text.scrollTextDelay) {
                            jsonObj.text.scrollTextDelay = Number(jsonObj.text.scrollTextDelay);
                        }
                        if (jsonObj.text.centerText != undefined) {
                            jsonObj.text.centerText = tools.booleanConvert(jsonObj.text.centerText);
                        }
                        if (jsonObj.text.position) {
                            jsonObj.text.position.x = Number(jsonObj.text.position.x);
                            jsonObj.text.position.y = Number(jsonObj.text.position.y);
                        }
                        if (jsonObj.text.color) {
                            jsonObj.text.color.r = Number(jsonObj.text.color.r);
                            jsonObj.text.color.g = Number(jsonObj.text.color.g);
                            jsonObj.text.color.b = Number(jsonObj.text.color.b);
                        }
                    }
                    // Clock Overrides
                    if (jsonObj.clock) {
                        jsonObj.clock.show = tools.booleanConvert(jsonObj.clock.show);
                        jsonObj.clock.switchAktiv = tools.booleanConvert(jsonObj.clock.switchAktiv);
                        jsonObj.clock.withSeconds = tools.booleanConvert(jsonObj.clock.withSeconds);
                        jsonObj.clock.switchSec = Number(jsonObj.clock.switchSec);
                        if (jsonObj.clock.color) {
                            jsonObj.clock.color.r = Number(jsonObj.clock.color.r);
                            jsonObj.clock.color.g = Number(jsonObj.clock.color.g);
                            jsonObj.clock.color.b = Number(jsonObj.clock.color.b);
                        }
                    }
                    // Bar Overrides
                    if (jsonObj.bar) {
                        if (jsonObj.bar.position) {
                            jsonObj.bar.position.x = Number(jsonObj.bar.position.x);
                            jsonObj.bar.position.y = Number(jsonObj.bar.position.y);
                            jsonObj.bar.position.x2 = Number(jsonObj.bar.position.x2);
                            jsonObj.bar.position.y2 = Number(jsonObj.bar.position.y2);
                        }
                        if (jsonObj.bar.color) {
                            jsonObj.bar.color.r = Number(jsonObj.bar.color.r);
                            jsonObj.bar.color.g = Number(jsonObj.bar.color.g);
                            jsonObj.bar.color.b = Number(jsonObj.bar.color.b);
                        }
                    }
                    // Set GPIO Overrides
                    if (jsonObj.setGpio) {
                        jsonObj.setGpio.gpio = Number(jsonObj.setGpio.gpio);
                        jsonObj.setGpio.set = tools.booleanConvert(jsonObj.setGpio.set);
                        if (jsonObj.setGpio.duration) {
                            jsonObj.setGpio.duration = Number(jsonObj.setGpio.duration);
                        }
                    }

                    return JSON.stringify(jsonObj);
                }

                function createConfigJson(msg) {
                    msg.matrixtBrightness = Number(msg.matrixtBrightness);
                    msg.matrixType = Number(msg.matrixType);
                    msg.bootScreenAktiv = tools.booleanConvert(msg.bootScreenAktiv);
                    msg.mqttAktiv = tools.booleanConvert(msg.mqttAktiv);
                    return msg;
                }

                async function sendToPixelItConfig(myjson) {
                    if (closed) return;
                    const result = {
                        topic: mqttMasterTopic + "/setConfig",
                        payload: myjson,
                    };
                    node.send(result);

                    if (sendOverHTTPActive) {
                        try {
                            await request(`http://${config.ip}/api/config`, myjson);
                        } catch (error) {
                            if (closed) return;
                            reportFailure("PixelIt config", error, "yellow");
                        }
                    }
                }

                async function sendToPixelItScreen(myjson, operation) {
                    if (!current(operation)) return;
                    const result = {
                        topic: mqttMasterTopic + "/setScreen",
                        payload: myjson,
                    };

                    node.send(result);

                    if (sendOverHTTPActive) {
                        try {
                            await request(`http://${config.ip}/api/screen`, myjson, operation);
                        } catch (error) {
                            if (!current(operation)) return;
                            reportFailure("PixelIt screen", error, "yellow");
                        }
                    }
                }

                async function getBitMap(input, operation) {
                    if (!current(operation) || !input) return errorImage;
                    if (String(input).includes(",")) return input;
                    const id = Number(input);
                    if (!Number.isSafeInteger(id) || id <= 0) {
                        reportFailure("Bitmap", { code: "INVALID_BITMAP" }, "red");
                        return errorImage;
                    }
                    const key = JSON.stringify([uuid || "", id]);
                    const cached = bitmapCache.get(key);
                    if (cached) {
                        bitmapCache.delete(key);
                        bitmapCache.set(key, cached);
                        return cached.value;
                    }
                    try {
                        const result = await request(`https://pixelit.bastelbunker.de/API/GetBMPByID/${id}?uuid=${encodeURIComponent(uuid || "")}`, undefined, operation);
                        if (!current(operation)) return errorImage;
                        if (!result || result.id == null || result.id == 0 || typeof result.rgB565Array !== "string") {
                            const error = new Error("Invalid bitmap response");
                            error.code = "INVALID_BITMAP";
                            throw error;
                        }
                        const frames = JSON.parse(`[${result.rgB565Array}]`);
                        if (!frames.length || !frames.every(Array.isArray)) {
                            const error = new Error("Invalid bitmap response");
                            error.code = "INVALID_BITMAP";
                            throw error;
                        }
                        cacheBitmap(key, result.rgB565Array);
                        return result.rgB565Array;
                    } catch (error) {
                        if (current(operation)) reportFailure(`Bitmap ${id}`, error, "red");
                        return errorImage;
                    }
                }

            } catch (error) {
                if (done) done(error);
                else node.error(error, msg);
                return;
            }
            if (done) done();
        });
    }

    red.nodes.registerType("Core", core);
};
