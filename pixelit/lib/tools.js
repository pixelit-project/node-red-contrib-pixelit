//@ts-check
'use strict';

function cleanDisplayMSG(msg) {
    // Key whitelist
    const keyWhiteList = [
        'duration',
        'screenName',
        'sleepMode',
        'brightness',
        'switchAnimation',
        'clock',
        'sound',
        'bitmap',
        'bitmapAnimation',
        'bar',
        'bars',
        'text',
        'show'
    ];
    // Clean Obj
    for (const key in msg) {
        if (!keyWhiteList.includes(key)){
            delete msg[key];
        } 
    }
}

function getValue(red, input, msg) {
    var output;
    if (input) {
        if (isMsgVal(input)) {
            output = red.util.getMessageProperty(msg, cleanMsgVal(input));
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

function isBoolean(val) {
    return val === false || val === true;
}


/**
 * @param {string | boolean} val 
 * @description convert to Boolean
 */
function booleanConvert(val) {    
    if (!this.isBoolean(val)){
        val = val  == 'true';
    }
    return val;
}

module.exports = { 
    getValue,
    isMsgVal,
    cleanMsgVal,
    cleanScreenName,
    isBoolean,
    booleanConvert,
    cleanDisplayMSG
}