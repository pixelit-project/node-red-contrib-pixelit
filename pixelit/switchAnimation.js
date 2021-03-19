//@ts-check
'use strict';
module.exports = (red) => {
    function switchAnimation(config) {
        red.nodes.createNode(this, config);
        const node = this;
        this.on('input', function (msg) {
            msg.switchAnimation = {};
            msg.switchAnimation.aktiv = config.aktiv;
            msg.switchAnimation.animation = config.animation;
            node.send(msg)
        });
    }
    red.nodes.registerType("Switch Animation", switchAnimation);
}