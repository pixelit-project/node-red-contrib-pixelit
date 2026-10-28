//@ts-check
'use strict';
module.exports = (red) => {
    function matrixConfig(config) {
        red.nodes.createNode(this, config);
        const node = this;
        this.on('input', function (msg) {
            msg.topic = "matrix_config"
            msg.matrixtBrightness = config.matrixtBrightness;
            msg.matrixType = config.matrixType;
            msg.matrixTempCorrection = config.matrixTempCorrection;
            msg.ntpServer = config.ntpServer;
            msg.clockTimeZone = config.clockTimeZone;
            msg.scrollTextDefaultDelay = config.scrollTextDefaultDelay;
            msg.bootScreenAktiv = config.bootScreenAktiv;
            msg.mqttAktiv = config.mqttAktiv;
            msg.mqttServer = config.mqttServer;
            msg.mqttPort = config.mqttPort;
            msg.mqttUser = config.mqttUser;
            // Legacy flows remain usable until the node is saved in the editor.
            msg.mqttPassword = node.credentials && node.credentials.mqttPassword !== undefined
                ? node.credentials.mqttPassword : config.mqttPassword;
            msg.mqttMasterTopic = config.mqttMasterTopic;           

            node.send(msg)
        });
    }

    red.nodes.registerType("Matrix Config", matrixConfig, {
        credentials: { mqttPassword: { type: "password" } }
    });
}