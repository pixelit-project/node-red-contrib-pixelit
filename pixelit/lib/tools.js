//@ts-check
'use strict';

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
    booleanConvert
}