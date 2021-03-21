//@ts-check
'use strict';
const tools = require('./lib/tools');
const axios = require('axios').default;

module.exports = (red) => {
    // Core
     function core(config) {
        red.nodes.createNode(this, config);
        const context = this.context();
        const node = this;
        
        this.on('input', async (msg) => {

            let sleepModeAktiv = context.get('sleepModeAktiv') || false;
            let sendOverHTTPAktiv = true;
            let mqttMasterTopic = tools.getValue(red, config.masterTopic, msg) || '';

            // Clean Master Topic
            if (mqttMasterTopic.substr(mqttMasterTopic.length - 1) === '/') {
                mqttMasterTopic = mqttMasterTopic.slice(0, -1);
            }

            // Check is IP Config?!
            if (!config.ip || config.ip === '') {
                sendOverHTTPAktiv = false;
            }

            // This topic sent by all providers to update the data in the context
            if (msg.topic === 'screen_data_update') {
                if (msg.screenName && msg.duration) {
                    tools.cleanDisplayMSG(msg);
                    context.set(msg.screenName, msg);
                    node.status({
                        fill: 'blue',
                        shape: 'ring',
                        text: `Screen [${msg.screenName}] stored`
                    });
                } 
                else {
                    node.status({
                        fill: 'red',
                        shape: 'dot',
                        text: 'Screen data cannot store!'
                    });
                }
            }

            // Check is SleepMode Aktiv?! (Ab hier ist dann schluß! :-) )
            if (sleepModeAktiv == true && msg.sleepMode == null) {
                node.status({
                    fill: 'yellow',
                    shape: 'ring',
                    text: 'Sleep Mode Aktiv!'
                });
                return;
            }

            // This topic sent by all providers to update the data in the context
            if (msg.topic === 'matrix_control') {
                node.status({
                    fill: 'grey',
                    shape: 'ring',
                    text: 'Matrix Control send'
                });

                // SleepMode Steuerung 
                if (msg.sleepMode && msg.sleepMode == true) {
                    clearTimeout(context.get('timeout'));
                    sleepModeAktiv = true;
                    context.set('sleepModeAktiv', sleepModeAktiv);
                    sendToPixelItScreen(createScreenJson(msg));
                } 
                else if (msg.sleepMode && msg.sleepMode == false) {
                    sleepModeAktiv = false;
                    context.set('sleepModeAktiv', sleepModeAktiv);
                    sendToPixelItScreen(createScreenJson(msg));
                    await getNextScreen();
                } 
                else if (sleepModeAktiv == false) {
                    sendToPixelItScreen(createScreenJson(msg));
                }
            }

            // This topic sent by all providers to update the data in the context
            if (msg.topic === 'matrix_config') {
                 // Key whitelist
                 const keyWhiteList = [
                    'matrixtBrightness',
                    'matrixType',
                    'matrixTempCorrection',
                    'ntpServer',
                    'clockTimeZone',
                    'scrollTextDefaultDelay',
                    'bootScreenAktiv',
                    'mqttAktiv',
                    'mqttServer',
                    'mqttMasterTopic',
                    'mqttPort',
                    'mqttUser',
                    'mqttPassword',
                ];
                // Clean Obj
                for (const key in msg) {
                     if (!keyWhiteList.includes(key)){
                        delete msg[key];
                    } 
                }
                node.status({
                    fill: 'grey',
                    shape: 'ring',
                    text: 'Matrix Config send'
                });
                sendToPixelItConfig(createConfigJson(msg));
            }

            // This topic is sent when the play is updated
            if (msg.topic === 'playlist_update') {
                if (msg.payload[0].screenName) {
                    context.set('screenPlayList', msg.payload);
                    node.status({
                        fill: 'green',
                        shape: 'ring',
                        text: 'New Playlist stored'
                    });
                    
                    context.set('nextScreenNumber', 0);
                    await getNextScreen();
                } else {
                    node.status({
                        fill: 'red',
                        shape: 'dot',
                        text: 'New Playlist cannot store!'
                    });
                }
            }

            if (msg.topic === 'alert_screen') {
                if (context.get('timeout')) {
                    clearTimeout(context.get('timeout'));
                }

                let status = 'Displaying alert [No Named] now!';

                if (msg.screenName != null) {
                    status = `Displaying alert [${msg.screenName}] now!`;
                }

                tools.cleanDisplayMSG(msg);

                context.set('timeout', setTimeout(getNextScreen, (msg.duration * 1000)));
                node.status({
                    fill: 'yellow',
                    shape: 'ring',
                    text: status
                });
                sendToPixelItScreen(await createScreenJson(msg));
            }

            async function getNextScreen() {

                const screenPlayList = context.get('screenPlayList'); 
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
                let nextScreenNumber = context.get('nextScreenNumber') || 0;               
                // Prüfen ob wir 'out of index' laufen
                if (nextScreenNumber >= screenPlayListCount) {
                    nextScreenNumber = 0;
                }

                const nextScreenPlayListItem = screenPlayList[nextScreenNumber];
                const nextScreen = context.get(nextScreenPlayListItem.screenName);
                
                // Wenn ein Screen nicht gefunden oder nicht gezeigt werden soll
                if ((!nextScreen) || (nextScreen && nextScreen.show != undefined && tools.booleanConvert(nextScreen.show) == false)) {
                    // nextScreenNumber hochzählen für die next Round
                    nextScreenNumber++;
                    context.set('nextScreenNumber', nextScreenNumber); 
                    // Short Timeout für den nächsten Screen. Ohne Timeout geht nicht,
                    // Könnte sehr hohe CPU usage veruhrsachen wenn kein screen gefunden würde!
                    if (context.get('timeout')) {
                        clearTimeout(context.get('timeout'));
                    } 
                    context.set('timeout', setTimeout(getNextScreen, 200));
                    return;
                }
                
                // nextScreenNumber hochzählen für die next Round
                nextScreenNumber++;
                context.set('nextScreenNumber', nextScreenNumber);    

                node.status({
                    fill: 'green',
                    shape: 'ring',
                    text: `Displaying [${nextScreenPlayListItem.screenName}] now`
                });

                if (context.get('timeout')) {
                    clearTimeout(context.get('timeout'));
                }

                context.set('timeout', setTimeout(getNextScreen, (nextScreen.duration * 1000)));
                sendToPixelItScreen(await createScreenJson(nextScreen));                    
            }     

            async function createScreenJson(msg) {
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
                }
                // Bitmap Overrides
                if (jsonObj.bitmap) {
                    jsonObj.bitmap.data =  JSON.parse(await getBitMap(jsonObj.bitmap.data));
                    jsonObj.bitmap.position.x = Number(jsonObj.bitmap.position.x);
                    jsonObj.bitmap.position.y = Number(jsonObj.bitmap.position.y);
                    jsonObj.bitmap.size.width = Number(jsonObj.bitmap.size.width);
                    jsonObj.bitmap.size.height = Number(jsonObj.bitmap.size.height);
                }
                // BitmapAnimation Overrides
                if (jsonObj.bitmapAnimation) {
                    if (!jsonObj.bitmapAnimation.limitLoops) {
                        jsonObj.bitmapAnimation.limitLoops = 0;
                    }  
                    jsonObj.bitmapAnimation.limitLoops = Number(jsonObj.bitmapAnimation.limitLoops);                                     
                    jsonObj.bitmapAnimation.data = JSON.parse(`[${await getBitMap(jsonObj.bitmapAnimation.data)}]`);
                    //jsonObj.bitmapAnimation.rubberbanding = jsonObj.bitmapAnimation.rubberbanding;
                    jsonObj.bitmapAnimation.animationDelay = Number(jsonObj.bitmapAnimation.animationDelay); 
                }
                // Sound Overrides
                if (jsonObj.sound) {  
                    if (jsonObj.sound.volume) {
                        jsonObj.sound.volume = Number(jsonObj.sound.volume);
                    }
                    if (jsonObj.sound.control) { 
                        if (jsonObj.sound.control == 'play') {
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
                        jsonObj.text.scrollText = tools.booleanConvert(jsonObj.text.scrollText); 
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

                    jsonObj.text.color.r = Number(jsonObj.text.color.r);
                    jsonObj.text.color.g = Number(jsonObj.text.color.g);
                    jsonObj.text.color.b = Number(jsonObj.text.color.b);
                }
                // Clock Overrides
                if (jsonObj.clock) {
                   
                    jsonObj.clock.show = tools.booleanConvert(jsonObj.clock.show);                  
                    jsonObj.clock.switchAktiv = tools.booleanConvert(jsonObj.clock.switchAktiv);
                    jsonObj.clock.withSeconds = tools.booleanConvert(jsonObj.clock.withSeconds);                    
                    jsonObj.clock.switchSec = Number(jsonObj.clock.switchSec);
                    jsonObj.clock.color.r = Number(jsonObj.clock.color.r);
                    jsonObj.clock.color.g = Number(jsonObj.clock.color.g);
                    jsonObj.clock.color.b = Number(jsonObj.clock.color.b);
                }
                // Bar Overrides
                if (jsonObj.bar) {
                    jsonObj.bar.position.x = Number( jsonObj.bar.position.x);
                    jsonObj.bar.position.y = Number(jsonObj.bar.position.y);
                    jsonObj.bar.position.x2 = Number(jsonObj.bar.position.x2);
                    jsonObj.bar.position.y2 = Number(jsonObj.bar.position.y2);
                    jsonObj.bar.color.r = Number(jsonObj.bar.color.r);
                    jsonObj.bar.color.g = Number(jsonObj.bar.color.g);
                    jsonObj.bar.color.b = Number(jsonObj.bar.color.b);    
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
                const result = {
                    topic: mqttMasterTopic + '/setConfig',
                    payload: myjson
                };
                node.send(result);

                if (sendOverHTTPAktiv) {
                    try {
                        await axios.post(`http://${config.ip}/api/config`, myjson, {
                            headers: {
                                'User-Agent': 'Node_Red_Core',
                                'Content-type': 'application/json; charset=utf-8'
                            },
                            timeout: 1000
                        });
                    } 
                    catch (error) {
                        node.status({
                            fill: "yellow",
                            shape: "dot",
                            text: "Cannot reach the Pixel It via http API.."
                        });
                    }
                }
            }

            async function sendToPixelItScreen(myjson) {
                const result = {
                    topic: mqttMasterTopic + '/setScreen',
                    payload: myjson
                };
                node.send(result);

                if (sendOverHTTPAktiv) {
                    try {
                        await axios.post(`http://${config.ip}/api/screen`, myjson, {
                            headers: {
                                'User-Agent': 'Node_Red_Core',
                                'Content-type': 'application/json; charset=utf-8'
                            },
                            timeout: 1000
                        });
                    } 
                    catch (error) {
                        node.status({
                            fill: "yellow",
                            shape: "dot",
                            text: "Cannot reach the Pixel It via http API.."
                        });
                    }
                }
            }           

            async function getBitMap(input) {
                let webBmp = '[64512,0,0,0,0,0,0,64512,0,64512,0,0,0,0,64512,0,0,0,64512,0,0,64512,0,0,0,0,0,64512,64512,0,0,0,0,0,0,64512,64512,0,0,0,0,0,64512,0,0,64512,0,0,0,64512,0,0,0,0,64512,0,64512,0,0,0,0,0,0,64512]';
                let webResult;
                
                if (input) {
                    if (String(input).includes(',')) {
                        return input;
                    } 

                    input = parseInt(input);
                    const bmp = context.get(`bmpCache_${input}`);                    
                    if (bmp) {
                        return bmp;
                    } 
                    
                    try {
                        const res = await axios.get(`https://pixelit.bastelbunker.de/API/GetBMPByID/${input}`, {
                            headers: {
                                'User-Agent': 'Node_Red_Core',
                                'Content-type': 'application/json; charset=utf-8'
                            },
                            timeout: 1000
                        });
                        webResult = res.data;
                    } 
                    catch (error) {                        
                        webResult = undefined;
                    }

                    if (webResult && webResult.id && webResult.id != 0) {
                        webBmp = webResult.rgB565Array;
                        context.set(`bmpCache_${input}`, webBmp);
                    }
                }
                return webBmp;
            }
        });
    }

    red.nodes.registerType("Core", core);
};